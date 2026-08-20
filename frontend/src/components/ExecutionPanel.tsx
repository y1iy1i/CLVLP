import type { ExecutionResult } from '../types/execution'

interface ExecutionPanelProps {
  result?: ExecutionResult
  error?: string
  isRunning: boolean
}

const statusLabels = {
  completed: '运行完成',
  compile_error: '编译失败',
  runtime_error: '运行错误',
  timeout: '执行超时',
}

const emptyOutput = '（无输出）'

export function ExecutionPanel({
  result,
  error,
  isRunning,
}: ExecutionPanelProps) {
  if (!result) {
    return (
      <aside className="visual-panel" aria-label="真实执行结果">
        <div className="panel-heading">真实执行</div>
        <div className={`empty-trace${error ? ' has-error' : ''}`}>
          <div className={`empty-trace-mark${isRunning ? ' is-running' : ''}`}>
            {error ? '!' : isRunning ? '◌' : '⌁'}
          </div>
          <h2>{error ? 'Docker 执行失败' : isRunning ? '正在编译运行' : '真实 C 运行'}</h2>
          <p>
            {error ??
              (isRunning
                ? '代码正在隔离容器中编译，请稍候。'
                : '点击 Run，在受限 Docker 容器中真实编译并运行当前代码。')}
          </p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="visual-panel" aria-label="真实执行结果">
      <div className="panel-heading visual-heading">
        <span>真实执行</span>
        <span className={`execution-status status-${result.status}`}>
          {statusLabels[result.status]}
        </span>
      </div>

      <section className="visual-section execution-summary">
        <div className="execution-metric">
          <span>编译器</span>
          <strong>GCC · C11</strong>
        </div>
        <div className="execution-metric">
          <span>退出码</span>
          <strong>{result.exitCode ?? '—'}</strong>
        </div>
        <div className="execution-metric">
          <span>耗时</span>
          <strong>{result.durationMs} ms</strong>
        </div>
      </section>

      {result.error && (
        <section className="execution-error-card">
          <strong>{result.error.type}</strong>
          <span>{result.error.message}</span>
        </section>
      )}

      <section className="visual-section">
        <div className="section-label output-label-row">
          <span>标准输出 stdout</span>
          {result.outputTruncated.stdout && <span>已截断</span>}
        </div>
        <pre className="terminal-output execution-output">
          {result.stdout || emptyOutput}
        </pre>
      </section>

      <section className="visual-section">
        <div className="section-label output-label-row">
          <span>错误输出 stderr</span>
          {result.outputTruncated.stderr && <span>已截断</span>}
        </div>
        <pre className={`terminal-output execution-output${result.stderr ? ' has-stderr' : ''}`}>
          {result.stderr || emptyOutput}
        </pre>
      </section>

      <section className="visual-section">
        <div className="section-label">Docker 沙箱限制</div>
        <div className="limits-grid">
          <span>网络<strong>禁用</strong></span>
          <span>内存<strong>{result.limits.memoryMegabytes} MB</strong></span>
          <span>CPU<strong>{result.limits.cpuCount} 核</strong></span>
          <span>运行<strong>{result.limits.runTimeoutSeconds} 秒</strong></span>
          <span>进程<strong>{result.limits.processLimit}</strong></span>
          <span>输出<strong>{result.limits.maxOutputBytes / 1024} KB</strong></span>
        </div>
      </section>
    </aside>
  )
}
