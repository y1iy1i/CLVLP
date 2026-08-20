import type { TraceStep } from '../types/trace'

interface VisualPanelProps {
  step?: TraceStep
  error?: string
}

const displayValue = (value: unknown) =>
  typeof value === 'string' ? `"${value}"` : JSON.stringify(value)

export function VisualPanel({ step, error }: VisualPanelProps) {
  if (!step) {
    return (
      <aside className="visual-panel">
        <div className="panel-heading">执行可视化</div>
        <div className={`empty-trace${error ? ' has-error' : ''}`}>
          <div className="empty-trace-mark">{error ? '!' : '▶'}</div>
          <h2>{error ? '运行请求失败' : '准备运行'}</h2>
          <p>{error ?? '点击顶部 Run，由 FastAPI 返回模拟 Trace。'}</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="visual-panel" aria-label="执行可视化">
      <div className="panel-heading visual-heading">
        <span>执行可视化</span>
        <span className="line-pill">第 {step.location.line} 行</span>
      </div>

      <section className="visual-section event-card">
        <div className="section-label">当前事件</div>
        <div className="event-title">
          <span className="event-pulse" />
          {step.event.type}
        </div>
        <pre>{JSON.stringify(step.event.data, null, 2)}</pre>
      </section>

      <section className="visual-section">
        <div className="section-label">变量状态</div>
        {step.state.variables.length > 0 ? (
          <div className="variable-table">
            <div className="variable-row variable-header">
              <span>名称</span>
              <span>类型</span>
              <span>值</span>
            </div>
            {step.state.variables.map((variable) => (
              <div className="variable-row" key={variable.id}>
                <span className="variable-name">{variable.name}</span>
                <span className="variable-type">{variable.type}</span>
                <span className="variable-value">{displayValue(variable.value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="section-empty">还没有局部变量</div>
        )}
      </section>

      <section className="visual-section">
        <div className="section-label">调用栈</div>
        {step.state.callStack.map((frame, index) => (
          <div className="stack-frame" key={`${frame.function}-${index}`}>
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
