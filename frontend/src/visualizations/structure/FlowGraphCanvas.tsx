import { useCallback, useEffect, useMemo, useState } from 'react'
import dagre from '@dagrejs/dagre'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { FlowGraph, FlowNode } from '../../types/flowGraph'
import './structure.css'

interface TeachingNodeData extends Record<string, unknown> {
  flowNode: FlowNode
  active: boolean
  ancestorActive: boolean
  graphKind: FlowGraph['kind']
  onSelect?: (sourceNodeId: string) => void
  onOpenFunction?: (functionId: string) => void
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
  onSourceSelect: (sourceNodeId: string) => void
  onOpenFunction?: (functionId: string) => void
}

const NODE_WIDTH = 174
const NODE_HEIGHT = 62
const STORAGE_PREFIX = 'clvlp:flow-layout:v1:'

const readPositions = (graphId: string): Record<string, StoredPosition> => {
  try {
    return JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${graphId}`) ?? '{}')
  } catch {
    return {}
  }
}

const writePositions = (graphId: string, nodes: TeachingNode[]) => {
  const positions = Object.fromEntries(
    nodes.map((node) => [node.data.flowNode.stableKey, node.position]),
  )
  localStorage.setItem(`${STORAGE_PREFIX}${graphId}`, JSON.stringify(positions))
}

const teachingNodeClass = (node: FlowNode) =>
  `teaching-node teaching-node-${node.kind}`

function TeachingNodeView({ data }: NodeProps<TeachingNode>) {
  return (
    <div
      className={`${teachingNodeClass(data.flowNode)} ${data.active ? 'is-active' : ''} ${data.ancestorActive ? 'is-path-active' : ''}`}
      role="button"
      tabIndex={0}
      data-interactive={Boolean(data.onSelect)}
      data-open-function={Boolean(data.onOpenFunction)}
      data-graph-kind={data.graphKind}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return
        if (data.flowNode.sourceNodeId) data.onSelect?.(data.flowNode.sourceNodeId)
        if (
          data.graphKind === 'call_graph' &&
          data.flowNode.kind === 'function' &&
          data.flowNode.sourceNodeId
        ) data.onOpenFunction?.(data.flowNode.sourceNodeId)
      }}
    >
      <Handle type="target" position={Position.Top} />
      <span className="teaching-node-kind">{data.flowNode.kind}</span>
      <strong>{data.flowNode.label}</strong>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

const nodeTypes = { teaching: TeachingNodeView }

const layoutGraph = (graph: FlowGraph, stored: Record<string, StoredPosition>) => {
  const layout = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  layout.setGraph({ rankdir: 'TB', ranksep: 68, nodesep: 38, marginx: 32, marginy: 32 })
  graph.nodes.forEach((node) => layout.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  graph.edges.filter((edge) => edge.from !== edge.to).forEach((edge) => layout.setEdge(edge.from, edge.to))
  dagre.layout(layout)
  return graph.nodes.map<TeachingNode>((node) => {
    const calculated = layout.node(node.id) as { x: number; y: number }
    return {
      id: node.id,
      type: 'teaching',
      position: stored[node.stableKey] ?? {
        x: calculated.x - NODE_WIDTH / 2,
        y: calculated.y - NODE_HEIGHT / 2,
      },
      data: { flowNode: node, active: false, ancestorActive: false, graphKind: graph.kind },
    }
  })
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
  onSourceSelect,
  onOpenFunction,
}: FlowGraphCanvasProps) {
  const [resetVersion, setResetVersion] = useState(0)
  const [nodes, setNodes] = useState<TeachingNode[]>([])
  const stored = useMemo(() => readPositions(graph.id), [graph.id, resetVersion])

  useEffect(() => {
    const ancestorSet = new Set(ancestorSourceNodeIds)
    setNodes(layoutGraph(graph, stored).map((node) => ({
      ...node,
      data: {
        ...node.data,
        active: node.data.flowNode.sourceNodeId === activeSourceNodeId,
        ancestorActive: Boolean(
          node.data.flowNode.sourceNodeId && ancestorSet.has(node.data.flowNode.sourceNodeId),
        ),
        onSelect: onSourceSelect,
        onOpenFunction,
      },
    })))
  }, [graph, stored, activeSourceNodeId, ancestorSourceNodeIds, onOpenFunction, onSourceSelect])

  const edges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.label,
    type: edge.from === edge.to ? 'default' : 'smoothstep',
    animated: edge.type === 'loop_back',
    markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(edge.type) },
    style: {
      stroke: edgeColor(edge.type),
      strokeWidth: edge.type === 'calls' ? 1.8 : 1.5,
      strokeDasharray: edge.type === 'calls' && graph.nodes.find((node) => node.id === edge.to)?.kind === 'external'
        ? '6 5'
        : undefined,
    },
    labelStyle: { fill: '#aeb8c7', fontSize: 10 },
    labelBgStyle: { fill: '#161b22', fillOpacity: 0.9 },
  })), [graph])

  const resetLayout = useCallback(() => {
    localStorage.removeItem(`${STORAGE_PREFIX}${graph.id}`)
    setResetVersion((version) => version + 1)
  }, [graph.id])

  return (
    <div className="flow-canvas">
      <button className="graph-reset-button" type="button" onClick={resetLayout}>恢复图布局</button>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={(changes) => {
          setNodes((current) => applyNodeChanges(changes, current))
        }}
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
        minZoom={0.25}
        maxZoom={1.8}
        colorMode="dark"
      >
        <Background color="#2d3540" gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export function FlowGraphCanvas(props: FlowGraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowGraphCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
