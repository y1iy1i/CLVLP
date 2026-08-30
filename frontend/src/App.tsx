import { useCallback, useEffect, useMemo, useState } from 'react'
import { matchTraceLocation } from './analysis/flowGraphBuilder'
import { useCodeStructure } from './analysis/useCodeStructure'
import { CodeEditor } from './components/CodeEditor'
import { ExecutionPanel } from './components/ExecutionPanel'
import { FileExplorer } from './components/FileExplorer'
import { VisualPanel } from './components/VisualPanel'
import { StructureWorkspace } from './components/StructureWorkspace'
import { starterCode } from './mocks/mockTrace'
import { executeCode } from './services/executeCode'
import { runCode } from './services/runCode'
import type { ExecutionResult } from './types/execution'
import type { SourceRange } from './types/codeStructure'
import type { ExecutionTrace } from './types/trace'
import './App.css'

type RunMode = 'trace' | 'execute'
type RightView = 'runtime' | 'structure'

function App() {
  const [code, setCode] = useState(starterCode)
  const [runMode, setRunMode] = useState<RunMode>('trace')
  const [executionTrace, setExecutionTrace] = useState<ExecutionTrace | null>(null)
  const [executionResult, setExecutionResult] = useState<ExecutionResult | null>(null)
  const [currentStepIndex, setCurrentStepIndex] = useState<number | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [rightView, setRightView] = useState<RightView>('runtime')
  const [selectedStructureRange, setSelectedStructureRange] = useState<SourceRange | null>(null)
  const [followExecution, setFollowExecution] = useState(true)
  const { structure, phase: structurePhase } = useCodeStructure(code)

  const currentStep =
    currentStepIndex === null ? undefined : executionTrace?.trace[currentStepIndex]
  const previousTraceStep =
    currentStepIndex === null || currentStepIndex === 0
      ? undefined
      : executionTrace?.trace[currentStepIndex - 1]
  const hasStarted = runMode === 'trace' && currentStepIndex !== null
  const isFirstStep = currentStepIndex === 0
  const isLastStep =
    currentStepIndex !== null &&
    currentStepIndex === (executionTrace?.trace.length ?? 0) - 1
  const traceMatch = useMemo(
    () => currentStep
      ? matchTraceLocation(structure, currentStep.location.file, currentStep.location.line)
      : { currentNodeId: null, ancestorIds: [], functionId: null },
    [currentStep, structure],
  )

  const selectStructureNode = useCallback((sourceNodeId: string) => {
    const node = structure?.nodes.find((candidate) => candidate.id === sourceNodeId)
    if (node) setSelectedStructureRange(node.range)
  }, [structure])

  useEffect(() => {
    if (!isPlaying) return
    const timer = window.setInterval(() => {
      setCurrentStepIndex((index) => {
        if (index === null) return 0
        const last = (executionTrace?.trace.length ?? 1) - 1
        return index >= last ? index : index + 1
      })
    }, 700)
    return () => window.clearInterval(timer)
  }, [isPlaying, executionTrace])

  useEffect(() => {
    if (isPlaying && isLastStep) setIsPlaying(false)
  }, [isPlaying, isLastStep])

  const changeMode = (mode: RunMode) => {
    if (isRunning || mode === runMode) return
    setRunMode(mode)
    setExecutionTrace(null)
    setExecutionResult(null)
    setCurrentStepIndex(null)
    setRunError(null)
    setIsPlaying(false)
  }

  const runCurrentMode = async () => {
    setIsRunning(true)
    setRunError(null)
    setExecutionTrace(null)
    setExecutionResult(null)
    setCurrentStepIndex(null)
    setIsPlaying(false)

    try {
      if (runMode === 'trace') {
        const result = await runCode(code)
        setExecutionTrace(result)
        setCurrentStepIndex(result.trace.length > 0 ? 0 : null)
      } else {
        setExecutionResult(await executeCode(code))
      }
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

  const statusText = isRunning
    ? runMode === 'trace'
      ? '正在生成运行轨迹…'
      : '正在 Docker 中编译运行…'
    : runError
      ? '后端不可用'
      : runMode === 'trace' && executionTrace
        ? `Trace ${executionTrace.status}`
        : runMode === 'execute' && executionResult
          ? `Execution ${executionResult.status}`
          : '就绪'

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

        <div className="center-toolbar">
          <div className="file-context">
            <span className="context-muted">workspace</span>
            <span>/</span>
            <span>main.c</span>
            <span className="unsaved-dot" title="本地示例" />
          </div>
          <div className="mode-switch" role="group" aria-label="运行模式">
            <button
              type="button"
              className={runMode === 'trace' ? 'active' : ''}
              onClick={() => changeMode('trace')}
              disabled={isRunning}
            >
              Trace 追踪
            </button>
            <button
              type="button"
              className={runMode === 'execute' ? 'active' : ''}
              onClick={() => changeMode('execute')}
              disabled={isRunning}
            >
              真实运行
            </button>
          </div>
        </div>

        <div className="run-controls">
          {runMode === 'trace' ? (
            <>
              <button
                className="icon-button"
                type="button"
                onClick={() => setIsPlaying((playing) => !playing)}
                disabled={!executionTrace || executionTrace.trace.length === 0}
                aria-label={isPlaying ? '暂停播放' : '自动播放'}
                title={isPlaying ? '暂停播放' : '自动播放'}
              >
                {isPlaying ? '❚❚' : '▶'}
              </button>
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
            </>
          ) : (
            <span className="docker-mode-badge">Docker</span>
          )}
          <button
            className="run-button"
            type="button"
            onClick={runCurrentMode}
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
              currentLine={runMode === 'trace' ? currentStep?.location.line : undefined}
              executedLine={runMode === 'trace' ? currentStep?.executedLocation?.line : undefined}
              selectedRange={selectedStructureRange}
              onChange={setCode}
            />
          </div>
        </section>
        <aside className="right-dock">
          <header className="right-dock-tabs">
            <div role="group" aria-label="右侧可视化模式">
              <button
                type="button"
                className={rightView === 'runtime' ? 'active' : ''}
                onClick={() => setRightView('runtime')}
              >运行可视化</button>
              <button
                type="button"
                className={rightView === 'structure' ? 'active' : ''}
                onClick={() => setRightView('structure')}
              >代码结构</button>
            </div>
          </header>
          <div className="right-dock-content">
            {rightView === 'structure' ? (
              <StructureWorkspace
                structure={structure}
                phase={structurePhase}
                activeSourceNodeId={traceMatch.currentNodeId}
                ancestorSourceNodeIds={traceMatch.ancestorIds}
                followFunctionId={traceMatch.functionId}
                followExecution={followExecution}
                onFollowExecutionChange={setFollowExecution}
                onSourceSelect={selectStructureNode}
              />
            ) : runMode === 'trace' ? (
              <VisualPanel
                trace={executionTrace ?? undefined}
                step={currentStep}
                previousStep={previousTraceStep}
                error={runError ?? undefined}
              />
            ) : (
              <ExecutionPanel
                result={executionResult ?? undefined}
                error={runError ?? undefined}
                isRunning={isRunning}
              />
            )}
          </div>
        </aside>
      </div>

      <footer className="statusbar">
        <div>
          <span className="status-ready" />
          {statusText}
        </div>
        <div className="status-items">
          <span>Ln {runMode === 'trace' ? currentStep?.location.line ?? 1 : 1}</span>
          <span>UTF-8</span>
          <span>C11</span>
          <span>
            {runMode === 'trace'
              ? `Trace v${executionTrace?.schemaVersion ?? '1.0'}`
              : 'Docker GCC 13.4'}
          </span>
        </div>
      </footer>
    </main>
  )
}

export default App
