import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildExecutionCursor } from './analysis/executionCursor'
import { buildAllFlowGraphs } from './analysis/flowGraphBuilder'
import { buildVisualizationContext } from './analysis/visualizationContext'
import { useCodeStructure } from './analysis/useCodeStructure'
import { useProgramMap } from './analysis/useProgramMap'
import { CodeEditor } from './components/CodeEditor'
import { ExecutionPanel } from './components/ExecutionPanel'
import { FileExplorer } from './components/FileExplorer'
import { VisualPanel } from './components/VisualPanel'
import { StructureWorkspace } from './components/StructureWorkspace'
import { MemoryDrawer } from './components/MemoryDrawer'
import {
  VisualizationWorkspace,
  type VisualizationWorkspaceHandle,
} from './components/VisualizationWorkspace'
import { codeExamples, starterCode, type CodeExample } from './mocks/codeExamples'
import { executeCode } from './services/executeCode'
import { runCode } from './services/runCode'
import type { ExecutionResult } from './types/execution'
import type { SourceRange } from './types/codeStructure'
import type { ExecutionTrace } from './types/trace'
import type { TeachingMode, VisualizationContext } from './types/visualization'
import './App.css'

type RunMode = 'trace' | 'execute'
type RightView = 'runtime' | 'structure'

function App() {
  const visualizationWorkspaceRef = useRef<VisualizationWorkspaceHandle | null>(null)
  const [code, setCode] = useState(starterCode)
  const [activeExampleId, setActiveExampleId] = useState(codeExamples[0].id)
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
  const [teachingMode] = useState<TeachingMode>('beginner')
  const [selectedSourceNodeId, setSelectedSourceNodeId] = useState<string>()
  const [selectedVariableId, setSelectedVariableId] = useState<string>()
  const [selectedMemoryObjectId, setSelectedMemoryObjectId] = useState<string>()
  const { structure, phase: structurePhase } = useCodeStructure(code)
  const programMap = useProgramMap(code, structure)

  const currentStep =
    currentStepIndex === null ? undefined : executionTrace?.trace[currentStepIndex]
  const hasStarted = runMode === 'trace' && currentStepIndex !== null
  const isFirstStep = currentStepIndex === 0
  const isLastStep =
    currentStepIndex !== null &&
    currentStepIndex === (executionTrace?.trace.length ?? 0) - 1
  const cursorHistory = useMemo(() => executionTrace?.trace.flatMap((step, index, trace) => {
    const built = buildExecutionCursor(structure, step, trace[index - 1], programMap)
    return built ? [built] : []
  }) ?? [], [executionTrace, programMap, structure])
  const cursor = currentStepIndex === null ? null : cursorHistory[currentStepIndex] ?? null
  const visualizationGraphs = useMemo(
    () => structure ? buildAllFlowGraphs(structure) : null,
    [structure],
  )
  const visualizationContext = useMemo<VisualizationContext | null>(() => {
    if (!structure || !visualizationGraphs) return null
    return buildVisualizationContext({
      code,
      entryFile: 'main.c',
      structure,
      programMap,
      callGraph: visualizationGraphs.callGraph,
      functionGraphs: visualizationGraphs.functionGraphs,
      trace: executionTrace,
      isRunning,
      history: cursorHistory,
      currentIndex: currentStepIndex,
      selection: {
        sourceNodeId: selectedSourceNodeId,
        functionId: cursor?.functionId,
        variableId: selectedVariableId,
        memoryObjectId: selectedMemoryObjectId,
      },
      teachingMode,
      followExecution,
    })
  }, [
    code,
    currentStepIndex,
    cursor?.functionId,
    cursorHistory,
    executionTrace,
    followExecution,
    isRunning,
    programMap,
    selectedMemoryObjectId,
    selectedSourceNodeId,
    selectedVariableId,
    structure,
    teachingMode,
    visualizationGraphs,
  ])
  const selectStructureNode = useCallback((sourceNodeId: string) => {
    setSelectedSourceNodeId(sourceNodeId)
    const node = structure?.nodes.find((candidate) => candidate.id === sourceNodeId)
    if (node) setSelectedStructureRange(node.range)
  }, [structure])

  const selectVariable = useCallback((variableId: string) => {
    setSelectedVariableId(variableId)
    const variable = cursor?.variables.find((candidate) => candidate.id === variableId)
    if (!variable || !structure) return
    const candidates = structure.nodes.filter(
      (node) => (node.kind === 'variable' || node.kind === 'parameter') && node.name === variable.name,
    )
    const scoped = candidates.find((node) => {
      let parent = node.parentId
        ? structure.nodes.find((candidate) => candidate.id === node.parentId)
        : undefined
      while (parent && parent.kind !== 'function') {
        parent = parent.parentId
          ? structure.nodes.find((candidate) => candidate.id === parent?.parentId)
          : undefined
      }
      return parent?.name === variable.scope
    })
    const selected = scoped ?? candidates[0]
    if (selected) selectStructureNode(selected.id)
  }, [cursor, selectStructureNode, structure])

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

  const loadExample = (example: CodeExample) => {
    setCode(example.code)
    setActiveExampleId(example.id)
    setExecutionTrace(null)
    setExecutionResult(null)
    setCurrentStepIndex(null)
    setRunError(null)
    setIsPlaying(false)
    setSelectedSourceNodeId(undefined)
    setSelectedVariableId(undefined)
    setSelectedMemoryObjectId(undefined)
    setSelectedStructureRange(null)
  }

  const editCode = (nextCode: string) => {
    setCode(nextCode)
    setActiveExampleId('custom')
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
        <FileExplorer
          fileName="main.c"
          examples={codeExamples}
          activeExampleId={activeExampleId}
          onExampleSelect={loadExample}
        />
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
              onChange={editCode}
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
          <div className="right-dock-body">
          <div className="right-dock-content">
            {rightView === 'structure' ? (
              <StructureWorkspace
                structure={structure}
                context={visualizationContext}
                phase={structurePhase}
                followExecution={followExecution}
                onFollowExecutionChange={setFollowExecution}
                onSourceSelect={selectStructureNode}
                onOpenVisualization={(moduleId, scope) =>
                  visualizationWorkspaceRef.current?.openVisualization(moduleId, scope)
                }
              />
            ) : runMode === 'trace' ? (
              <VisualPanel
                trace={executionTrace ?? undefined}
                context={visualizationContext}
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
          <MemoryDrawer
            context={runMode === 'trace' ? visualizationContext : null}
            onSourceSelect={selectStructureNode}
            onVariableSelect={selectVariable}
            onMemoryObjectClear={() => setSelectedMemoryObjectId(undefined)}
            onMemoryObjectSelect={setSelectedMemoryObjectId}
            onOpenMemoryGraph={() => visualizationWorkspaceRef.current?.openVisualization('memory-graph')}
          />
          <VisualizationWorkspace
            ref={visualizationWorkspaceRef}
            context={visualizationContext}
            structure={structure}
            onSourceSelect={selectStructureNode}
            onSeekStep={setCurrentStepIndex}
            onVariableSelect={selectVariable}
            onMemoryObjectSelect={setSelectedMemoryObjectId}
          />
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
