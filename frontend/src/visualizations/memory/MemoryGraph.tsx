import { useMemo, useState } from 'react'
import { buildMemoryMapModel } from '../../analysis/memoryMap'
import type { VisualizationModuleProps } from '../registry'
import { MemoryLaneView } from './MemoryLaneView'
import './memory.css'

const value = (input: unknown) => {
  try { return typeof input === 'string' ? input : JSON.stringify(input) } catch { return String(input) }
}

export function MemoryGraph({ context, actions }: VisualizationModuleProps) {
  const model = useMemo(() => buildMemoryMapModel(context), [context])
  const [mode, setMode] = useState<'current' | 'history'>('current')
  const selected = Object.values(model.lanes).flatMap((lane) => lane.ranges)
    .find((range) => range.selected)
  const pointers = context.execution.current?.memory.pointers ?? []
  return (
    <div className="memory-graph">
      <header className="memory-graph-toolbar">
        <div><button className={mode === 'current' ? 'active' : ''} onClick={() => setMode('current')}>当前状态</button><button className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}>历史热度</button></div>
        <span>栈 {model.summary.capturedStackBytes} B · 全局 {model.summary.globalBytes} B · 堆 {model.summary.liveHeapBytes} B · 峰值 {model.summary.peakHeapBytes} B</span>
      </header>
      <MemoryLaneView model={model} historyMode={mode === 'history'} onSelect={actions.selectMemoryObject} />
      {model.registerVariables.length > 0 && <div className="memory-registers"><strong>寄存器变量（不计入比例尺）</strong>{model.registerVariables.map((item) => <code key={item.id}>{item.name} = {value(item.value)}</code>)}</div>}
      <section className="pointer-relations">
        <h3>指针关系</h3>
        {pointers.length === 0 ? <em>当前没有已采集指针</em> : pointers.map((pointer) => {
          const source = context.execution.current?.variables.find((item) => item.id === pointer.sourceVariableId)
          const target = context.execution.current?.memory.objects.find((item) => item.id === pointer.targetObjectId)
          return <button key={pointer.id} type="button" onClick={() => pointer.targetObjectId && actions.selectMemoryObject(pointer.targetObjectId)}>
            <span><b>&amp;{source?.name ?? pointer.sourceExpression ?? 'p'}</b><code>{pointer.sourceAddress ?? '未知'}</code></span>
            <span><b>{source?.name ?? pointer.sourceExpression ?? 'p'}</b><code>{pointer.addressValue ?? '未知'}</code></span>
            <span><b>*{source?.name ?? pointer.sourceExpression ?? 'p'}</b><code>{target ? value(target.value) : pointer.status === 'null' ? 'NULL' : pointer.status}</code></span>
            <i className={`status-${pointer.status}`}>{pointer.status}{pointer.offset ? ` · +${pointer.offset} B` : ''}</i>
          </button>
        })}
      </section>
      {selected && <aside className="memory-selection-detail"><strong>{selected.label}</strong><span>{selected.type}</span><code>{selected.startAddress ?? '地址未知'} · {selected.size ?? '?'} B</code><pre>{value(selected.value)}</pre>{selected.bytes && <code>原始字节：{selected.bytes}</code>}</aside>}
    </div>
  )
}
