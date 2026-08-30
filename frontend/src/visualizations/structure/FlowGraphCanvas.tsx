import { useCallback, useEffect, useMemo, useState } from 'react'
import ELK from 'elkjs/lib/elk.bundled.js'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { buildVisibleFlowGraph } from '../../analysis/flowGraphBuilder'
import type { FlowGraph, FlowNode } from '../../types/flowGraph'
import './structure.css'

interface TeachingNodeData extends Record<string, unknown> {
  flowNode: FlowNode
  active: boolean
  ancestorActive: boolean
  expanded: boolean
  graphKind: FlowGraph['kind']
  onToggle?: (node: FlowNode) => void
}

type TeachingNode = Node<TeachingNodeData, 'teaching'>

interface StoredPosition {
  x: number
  y: number
}

interface FlowGraphCanvasProps {
  graph: FlowGraph
  activeSourceNodeId?: string | null
  ancestorSourceNodeIds?: string[]
  autoExpandAncestors?: boolean
  onSourceSelect: (sourceNodeId: string) => void
  onOpenFunction?: (functionId: string) => void
}

const NODE_WIDTH = 184
const NODE_HEIGHT = 66
const STORAGE_PREFIX = 'clvlp:flow-layout:v2:'
const EXPANSION_PREFIX = 'clvlp:flow-expanded:v1:'
const elk = new ELK()

