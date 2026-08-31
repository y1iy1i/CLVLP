import type { MemoryMapModel, MemoryRange, MemoryRegion } from '../../types/memoryMap'
import type { MemoryField } from '../../types/trace'

const regionNames: Record<MemoryRegion, string> = { stack: '栈', global: '全局区', heap: '堆' }
const show = (input: unknown) => {
  try { return typeof input === 'string' ? input : JSON.stringify(input) } catch { return String(input) }
}
const addressPlus = (address?: string, offset = 0) => {
  if (!address || !/^0x[\da-f]+$/i.test(address)) return undefined
  try { return `0x${(BigInt(address) + BigInt(offset)).toString(16)}` } catch { return undefined }
}
const fieldNames = (range: MemoryRange) => new Set(range.fields.map((field) => field.name.replace(/^.*[.>]/, '')))
const layoutKind = (range: MemoryRange) => {
  if (range.pointer) return 'pointer'
  if (Array.isArray(range.value)) return range.value.some(Array.isArray) ? 'matrix' : range.fields.some((field) => field.pointer) ? 'adjacency-list' : 'sequence'
  const names = fieldNames(range)
  if (names.has('left') && names.has('right')) return 'tree-node'
  if (names.has('next')) return names.has('target') || names.has('to') ? 'adjacency-edge' : 'linked-node'
  if (names.has('neighbors') || names.has('edges')) return 'adjacency-list'
  if (range.fields.length > 0) return 'record'
  return 'scalar'
}
const kindName: Record<ReturnType<typeof layoutKind>, string> = {
  sequence: '连续数组', matrix: '二维数组（行优先）', record: '结构体',
  'linked-node': '链表节点', 'tree-node': '二叉树节点',
  'adjacency-edge': '邻接表边节点', 'adjacency-list': '邻接表入口',
  pointer: '指针变量', scalar: '普通变量',
}

function ArrayLayout({ range, targetLabels, onSelect }: { range: MemoryRange; targetLabels: Map<string, string>; onSelect?: (id: string) => void }) {
  const rows = Array.isArray(range.value) && range.value.some(Array.isArray) ? range.value as unknown[][] : [range.value as unknown[]]
  const count = rows.reduce((sum, row) => sum + row.length, 0)
  const elementSize = range.size && count ? range.size / count : undefined
  let linearIndex = 0
  return <div className="memory-array-layout">{rows.map((row, rowIndex) => <div className="memory-array-row" key={rowIndex}>
    {rows.length > 1 && <b>第 {rowIndex} 行</b>}
    {row.map((item, columnIndex) => {
      const index = linearIndex++
      const field = range.fields[index]
      const targetId = field?.pointer?.targetObjectId
      return <button type="button" key={columnIndex} className={field?.pointer ? 'is-pointer' : ''} onClick={(event) => { event.stopPropagation(); if (targetId) onSelect?.(targetId) }}><small>{rows.length > 1 ? `[${rowIndex}][${columnIndex}]` : `[${columnIndex}]`}</small><strong>{show(item)}</strong><code>{addressPlus(range.startAddress, elementSize ? index * elementSize : 0) ?? '地址未知'}{elementSize ? ` · ${elementSize}B` : ''}</code>{field?.pointer && <i>→ {targetId ? targetLabels.get(targetId) ?? targetId : field.pointer.status === 'null' ? 'NULL' : '目标未知'}</i>}</button>
    })}
  </div>)}</div>
}

function FieldLayout({ fields, totalSize, targetLabels, onSelect }: { fields: MemoryField[]; totalSize?: number; targetLabels: Map<string, string>; onSelect?: (id: string) => void }) {
  const ordered = [...fields].sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0))
  const cells: Array<{ kind: 'field'; field: MemoryField } | { kind: 'padding'; offset: number; size: number }> = []
  let cursor = 0
  ordered.forEach((field, index) => {
    const offset = field.offset ?? cursor
    if (offset > cursor) cells.push({ kind: 'padding', offset: cursor, size: offset - cursor })
    cells.push({ kind: 'field', field })
    const nextOffset = ordered[index + 1]?.offset
    cursor = offset + (field.size ?? (nextOffset !== undefined ? nextOffset - offset : 0))
  })
  if (totalSize !== undefined && cursor < totalSize) cells.push({ kind: 'padding', offset: cursor, size: totalSize - cursor })
  return <div className="memory-field-layout">{cells.map((cell, index) => cell.kind === 'padding'
    ? <span className="is-padding" key={`padding:${cell.offset}`}><small>padding · +{cell.offset}</small><strong>{cell.size}B</strong><code>对齐填充</code></span>
    : <button type="button" key={`${cell.field.name}:${cell.field.offset ?? index}`} className={cell.field.pointer ? `is-pointer status-${cell.field.pointer.status}` : ''} onClick={(event) => {
        event.stopPropagation()
        if (cell.field.pointer?.targetObjectId) onSelect?.(cell.field.pointer.targetObjectId)
      }}>
        <small>{cell.field.name} · +{cell.field.offset ?? '?'} · {cell.field.type}</small>
        <strong>{show(cell.field.value)}</strong>
        <code>{cell.field.address ?? '地址未知'}{cell.field.size !== undefined ? ` · ${cell.field.size}B` : ''}</code>
        {cell.field.pointer && <i>→ {cell.field.pointer.targetObjectId ? targetLabels.get(cell.field.pointer.targetObjectId) ?? cell.field.pointer.targetObjectId : cell.field.pointer.status === 'null' ? 'NULL' : '目标未知'}</i>}
      </button>)}</div>
}

