import { useMemo, useState } from 'react'
import type { MemoryField, TraceVariable } from '../../types/trace'
import type { VisualizationModuleProps } from '../registry'
import {
  buildVariableInspectorGroups,
  type VariableHistoryPoint,
  type VariableInspectorItem,
} from './variableInspectorModel'
import './variables.css'

const activityLabels = {
  declare: '新声明',
  read: '读取',
  write: '已写入',
  out_of_scope: '离开作用域',
  unavailable: '不可用',
  idle: '',
}

const displayValue = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value === undefined) return '—'
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const sameValue = (left: unknown, right: unknown) => displayValue(left) === displayValue(right)

const sparklineSegments = (history: VariableHistoryPoint[]) => {
  const values = history.flatMap((point) => point.value === undefined ? [] : [point.value])
  if (values.length < 2) return []
  const minimum = Math.min(...values)
  const maximum = Math.max(...values)
  const span = maximum - minimum || 1
  const denominator = Math.max(1, history.length - 1)
  const segments: string[][] = []
  let current: string[] = []
  history.forEach((point, index) => {
    if (point.value === undefined) {
      if (current.length > 0) segments.push(current)
      current = []
      return
    }
    const x = (index / denominator) * 100
    const y = 25 - ((point.value - minimum) / span) * 20
    current.push(`${x},${y}`)
  })
  if (current.length > 0) segments.push(current)
  return segments
}

function Sparkline({ history }: { history: VariableHistoryPoint[] }) {
  const segments = sparklineSegments(history)
  if (segments.length === 0) return null
  return (
    <svg className="variable-sparkline" viewBox="0 0 100 30" preserveAspectRatio="none" aria-label="最近 20 步数值趋势">
      <line x1="0" y1="26" x2="100" y2="26" />
      {segments.map((points, index) => (
        <polyline key={`${index}-${points[0]}`} points={points.join(' ')} />
      ))}
    </svg>
  )
}

function FieldTree({ fields }: { fields: MemoryField[] }) {
  return (
    <div className="variable-field-tree">
      {fields.map((field) => (
        <div key={`${field.name}:${field.offset ?? ''}`}>
          <span><strong>{field.name}</strong><small>{field.type}</small></span>
          <code>{displayValue(field.value)}</code>
          {field.fields.length > 0 && <FieldTree fields={field.fields} />}
        </div>
      ))}
    </div>
  )
}

function ComplexValue({ variable }: { variable: TraceVariable }) {
  if (Array.isArray(variable.value)) {
    const visible = variable.value.slice(0, 100)
    return (
      <details className="variable-complex-value">
        <summary>查看 {variable.value.length} 个数组元素</summary>
        <div className="variable-array-grid">
          {visible.map((value, index) => <span key={index}><small>[{index}]</small><code>{displayValue(value)}</code></span>)}
        </div>
        {visible.length < variable.value.length && <em>仅显示前 100 项</em>}
      </details>
    )
  }
  if (variable.fields?.length) {
    return (
      <details className="variable-complex-value">
        <summary>查看结构体字段</summary>
        <FieldTree fields={variable.fields} />
      </details>
    )
  }
  return null
}