const readPositions = (graphId: string): Record<string, StoredPosition> => {
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${graphId}`) ?? '{}')
  } catch {
    return {}
  }
}

const readExpanded = (graphId: string) => {
  try {
    const stored = JSON.parse(localStorage.getItem(`${EXPANSION_PREFIX}${graphId}`) ?? '[]')
    return new Set<string>(Array.isArray(stored) ? stored : [])
  } catch {
    return new Set<string>()
  }
}

const writeExpanded = (graphId: string, expanded: Set<string>) =>
  localStorage.setItem(`${EXPANSION_PREFIX}${graphId}`, JSON.stringify([...expanded]))

const writePositions = (graphId: string, nodes: TeachingNode[]) => {
  const positions = Object.fromEntries(
    nodes.map((node) => [node.data.flowNode.stableKey, node.position]),
  )
  localStorage.setItem(`${STORAGE_PREFIX}${graphId}`, JSON.stringify(positions))
}

const teachingNodeClass = (node: FlowNode) =>
  `teaching-node teaching-node-${node.kind}`

function TeachingNodeView({ data }: NodeProps<TeachingNode>) {
  const expandable = Boolean(data.flowNode.collapsible)
  return (
    <div
      className={`${teachingNodeClass(data.flowNode)} ${data.active ? 'is-active' : ''} ${data.ancestorActive ? 'is-path-active' : ''}`}
    >
      <Handle id="target" type="target" position={Position.Top} />
      <Handle id="false" type="source" position={Position.Left} />
      <span className="teaching-node-kind">{data.flowNode.kind}</span>
      <strong title={data.flowNode.label}>{data.flowNode.label}</strong>
      {expandable && (
        <button
          className="flow-expand-button nodrag nopan"
          type="button"
          title={data.expanded ? '折叠内部流程' : '展开内部流程'}
          aria-label={data.expanded ? '折叠内部流程' : '展开内部流程'}
          onClick={(event) => {
            event.stopPropagation()
            data.onToggle?.(data.flowNode)
          }}
        >
          {data.expanded ? '−' : '+'}
        </button>
      )}
      <Handle id="true" type="source" position={Position.Right} />
      <Handle id="next" type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { teaching: TeachingNodeView }

const fallbackPosition = (index: number) => ({ x: 48, y: 38 + index * 112 })

const layoutGraph = async (
  graph: FlowGraph,
  stored: Record<string, StoredPosition>,
): Promise<TeachingNode[]> => {
  try {
    const result = await elk.layout({
      id: graph.id,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.spacing.nodeNodeBetweenLayers': '72',
        'elk.spacing.nodeNode': '42',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.padding': '[top=38,left=42,bottom=38,right=42]',
      },
      children: graph.nodes.map((node) => ({
        id: node.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      edges: graph.edges
        .filter((edge) => edge.from !== edge.to)
        .map((edge) => ({ id: edge.id, sources: [edge.from], targets: [edge.to] })),
    })
    const positions = new Map(
      (result.children ?? []).map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]),
    )
    return graph.nodes.map<TeachingNode>((node, index) => ({
      id: node.id,
      type: 'teaching',
      position: stored[node.stableKey] ?? positions.get(node.id) ?? fallbackPosition(index),
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        flowNode: node,
        active: false,
        ancestorActive: false,
        expanded: false,
        graphKind: graph.kind,
      },
    }))
  } catch {
    return graph.nodes.map<TeachingNode>((node, index) => ({
      id: node.id,
      type: 'teaching',
      position: stored[node.stableKey] ?? fallbackPosition(index),
      data: {
        flowNode: node,
        active: false,
        ancestorActive: false,
        expanded: false,
        graphKind: graph.kind,
      },
    }))
  }
}

const edgeColor = (type: string) => {
  if (type === 'true' || type === 'loop_back') return '#42d7a1'
  if (type === 'false' || type === 'break' || type === 'return') return '#f0a85a'
  if (type === 'goto') return '#c895ff'
  return '#718095'
}

function FlowGraphCanvasInner({
  graph,
  activeSourceNodeId,
  ancestorSourceNodeIds = [],
  autoExpandAncestors = false,
  onSourceSelect,
  onOpenFunction,
}: FlowGraphCanvasProps) {
  const { fitView } = useReactFlow()
  const [resetVersion, setResetVersion] = useState(0)
  const [nodes, setNodes] = useState<TeachingNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => readExpanded(graph.id))
  const stored = useMemo(() => {
    void resetVersion
    return readPositions(graph.id)
  }, [graph.id, resetVersion])
  const effectiveExpanded = useMemo(() => {
    const next = new Set(expanded)
    if (autoExpandAncestors) {
      const ancestorSet = new Set(ancestorSourceNodeIds)
      graph.nodes.forEach((node) => {
        if (node.collapsible && node.sourceNodeId && ancestorSet.has(node.sourceNodeId)) {
          next.add(node.stableKey)
        }
      })
    }
    return next
  }, [ancestorSourceNodeIds, autoExpandAncestors, expanded, graph.nodes])
  const visibleGraph = useMemo(
    () => buildVisibleFlowGraph(graph, effectiveExpanded),
    [effectiveExpanded, graph],
  )

  const toggleExpanded = useCallback((flowNode: FlowNode) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(flowNode.stableKey)) next.delete(flowNode.stableKey)
      else next.add(flowNode.stableKey)
      writeExpanded(graph.id, next)
      return next
    })
  }, [graph.id])

  useEffect(() => {
    let cancelled = false
    const ancestorSet = new Set(ancestorSourceNodeIds)
    void layoutGraph(visibleGraph, stored).then((layoutNodes) => {
      if (cancelled) return
      setNodes(layoutNodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          active: node.data.flowNode.sourceNodeId === activeSourceNodeId,
          ancestorActive: Boolean(
            node.data.flowNode.sourceNodeId && ancestorSet.has(node.data.flowNode.sourceNodeId),
          ),
          expanded: effectiveExpanded.has(node.data.flowNode.stableKey),
          onToggle: toggleExpanded,
        },
      })))
      window.setTimeout(() => void fitView({ padding: 0.18, duration: 220 }), 0)
    })
    return () => { cancelled = true }
  }, [activeSourceNodeId, ancestorSourceNodeIds, effectiveExpanded, fitView, stored, toggleExpanded, visibleGraph])

  const edges = useMemo<Edge[]>(() => visibleGraph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    sourceHandle: edge.type === 'true'
      ? 'true'
      : edge.type === 'false' || edge.type === 'loop_back'
        ? 'false'
        : 'next',
    targetHandle: 'target',
    label: edge.label,
    type: edge.from === edge.to ? 'default' : 'step',
    animated: edge.type === 'loop_back',
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(edge.type) },
    style: {
      stroke: edgeColor(edge.type),
      strokeWidth: edge.type === 'calls' ? 1.8 : 1.4,
      strokeDasharray: edge.type === 'loop_back' || (
        edge.type === 'calls' && visibleGraph.nodes.find((node) => node.id === edge.to)?.kind === 'external'
      ) ? '6 5' : undefined,
      opacity: edge.type === 'next' ? 0.72 : 0.95,
    },
    labelStyle: { fill: '#aeb8c7', fontSize: 10 },
    labelBgStyle: { fill: '#161b22', fillOpacity: 0.92 },
  })), [visibleGraph])

  const resetLayout = useCallback(() => {
    localStorage.removeItem(`${STORAGE_PREFIX}${graph.id}`)
    setResetVersion((version) => version + 1)
  }, [graph.id])

  return (
    <div className="flow-canvas">
      {nodes.length === 0 && <div className="graph-layout-status">正在整理流程图…</div>}
      <button className="graph-reset-button" type="button" onClick={resetLayout}>恢复图布局</button>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
        onNodeDragStop={(_, draggedNode) => {
          setNodes((current) => {
            const next = current.map((node) => node.id === draggedNode.id ? draggedNode as TeachingNode : node)
            writePositions(graph.id, next)
            return next
          })
        }}
        onNodeClick={(_, node) => {
          const flowNode = (node as TeachingNode).data.flowNode
          if (flowNode.sourceNodeId) onSourceSelect(flowNode.sourceNodeId)
          if (graph.kind === 'call_graph' && flowNode.kind === 'function' && flowNode.sourceNodeId) {
            onOpenFunction?.(flowNode.sourceNodeId)
          }
        }}
        fitView
        minZoom={0.2}
        maxZoom={1.8}
        colorMode="dark"
      >
        <Background color="#2d3540" gap={22} size={1} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => node.data?.active ? '#4be0ad' : '#566477'}
          maskColor="rgb(10 14 18 / 66%)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export function FlowGraphCanvas(props: FlowGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowGraphCanvasInner key={props.graph.id} {...props} />
    </ReactFlowProvider>
  )
}
