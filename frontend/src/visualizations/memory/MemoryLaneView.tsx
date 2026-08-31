import type { MemoryMapModel, MemoryRange, MemoryRegion } from '../../types/memoryMap'
import type { CSSProperties } from 'react'

const regionNames: Record<MemoryRegion, string> = { stack: '栈', global: '全局区', heap: '堆' }

const rangeTitle = (range: MemoryRange) => [
  range.label,
  range.startAddress ? `${range.startAddress} … ${range.endAddress ?? '?'}` : '地址未知',
  range.size === undefined ? '大小未知' : `${range.size} B`,
].join(' · ')

export function MemoryLaneView({
  model,
  compact = false,
  historyMode = false,
  filterIds,
  onSelect,
}: {
  model: MemoryMapModel
  compact?: boolean
  historyMode?: boolean
  filterIds?: ReadonlySet<string>
  onSelect?: (memoryObjectId: string) => void
}) {
  return (
    <div className={`memory-lanes${compact ? ' is-compact' : ''}`}>
      {(Object.keys(model.lanes) as MemoryRegion[]).map((region) => {
        const lane = model.lanes[region]
        const ranges = filterIds ? lane.ranges.filter((range) => filterIds.has(range.memoryObjectId)) : lane.ranges
        const knownBytes = ranges.reduce((sum, range) => sum + (range.size ?? 0), 0)
        const discontinuities = new Map(lane.discontinuities.map((gap) => [gap.afterRangeId, gap]))
        return (
          <section className="memory-lane" key={region}>
            <header>
              <strong>{regionNames[region]}</strong>
              <span>{knownBytes} B 已采集</span>
            </header>
            <div className="memory-lane-track">
              {ranges.length === 0 ? <em>暂无已采集对象</em> : ranges.map((range) => {
                const gap = discontinuities.get(range.id)
                const heat = Math.min(1, (range.readCount + range.writeCount) / 8)
                return (
                  <div className="memory-range-wrap" key={range.id} style={{ flexGrow: range.size ?? 1 }}>
                    <button
                      type="button"
                      title={rangeTitle(range)}
                      className={[
                        'memory-range',
                        range.activeAccess ? `is-${range.activeAccess}` : '',
                        range.status === 'freed' ? 'is-freed' : '',
                        range.newlyAllocated ? 'is-new' : '',
                        range.selected ? 'is-selected' : '',
                        range.size === undefined || !range.startAddress ? 'is-unknown' : '',
                      ].filter(Boolean).join(' ')}
                      style={historyMode ? {
                        '--read-heat': range.readCount ? Math.max(.18, heat) : 0,
                        '--write-heat': range.writeCount ? Math.max(.18, heat) : 0,
                      } as CSSProperties : undefined}
                      onClick={() => onSelect?.(range.memoryObjectId)}
                    >
                      <strong>{range.label}</strong>
                      {!compact && <><small>{range.size === undefined ? '? B' : `${range.size} B`}</small><code>{range.startAddress ?? '地址未知'}</code></>}
                      {historyMode && !compact && <i>读 {range.readCount} · 写 {range.writeCount}</i>}
                    </button>
                    {gap && <span className="memory-gap">// +{gap.gapBytes ?? '?'} B<br />未观察</span>}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