function VariableCard({
  item,
  selected,
  pinned,
  onSelect,
  onPin,
  onTargetSelect,
}: {
  item: VariableInspectorItem
  selected: boolean
  pinned: boolean
  onSelect: () => void
  onPin: () => void
  onTargetSelect: (memoryObjectId: string) => void
}) {
  const { variable, activity } = item
  const pointer = variable.pointer
  const changed = item.previousValue !== undefined && !sameValue(item.previousValue, variable.value)
  return (
    <article className={`variable-card activity-${activity}${selected ? ' is-selected' : ''}`}>
      <header>
        <button type="button" className="variable-card-main" onClick={onSelect}>
          <span><strong>{variable.name}</strong><small>{variable.type}</small></span>
          <code>{displayValue(variable.value)}</code>
        </button>
        <button type="button" className={`variable-pin${pinned ? ' is-pinned' : ''}`} onClick={onPin} title={pinned ? '取消固定' : '固定变量'}>◆</button>
      </header>
      <div className="variable-card-meta">
        {activityLabels[activity] && <span className="variable-activity">{activityLabels[activity]}</span>}
        <span>{variable.scope}</span>
        <span>{variable.storage?.region ?? '未知存储区'}</span>
        {variable.storage?.address && <code>{variable.storage.address}</code>}
      </div>
      {changed && (
        <div className="variable-change"><code>{displayValue(item.previousValue)}</code><span>→</span><code>{displayValue(variable.value)}</code></div>
      )}
      {variable.available === false && <div className="variable-warning">{variable.storage?.unavailableReason ?? '当前值不可读取'}</div>}
      {pointer && (
        <div className={`variable-pointer status-${pointer.status}`}>
          <span>{pointer.addressValue ?? '未知地址'} → {pointer.status}</span>
          {pointer.targetObjectId && (
            <button type="button" onClick={() => onTargetSelect(pointer.targetObjectId!)}>查看目标</button>
          )}
        </div>
      )}
      <ComplexValue variable={variable} />
      {typeof variable.value === 'number' ? (
        <Sparkline history={item.history} />
      ) : item.recentValues.length > 1 ? (
        <div className="variable-recent-values">
          {item.recentValues.map((value, index) => <code key={`${index}:${displayValue(value)}`}>{displayValue(value)}</code>)}
        </div>
      ) : null}
    </article>
  )
}

export function VariableInspector({ context, actions }: VisualizationModuleProps) {
  const groups = useMemo(() => buildVariableInspectorGroups(context), [context])
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({})
  const [pinState, setPinState] = useState<{ runId: string; ids: string[] }>({ runId: '', ids: [] })
  const runId = context.execution.runId ?? 'current-run'
  const pinnedIds = pinState.runId === runId ? pinState.ids : []
  const allItems = groups.flatMap((group) => group.items)
  const pinnedItems = pinnedIds.flatMap((id) => {
    const item = allItems.find((candidate) => candidate.variable.id === id)
    return item ? [item] : []
  })

  const togglePin = (variableId: string) => setPinState((current) => {
    const ids = current.runId === runId ? current.ids : []
    return {
      runId,
      ids: ids.includes(variableId) ? ids.filter((id) => id !== variableId) : [...ids, variableId],
    }
  })

  const renderItem = (item: VariableInspectorItem) => (
    <VariableCard
      key={item.variable.id}
      item={item}
      selected={context.selection.variableId === item.variable.id}
      pinned={pinnedIds.includes(item.variable.id)}
      onSelect={() => actions.selectVariable(item.variable.id)}
      onPin={() => togglePin(item.variable.id)}
      onTargetSelect={actions.selectMemoryObject}
    />
  )

  if (!context.execution.current) {
    return <div className="variable-inspector-empty"><strong>还没有运行数据</strong><span>点击 Run 后，这里会显示变量的实时变化。</span></div>
  }

  return (
    <div className="variable-inspector">
      <header className="variable-inspector-summary">
        <span>{allItems.length} 个可见变量</span>
        <span>最近 20 步</span>
      </header>
      {pinnedItems.length > 0 && (
        <section className="variable-group pinned-variables">
          <h3>固定关注</h3>
          <div>{pinnedItems.map(renderItem)}</div>
        </section>
      )}
      {groups.map((group) => {
        const expanded = groupOverrides[group.id] ?? group.defaultExpanded
        return (
          <section className={`variable-group${group.current ? ' is-current' : ''}`} key={group.id}>
            <button type="button" className="variable-group-heading" onClick={() =>
              setGroupOverrides((current) => ({ ...current, [group.id]: !expanded }))
            }>
              <span>{expanded ? '⌄' : '›'}</span>
              <strong>{group.title}</strong>
              <small>{group.items.length}</small>
            </button>
            {expanded && <div>{group.items.length > 0 ? group.items.map(renderItem) : <em>局部变量尚未初始化</em>}</div>}
          </section>
        )
      })}
    </div>
  )
}
