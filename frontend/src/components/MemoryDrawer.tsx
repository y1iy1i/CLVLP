import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { currentComparison } from '../analysis/executionCursor'
import type { TraceVariable } from '../types/trace'
import type { VisualizationContext } from '../types/visualization'

interface MemoryDrawerProps {
  context: VisualizationContext | null
  onSourceSelect: (sourceNodeId: string) => void
  onVariableSelect: (variableId: string) => void
}

const OPEN_KEY = 'clvlp:memory-drawer:open:v1'
const WIDTH_KEY = 'clvlp:memory-drawer:width:v1'

const displayValue = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value)

export function MemoryDrawer({
  context,
  onSourceSelect,
  onVariableSelect,
}: MemoryDrawerProps) {
  const cursor = context?.execution.current ?? null
  const structure = context?.static.structure ?? null
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === 'true')
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(stored) && stored >= 250 ? stored : 310
  })
  const comparison = currentComparison(cursor)
  const waitingForInitialization = cursor?.traceStep.event.type === 'function_enter' &&
    cursor.traceStep.event.data.initial === true
  const changedIds = useMemo(
    () => new Set(cursor?.changes.map((change) => change.variableId) ?? []),
    [cursor],
  )
  const readIds = useMemo(
    () => new Set(comparison?.operands.flatMap((operand) => operand.variableId ? [operand.variableId] : []) ?? []),
    [comparison],
  )
  const comparedIndices = (variable: TraceVariable) => new Set(
    comparison?.operands.flatMap((operand) =>
      operand.variableId === variable.id ? operand.indices ?? [] : [],
    ) ?? [],
  )

  const toggle = () => {
    setOpen((current) => {
      localStorage.setItem(OPEN_KEY, String(!current))
      return !current
    })
  }

  const startResize = (event: ReactPointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = (moveEvent: PointerEvent) => {
      setWidth(Math.max(250, Math.min(420, startWidth + startX - moveEvent.clientX)))
    }
    const finish = (upEvent: PointerEvent) => {
      const nextWidth = Math.max(250, Math.min(420, startWidth + startX - upEvent.clientX))
      setWidth(nextWidth)
      localStorage.setItem(WIDTH_KEY, String(nextWidth))
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
  }

  const selectVariable = (variable: TraceVariable) => {
    onVariableSelect(variable.id)
    const candidates = structure?.nodes.filter(
      (node) => (node.kind === 'variable' || node.kind === 'parameter') && node.name === variable.name,
    ) ?? []
    const scoped = candidates.find((node) => {
      let parent = node.parentId ? structure?.nodes.find((candidate) => candidate.id === node.parentId) : undefined
      while (parent && parent.kind !== 'function') {
        parent = parent.parentId ? structure?.nodes.find((candidate) => candidate.id === parent?.parentId) : undefined
      }
      return parent?.name === variable.scope
    })
    const selected = scoped ?? candidates[0]
    if (selected) onSourceSelect(selected.id)
  }

  return (
    <aside
      className={`memory-drawer${open ? ' is-open' : ''}`}
      style={{ width: open ? `${width}px` : '36px' }}
      aria-label="常驻内存视图"
    >
      {open && <div className="memory-resize-handle" onPointerDown={startResize} />}
      <button className="memory-drawer-toggle" type="button" onClick={toggle}>
        <span>{open ? '›' : '‹'}</span>
        <strong>内存</strong>
      </button>
      {open && (
        <div className="memory-drawer-content">
          {!cursor ? (
            <div className="memory-empty">运行 Trace 后，这里会持续显示当前栈帧、变量和内存对象。</div>
          ) : (
            <>
              <section>
                <h3>调用栈</h3>
                <div className="memory-stack">
                  {cursor.callStack.map((frame, index) => (
                    <div key={frame.id} className={index === 0 ? 'is-current' : ''}>
                      <span>#{index}</span>
                      <strong>{frame.function}()</strong>
                      <small>{frame.variables.length} 个变量</small>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h3>当前栈帧</h3>
                {waitingForInitialization ? (
                  <div className="memory-section-empty">已进入函数，局部变量将在声明执行后出现。</div>
                ) : <div className="memory-variables">
                  {cursor.variables.map((variable) => {
                    const className = changedIds.has(variable.id)
                      ? 'is-written'
                      : readIds.has(variable.id)
                        ? 'is-read'
                        : ''
                    const indices = comparedIndices(variable)
                    const pointerTarget = variable.pointer?.targetObjectId
                      ? cursor.memory.objects.find((item) => item.id === variable.pointer?.targetObjectId)
                      : undefined
                    return (
                      <button key={variable.id} className={className} type="button" onClick={() => selectVariable(variable)}>
                        <span className="memory-variable-title">
                          <strong>{variable.name}</strong>
                          <small>{variable.type}</small>
                        </span>
                        {Array.isArray(variable.value) ? (
                          <span className="memory-array-cells">
                            {variable.value.map((value, index) => (
                              <i key={index} className={indices.has(index) ? 'is-compared' : ''}>
                                <small>[{index}]</small>{displayValue(value)}
                              </i>
                            ))}
                          </span>
                        ) : (
                          <code>{displayValue(variable.value)}</code>
                        )}
                        {variable.type.includes('*') && typeof variable.value === 'string' && (
                          <span className="memory-pointer">
                            → {variable.value} → {pointerTarget
                              ? `${pointerTarget.type} @ ${pointerTarget.address ?? '未知地址'}`
                              : variable.pointer?.status === 'null'
                                ? 'NULL'
                                : variable.pointer?.status === 'dangling'
                                  ? '已释放对象'
                                  : '目标未解析'}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>}
              </section>
              <section>
                <h3>堆与内存对象</h3>
                {cursor.memory.objects.length ? cursor.memory.objects.map((object) => (
                  <div className="memory-object" key={object.id}>
                    <strong>{object.type}</strong>
                    <code>{object.address ?? '逻辑对象'}</code>
                    <span>{displayValue(object.value)}</span>
                  </div>
                )) : <div className="memory-section-empty">当前 Trace 尚未采集堆对象</div>}
              </section>
              <div className="memory-legend">
                <span><i className="read" />本步读取</span>
                <span><i className="written" />本步写入</span>
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  )
}
