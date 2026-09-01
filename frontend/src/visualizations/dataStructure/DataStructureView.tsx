import { useMemo, useState } from 'react'
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { buildMemoryMapModel } from '../../analysis/memoryMap'
import { detectStructure } from '../../analysis/pointerTopology'
import { buildInitializedVariableIds } from '../../analysis/initializedVariables'
import type { MemoryField, TraceVariable } from '../../types/trace'
import type { VisualizationModuleProps } from '../registry'
import { MemoryLaneView } from '../memory/MemoryLaneView'
import '../memory/memory.css'
import './dataStructure.css'

const shapeNames = {
  contiguous_sequence: '连续序列', matrix: '矩阵', record: '记录/结构体', linked_sequence: '链式序列',
  circular_sequence: '环形序列', tree: '树', adjacency_matrix: '邻接矩阵', adjacency_list: '邻接表',
  graph: '通用指针关系', bucket_structure: '连续入口 + 分散链', generic_pointer_graph: '通用指针关系',
}

const show = (value: unknown) => {
  try { return typeof value === 'string' ? value : JSON.stringify(value) } catch { return String(value) }
}

function Fields({ fields, onMemory }: { fields: MemoryField[]; onMemory: (id: string) => void }) {
  return <div className="structure-record">{fields.map((field) => <button key={`${field.name}:${field.offset}`} onClick={() => field.pointer?.targetObjectId && onMemory(field.pointer.targetObjectId)}>
    <strong>{field.name}</strong><small>{field.type}</small><code>+{field.offset ?? '?'} B</code><span>{show(field.value)}</span>
    {field.fields.length > 0 && <Fields fields={field.fields} onMemory={onMemory} />}
  </button>)}</div>
}

const topologyElements = (
  detected: ReturnType<typeof detectStructure>,
  selectedMemoryObjectId?: string,
  onMemory?: (id: string) => void,
) => {
  const topology = detected.topology
  const nodeIds = new Set(topology.nodes.map((node) => node.memoryObjectId))
  const outgoing = new Map<string, string[]>()
  topology.edges.forEach((edge) => {
    if (!edge.targetId || !nodeIds.has(edge.targetId)) return
    outgoing.set(edge.sourceId, [...(outgoing.get(edge.sourceId) ?? []), edge.targetId])
  })
  const levels = new Map<string, number>()
  const root = topology.rootNodeId ?? topology.nodes[0]?.memoryObjectId
  const queue = root ? [root] : []
  if (root) levels.set(root, 0)
  while (queue.length > 0) {
    const current = queue.shift()!
    const nextLevel = (levels.get(current) ?? 0) + 1
    ;(outgoing.get(current) ?? []).forEach((target) => {
      if (levels.has(target)) return
      levels.set(target, nextLevel)
      queue.push(target)
    })
  }
  let orphanLevel = Math.max(0, ...levels.values()) + 1
  topology.nodes.forEach((node) => {
    if (!levels.has(node.memoryObjectId)) levels.set(node.memoryObjectId, orphanLevel++)
  })
  const byLevel = new Map<number, typeof topology.nodes>()
  topology.nodes.forEach((node) => {
    const level = levels.get(node.memoryObjectId) ?? 0
    byLevel.set(level, [...(byLevel.get(level) ?? []), node])
  })
  const horizontal = detected.shape === 'linked_sequence' || detected.shape === 'circular_sequence'
  const nodes: Node[] = [...byLevel.entries()].flatMap(([level, items]) => items.map((node, index) => ({
    id: node.memoryObjectId,
    position: horizontal ? { x: level * 190, y: index * 110 } : { x: index * 190, y: level * 125 },
    className: node.memoryObjectId === selectedMemoryObjectId ? 'is-memory-selected' : '',
    data: {
      label: <button type="button" className="logical-memory-node nodrag nopan" onClick={(event) => { event.stopPropagation(); onMemory?.(node.memoryObjectId) }}><strong>{node.label}</strong><small>{show(node.value)}</small><code>{node.address ?? '地址未知'}</code></button>,
    },
  })))
  const logicalEdges = [...new Map(topology.edges.map((edge) => [`${edge.sourceId}:${edge.role}:${edge.targetId ?? edge.status}`, edge])).values()]
  const edges: Edge[] = logicalEdges.flatMap((edge) => edge.targetId && nodeIds.has(edge.targetId) ? [{
    id: edge.id,
    source: edge.sourceId,
    target: edge.targetId,
    label: edge.role,
    markerEnd: { type: MarkerType.ArrowClosed },
    animated: edge.status === 'dangling',
    style: { stroke: edge.status === 'dangling' ? '#dd756d' : '#8f73ad' },
    labelStyle: { fill: '#9cabba', fontSize: 10 },
  }] : [])
  return { nodes, edges }
}

