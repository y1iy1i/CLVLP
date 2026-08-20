import { useState } from 'react'
import { CodeEditor } from './components/CodeEditor'
import { FileExplorer } from './components/FileExplorer'
import { VisualPanel } from './components/VisualPanel'
import { mockTrace, starterCode } from './mocks/mockTrace'
import './App.css'

function App() {
  const [code, setCode] = useState(starterCode)
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null)

  const currentStep =
    currentStepIndex === null ? undefined : mockTrace.trace[currentStepIndex]
  const hasStarted = currentStepIndex !== null
  const isFirstStep = currentStepIndex === 0
  const isLastStep = currentStepIndex === mockTrace.trace.length - 1

  const runTrace = () => setCurrentStepIndex(0)
  const previousStep = () =>
    setCurrentStepIndex((index) => (index === null ? 0 : Math.max(0, index - 1)))
  const nextStep = () =>
    setCurrentStepIndex((index) =>
      index === null ? 0 : Math.min(mockTrace.trace.length - 1, index + 1),
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
            {hasStarted ? `${currentStepIndex! + 1} / ${mockTrace.trace.length}` : '— / —'}
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
          <button className="run-button" type="button" onClick={runTrace}>
            <span>▶</span>
            Run
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
        <VisualPanel step={currentStep} />
      </div>

      <footer className="statusbar">
        <div>
          <span className="status-ready" />
          {hasStarted ? `Trace ${mockTrace.status}` : 'Ready'}
        </div>
        <div className="status-items">
          <span>Ln {currentStep?.location.line ?? 1}</span>
          <span>UTF-8</span>
          <span>C</span>
          <span>Trace v{mockTrace.schemaVersion}</span>
        </div>
      </footer>
    </main>
  )
}

export default App
