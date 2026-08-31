import type { ExecutionTrace, RunStatus, TraceStep } from '../types/trace'
import { ArrayVisualizer } from '../visualizations/array/ArrayVisualizer'
import { currentComparison } from '../analysis/executionCursor'
import type { VisualizationContext } from '../types/visualization'

interface VisualPanelProps {
  trace?: ExecutionTrace
  error?: string
  context?: VisualizationContext | null
}

const statusLabels: Record<RunStatus, string> = {
  completed: '运行完成',
  compile_error: '编译失败',
  runtime_error: '运行错误',
  timeout: '执行超时',
  cancelled: '已取消',
}

const eventLabels: Record<string, string> = {
  line_executed: '程序已到达新位置',
  function_enter: '进入函数',
  function_exit: '函数返回',
  declare: '声明变量',
  update: '变量更新',
  out_of_scope: '变量离开作用域',
  output: '程序输出',
  runtime_signal: '运行时信号',
  compare: '比较元素',
  swap: '交换元素',
  visit_node: '访问节点',
  update_cell: '更新单元格',
}

const displayValue = (value: unknown) =>
  typeof value === 'string' ? `"${value}"` : JSON.stringify(value)

const variableShortName = (variableId: unknown) =>
  String(variableId ?? '').split(':').pop() ?? ''

const describeChange = (change: Record<string, unknown>): string => {
  const name = variableShortName(change.variableId)
  if (change.kind === 'declare') {
    return `声明 ${name} = ${displayValue(change.newValue)}`
  }
  if (change.kind === 'update') {
    return `${name}: ${displayValue(change.oldValue)} → ${displayValue(change.newValue)}`
  }
  if (change.kind === 'out_of_scope') {
    return `${name} 离开作用域`
  }
  return JSON.stringify(change)
}

const frameFunctions = (data: Record<string, unknown>): string[] => {
  const frames = Array.isArray(data.frames) ? data.frames : []
  return frames.map((frame) =>
    String((frame as Record<string, unknown>).function ?? ''),
  )
}

const eventSummary = (step: TraceStep): string => {
  const data = step.event.data
  switch (step.event.type) {
    case 'function_enter': {
      const names =
        typeof data.function === 'string' && !Array.isArray(data.frames)
          ? [data.function]
          : frameFunctions(data)
      return names.length > 0
        ? `进入 ${names.map((name) => `${name}()`).join('、')}`
        : ''
    }
    case 'function_exit': {
      const names = frameFunctions(data)
      return names.length > 0
        ? `${names.map((name) => `${name}()`).join('、')} 返回`
        : ''
    }
    case 'output': {
      const delta =
        typeof data.stdoutDelta === 'string' ? data.stdoutDelta : ''
      const stderrDelta =
        typeof data.stderrDelta === 'string' ? data.stderrDelta : ''
      if (delta) return `stdout 输出 ${JSON.stringify(delta)}`
      if (stderrDelta) return `stderr 输出 ${JSON.stringify(stderrDelta)}`
      return ''
    }
    case 'runtime_signal':
      return typeof data.signal === 'string' ? `收到信号 ${data.signal}` : ''
    default:
      return ''
  }
}

interface ChangeRecord extends Record<string, unknown> {
  kind?: string
  variableId?: string
}

export function VisualPanel({ trace, context, error }: VisualPanelProps) {
  const cursor = context?.execution.current ?? null
  const step = cursor?.traceStep
  const previousStep = context?.execution.previous?.traceStep
  const compileStderr =
    trace?.error?.details && typeof trace.error.details.stderr === 'string'
      ? trace.error.details.stderr
      : undefined

  if (!step) {
    return (
      <aside className="visual-panel">
        <div className="panel-heading">执行可视化</div>
        <div
          className={`empty-trace${error || trace?.error ? ' has-error' : ''}`}
        >
          <div className="empty-trace-mark">{error || trace?.error ? '!' : '▶'}</div>
          {trace?.error ? (
            <>
              <h2>{statusLabels[trace.status]}</h2>
              <p>{trace.error.message}</p>
              {compileStderr && (
                <pre className="empty-error-pre">{compileStderr}</pre>
              )}
            </>
          ) : (
            <>
              <h2>{error ? '运行请求失败' : '准备运行'}</h2>
              <p>
                {error ?? '点击 Run，编译当前代码并生成可逐步播放的执行轨迹。'}
              </p>
            </>
          )}
        </div>
      </aside>
    )
  }

  const changes = (step.event.data.changes ?? []) as ChangeRecord[]
  return (
    <aside className="visual-panel" aria-label="执行可视化">
      <div className="panel-heading visual-heading">
        <span>执行可视化</span>
        {trace && (
          <span className={`execution-status status-${trace.status}`}>
            {statusLabels[trace.status]}
          </span>
        )}
      </div>

      {trace?.summary.truncated && (
        <div className="truncated-hint">
          已达到最大步数（{trace.summary.totalSteps} 步），轨迹已截断
        </div>
      )}

      {trace?.error && (
        <section className="execution-error-card">
          <strong>{trace.error.type}</strong>
          <span>{trace.error.message}</span>
        </section>
      )}

      <ArrayVisualizer step={step} previousStep={previousStep} cursor={cursor} />

      {currentComparison(cursor) && (() => {
        const comparison = currentComparison(cursor)!
        return (
          <section className="visual-section comparison-card" aria-label="当前条件比较">
            <div className="section-label">正在比较</div>
            <code>{comparison.expression}</code>
            <div className="comparison-operands">
              {comparison.operands.map((operand) => (
                <div key={operand.role} className={`comparison-${operand.role}`}>
                  <span>{operand.expression}</span>
                  <strong>{operand.resolved ? displayValue(operand.value) : '暂不可解析'}</strong>
                </div>
              ))}
            </div>
            <div className={`comparison-result result-${String(comparison.result)}`}>
              {comparison.operands[0].resolved && comparison.operands[1].resolved
                ? `${displayValue(comparison.operands[0].value)} ${comparison.operator} ${displayValue(comparison.operands[1].value)} → ${comparison.result ? 'true' : 'false'}`
                : '等待 GDB 提供完整指针或内存信息'}
            </div>
          </section>
        )
      })()}

      <section className="visual-section event-card">
        <div className="section-label">当前事件</div>
        <div className="event-title">
          <span className="event-pulse" />
          {eventLabels[step.event.type] ?? step.event.type}
        </div>
        <div className="event-location">
          <strong>当前停在第 {step.location.line} 行</strong>
          {step.executedLocation &&
            step.executedLocation.file === step.location.file &&
            step.executedLocation.line !== step.location.line && (
              <span>第 {step.executedLocation.line} 行执行后产生当前状态</span>
            )}
        </div>
        {eventSummary(step) && (
          <div className="event-detail">{eventSummary(step)}</div>
        )}
        {changes.length > 0 && (
          <ul className="event-changes">
            {changes.map((change, index) => (
              <li key={`${change.variableId ?? index}-${index}`}>
                {describeChange(change)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="visual-section">
        <div className="section-label">调用栈</div>
        {step.state.callStack.map((frame, index) => (
          <div className="stack-frame" key={frame.id}>
            <span className="stack-index">#{index}</span>
            <span>{frame.function}()</span>
            <span className="stack-count">{frame.variables.length} 个变量</span>
          </div>
        ))}
      </section>

      <section className="visual-section output-section">
        <div className="section-label">程序输出</div>
        <pre className="terminal-output">
          {step.output.stderr || step.output.stdout || '暂无输出'}
        </pre>
      </section>
    </aside>
  )
}
