import { useState } from 'react'
import { CodeEditor } from './components/CodeEditor'
import { FileExplorer } from './components/FileExplorer'
import { VisualPanel } from './components/VisualPanel'
import { starterCode } from './mocks/mockTrace'
import { runCode } from './services/runCode'
import type { ExecutionTrace } from './types/trace'
import './App.css'

function App() {
  const [code, setCode] = useState(starterCode)
  const [executionTrace, setExecutionTrace] = useState<ExecutionTrace | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)

  const currentStep =
    currentStepIndex === null ? undefined : executionTrace?.trace[currentStepIndex]
  const hasStarted = currentStepIndex !== null
  const isFirstStep = currentStepIndex === 0
  const isLastStep =
    currentStepIndex !== null &&
    currentStepIndex === (executionTrace?.trace.length ?? 0) - 1

  const runTrace = async () => {
    setIsRunning(true)
    setRunError(null)
    setExecutionTrace(null)
    setCurrentStepIndex(null)

    try {
      const result = await runCode(code)
      setExecutionTrace(result)
      setCurrentStepIndex(result.trace.length > 0 ? 0 : null)
    } catch (error) {
      setRunError(error instanceof Error ? error.message : '未知运行错误')
    } finally {
      setIsRunning(false)
    }
  }

  const previousStep = () =>
    setCurrentStepIndex((index) => (index === null ? 0 : Math.max(0, index - 1)))
  const nextStep = () =>
    setCurrentStepIndex((index) =>
      index === null
        ? 0
        : Math.min((executionTrace?.trace.length ?? 1) - 1, index + 1),
    )

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="C Language Visual Learning Platform">
          <span className="brand-mark">C/</span>
          <div>
            <strong>CLVLP</strong>
            <span>Visual C Lab</span>
          </div>
        </div>

        <div className="file-context">
          <span className="context-muted">workspace</span>
          <span>/</span>
          <span>main.c</span>
          <span className="unsaved-dot" title="本地示例" />
        </div>

        <div className="run-controls">
          <button
            className="icon-button"
            type="button"
            onClick={previousStep}
            disabled={!hasStarted || isFirstStep}
            aria-label="上一步"
            title="上一步"
          >
            ‹
          </button>
          <div className="step-indicator" aria-live="polite">
            {hasStarted
              ? `${currentStepIndex! + 1} / ${executionTrace?.trace.length ?? 0}`
              : '— / —'}
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={nextStep}
            disabled={!hasStarted || isLastStep}
            aria-label="下一步"
            title="下一步"
          >
            ›
          </button>
          <button
            className="run-button"
            type="button"
            onClick={runTrace}
            disabled={isRunning}
          >
            <span>{isRunning ? '◌' : '▶'}</span>
            {isRunning ? 'Running' : 'Run'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <FileExplorer fileName="main.c" />
        <section className="editor-panel" aria-label="代码编辑器">
          <div className="editor-tabbar">
            <div className="editor-tab active">
              <span className="c-file-icon">C</span>
              <span>main.c</span>
              <span className="tab-close">×</span>
            </div>
          </div>
          <div className="editor-surface">
            <CodeEditor
              code={code}
              currentLine={currentStep?.location.line}
              onChange={setCode}
            />
          </div>
        </section>
        <VisualPanel step={currentStep} error={runError ?? undefined} />
      </div>

      <footer className="statusbar">
        <div>
          <span className="status-ready" />
          {isRunning
            ? 'Connecting to FastAPI…'
            : hasStarted
              ? `Trace ${executionTrace?.status}`
              : runError
                ? 'Backend unavailable'
                : 'Ready'}
        </div>
        <div className="status-items">
          <span>Ln {currentStep?.location.line ?? 1}</span>
          <span>UTF-8</span>
          <span>C</span>
          <span>Trace v{executionTrace?.schemaVersion ?? '1.0'}</span>
        </div>
      </footer>
    </main>
  )
}

export default App