function LogicalView({ variable, detected, selectedMemoryObjectId, onMemory }: {
  variable: TraceVariable
  detected: ReturnType<typeof detectStructure>
  selectedMemoryObjectId?: string
  onMemory: (id: string) => void
}) {
  if ((detected.shape === 'matrix' || detected.shape === 'adjacency_matrix') && Array.isArray(variable.value)) {
    return <div className="structure-matrix">{variable.value.flatMap((row, rowIndex) => Array.isArray(row) ? row.map((cell, columnIndex) => <button key={`${rowIndex}:${columnIndex}`}><small>[{rowIndex}][{columnIndex}]</small><strong>{show(cell)}</strong></button>) : [])}</div>
  }
  if ((detected.shape === 'contiguous_sequence' || detected.shape === 'bucket_structure') && Array.isArray(variable.value)) {
    return <div className="structure-sequence">{variable.value.map((item, index) => <button key={index}><small>[{index}]</small><strong>{show(item)}</strong></button>)}</div>
  }
  if (detected.shape === 'record' && variable.fields) return <Fields fields={variable.fields} onMemory={onMemory} />
  const elements = topologyElements(detected, selectedMemoryObjectId, onMemory)
  return <div className={`structure-topology-graph shape-${detected.shape}`}>
    <ReactFlow nodes={elements.nodes} edges={elements.edges} fitView nodesConnectable={false} nodesDraggable={false}>
      <Background gap={18} size={1} color="#293641" />
      <Controls showInteractive={false} />
    </ReactFlow>
  </div>
}

export function DataStructureView({ scope, context, actions }: VisualizationModuleProps) {
  const rootVariableId = scope.kind === 'data-structure' ? scope.rootVariableId : ''
  const variable = context.execution.current?.variables.find((item) => item.id === rootVariableId)
  const initializedVariables = useMemo(() => buildInitializedVariableIds(context), [context])
  const initialized = Boolean(variable && initializedVariables.has(variable.id))
  const detected = context.execution.current && rootVariableId && initialized
    ? detectStructure(context.execution.current, rootVariableId)
    : null
  const memory = useMemo(() => buildMemoryMapModel(context), [context])
  const [mode, setMode] = useState<'logical' | 'memory' | 'split'>('split')
  if (!variable) return <div className="data-structure-empty">当前 Run 中找不到这个根变量，它可能已经离开作用域。</div>
  if (!initialized) return <div className="data-structure-view is-waiting">
    <header><div><strong>{variable.name}</strong><span>等待初始化</span></div></header>
    <div className="data-structure-waiting"><strong>{variable.name} 尚未初始化</strong><span>栈空间已经保留，但程序还没有执行它的声明或初始化语句。</span><code>执行到初始化之后，这里会自动切换为有效的逻辑结构。</code></div>
  </div>
  if (!detected) return <div className="data-structure-empty">暂时无法识别这个变量的结构。</div>
  const reachable = new Set(detected.memoryObjectIds)
  return <div className="data-structure-view">
    <header><div><strong>{variable.name}</strong><span>{shapeNames[detected.shape]}</span><i>{detected.confidence === 'certain' ? '确定识别' : detected.confidence === 'probable' ? '可能' : '通用视图'}</i></div><nav><button className={mode === 'logical' ? 'active' : ''} onClick={() => setMode('logical')}>逻辑结构</button><button className={mode === 'memory' ? 'active' : ''} onClick={() => setMode('memory')}>内存布局</button><button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>并排联动</button></nav></header>
    <div className={`data-structure-content mode-${mode}`}>
      {mode !== 'memory' && <section><LogicalView key={`logical:${mode}`} variable={variable} detected={detected} selectedMemoryObjectId={context.selection.memoryObjectId} onMemory={actions.selectMemoryObject} /></section>}
      {mode !== 'logical' && <section><MemoryLaneView model={memory} filterIds={reachable} onSelect={actions.selectMemoryObject} /></section>}
    </div>
    <footer>{detected.evidence.map((item) => <span key={item}>{item}</span>)}{(detected.topology.truncated || detected.topology.maxDepthReached) && <strong>结构过大，已安全截断</strong>}</footer>
  </div>
}
