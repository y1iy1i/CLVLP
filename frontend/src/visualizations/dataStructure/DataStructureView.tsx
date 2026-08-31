import { useMemo, useState } from 'react'
import { buildMemoryMapModel } from '../../analysis/memoryMap'
import { detectStructure } from '../../analysis/pointerTopology'
import type { MemoryField, TraceVariable } from '../../types/trace'
import type { VisualizationModuleProps } from '../registry'
import { MemoryLaneView } from '../memory/MemoryLaneView'
import '../memory/memory.css'
import './dataStructure.css'

const shapeNames = {
  contiguous_sequence: '连续序列', matrix: '矩阵', record: '记录/结构体', linked_sequence: '链式序列',
  circular_sequence: '环形序列', tree: '树', graph: '普通图', bucket_structure: '桶式指针结构',
  generic_pointer_graph: '通用指针图',
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

function LogicalView({ variable, detected, onMemory }: {
  variable: TraceVariable
  detected: ReturnType<typeof detectStructure>
  onMemory: (id: string) => void
}) {
  if (detected.shape === 'matrix' && Array.isArray(variable.value)) {
    return <div className="structure-matrix">{variable.value.flatMap((row, rowIndex) => Array.isArray(row) ? row.map((cell, columnIndex) => <button key={`${rowIndex}:${columnIndex}`}><small>[{rowIndex}][{columnIndex}]</small><strong>{show(cell)}</strong></button>) : [])}</div>
  }
  if ((detected.shape === 'contiguous_sequence' || detected.shape === 'bucket_structure') && Array.isArray(variable.value)) {
    return <div className="structure-sequence">{variable.value.map((item, index) => <button key={index}><small>[{index}]</small><strong>{show(item)}</strong></button>)}</div>
  }
  if (detected.shape === 'record' && variable.fields) return <Fields fields={variable.fields} onMemory={onMemory} />
  return <div className={`structure-topology shape-${detected.shape}`}>
    {detected.topology.nodes.map((node) => <button key={node.id} className={node.status === 'freed' ? 'is-freed' : ''} onClick={() => onMemory(node.memoryObjectId)}>
      <strong>{node.label}</strong><code>{node.address ?? '地址未知'}</code><small>{node.type ?? '未知类型'}</small>
    </button>)}
    <div className="structure-edges">{detected.topology.edges.map((edge) => <span key={edge.id} className={`status-${edge.status}`}><b>{edge.sourceId}</b> —{edge.role}→ <b>{edge.targetId ?? edge.status}</b></span>)}</div>
  </div>
}

export function DataStructureView({ scope, context, actions }: VisualizationModuleProps) {
  const rootVariableId = scope.kind === 'data-structure' ? scope.rootVariableId : ''
  const variable = context.execution.current?.variables.find((item) => item.id === rootVariableId)
  const detected = context.execution.current && rootVariableId
    ? detectStructure(context.execution.current, rootVariableId)
    : null
  const memory = useMemo(() => buildMemoryMapModel(context), [context])
  const [mode, setMode] = useState<'logical' | 'memory' | 'split'>('logical')
  if (!variable || !detected) return <div className="data-structure-empty">当前 Run 中找不到这个根变量，它可能已经离开作用域。</div>
  const reachable = new Set(detected.memoryObjectIds)
  return <div className="data-structure-view">
    <header><div><strong>{variable.name}</strong><span>{shapeNames[detected.shape]}</span><i>{detected.confidence === 'certain' ? '确定识别' : detected.confidence === 'probable' ? '可能' : '通用视图'}</i></div><nav><button className={mode === 'logical' ? 'active' : ''} onClick={() => setMode('logical')}>逻辑结构</button><button className={mode === 'memory' ? 'active' : ''} onClick={() => setMode('memory')}>内存布局</button><button className={mode === 'split' ? 'active' : ''} onClick={() => setMode('split')}>并排</button></nav></header>
    <div className={`data-structure-content mode-${mode}`}>
      {mode !== 'memory' && <section><LogicalView variable={variable} detected={detected} onMemory={actions.focusMemoryObject} /></section>}
      {mode !== 'logical' && <section><MemoryLaneView model={memory} filterIds={reachable} onSelect={actions.focusMemoryObject} /></section>}
    </div>
    <footer>{detected.evidence.map((item) => <span key={item}>{item}</span>)}{(detected.topology.truncated || detected.topology.maxDepthReached) && <strong>结构过大，已安全截断</strong>}</footer>
  </div>
}