function DetailedRange({ range, targetLabels, onSelect, onOpenStructure }: { range: MemoryRange; targetLabels: Map<string, string>; onSelect?: (id: string) => void; onOpenStructure?: (variableId: string) => void }) {
  const kind = layoutKind(range)
  return <article className={['memory-range', `layout-${kind}`, range.activeAccess ? `is-${range.activeAccess}` : '', range.status === 'freed' ? 'is-freed' : '', range.newlyAllocated ? 'is-new' : '', range.selected ? 'is-selected' : '', range.size === undefined || !range.startAddress ? 'is-unknown' : ''].filter(Boolean).join(' ')} onClick={() => onSelect?.(range.memoryObjectId)}>
    <header><span><strong>{range.label}</strong><small>{kindName[kind]}</small></span><code>{range.type ?? '未知类型'} · {range.size ?? '?'}B @ {range.startAddress ?? '地址未知'}</code>{onOpenStructure && range.variableId && (range.fields.length > 0 || Array.isArray(range.value) || range.pointer) && <button type="button" className="open-structure-button" onClick={(event) => { event.stopPropagation(); onOpenStructure(range.variableId!) }}>逻辑 + 内存</button>}</header>
    {!range.initialized
      ? <div className="memory-uninitialized">尚未执行声明或初始化；栈空间已经存在，但其中字节暂不解释为有效值。</div>
      : (kind === 'sequence' || kind === 'matrix' || kind === 'adjacency-list') && Array.isArray(range.value)
      ? <ArrayLayout range={range} targetLabels={targetLabels} onSelect={onSelect} />
      : kind === 'pointer'
        ? <div className="memory-scalar-layout"><strong>{show(range.value)}</strong>{range.pointer && <span><b>&amp;{range.label}</b> = {range.pointer.sourceAddress ?? range.startAddress ?? '未知'}<b>{range.label}</b> = {range.pointer.addressValue ?? '未知'}<b>*{range.label}</b> = {range.pointer.targetObjectId ? targetLabels.get(range.pointer.targetObjectId) ?? range.pointer.targetObjectId : range.pointer.status}</span>}</div>
      : range.fields.length > 0
        ? <FieldLayout fields={range.fields} totalSize={range.size} targetLabels={targetLabels} onSelect={onSelect} />
        : <div className="memory-scalar-layout"><strong>{show(range.value)}</strong>{range.pointer && <span><b>&amp;{range.label}</b> = {range.pointer.sourceAddress ?? range.startAddress ?? '未知'}<b>{range.label}</b> = {range.pointer.addressValue ?? '未知'}<b>*{range.label}</b> = {range.pointer.targetObjectId ?? range.pointer.status}</span>}</div>}
  </article>
}

export function MemoryLaneView({ model, compact = false, filterIds, onSelect, onOpenStructure }: { model: MemoryMapModel; compact?: boolean; filterIds?: ReadonlySet<string>; onSelect?: (id: string) => void; onOpenStructure?: (variableId: string) => void }) {
  const targetLabels = new Map(Object.values(model.lanes).flatMap((lane) => lane.ranges).map((range) => [range.memoryObjectId, range.label]))
  return <div className={`memory-lanes${compact ? ' is-compact' : ''}`}>{(Object.keys(model.lanes) as MemoryRegion[]).map((region) => {
    const lane = model.lanes[region]
    const ranges = filterIds ? lane.ranges.filter((range) => filterIds.has(range.memoryObjectId)) : lane.ranges
    const knownBytes = ranges.reduce((sum, range) => sum + (range.size ?? 0), 0)
    const discontinuities = new Map(lane.discontinuities.map((gap) => [gap.afterRangeId, gap]))
    return <section className="memory-lane" key={region}><header><strong>{regionNames[region]}</strong><span>{knownBytes} B 已采集 · 按真实地址从低到高</span></header><div className="memory-lane-track">
      {ranges.length === 0 ? <em>暂无已采集对象</em> : ranges.map((range) => <div className="memory-range-wrap" key={range.id}>
        {compact ? <button type="button" className={`memory-range compact-range ${range.activeAccess ? `is-${range.activeAccess}` : ''}`} onClick={() => onSelect?.(range.memoryObjectId)}><strong>{range.label}</strong></button> : <DetailedRange range={range} targetLabels={targetLabels} onSelect={onSelect} onOpenStructure={onOpenStructure} />}
        {discontinuities.has(range.id) && <span className="memory-gap">// +{discontinuities.get(range.id)?.gapBytes ?? '?'} B<br />未观察地址</span>}
      </div>)}
    </div></section>
  })}</div>
}
