import type { CodeStructure } from '../types/codeStructure'
import type { ExecutionCursor } from '../types/executionCursor'
import type { FlowGraph } from '../types/flowGraph'
import type { ProgramMap } from '../types/programMap'
import type { ExecutionTrace } from '../types/trace'
import type {
  TeachingMode,
  VisualizationContext,
  VisualizationSelection,
} from '../types/visualization'
import { buildTeachingStep } from './teachingStep'

export interface BuildVisualizationContextInput {
  code: string
  entryFile: string
  structure: CodeStructure
  programMap: ProgramMap | null
  callGraph: FlowGraph
  functionGraphs: ReadonlyMap<string, FlowGraph>
  trace: ExecutionTrace | null
  isRunning: boolean
  history: readonly ExecutionCursor[]
  currentIndex: number | null
  selection?: VisualizationSelection
  teachingMode: TeachingMode
  followExecution: boolean
}

export function buildVisualizationContext({
  code,
  entryFile,
  structure,
  programMap,
  callGraph,
  functionGraphs,
  trace,
  isRunning,
  history,
  currentIndex,
  selection = {},
  teachingMode,
  followExecution,
}: BuildVisualizationContextInput): VisualizationContext {
  const current = currentIndex === null ? null : history[currentIndex] ?? null
  const previous = currentIndex !== null && currentIndex > 0
    ? history[currentIndex - 1] ?? null
    : null
  const status = isRunning
    ? 'running'
    : !trace
      ? 'idle'
      : trace.status === 'completed'
        ? 'completed'
        : 'error'

  return {
    schemaVersion: '1.0',
    source: { code, entryFile },
    static: { structure, programMap, callGraph, functionGraphs },
    execution: {
      runId: trace?.runId,
      status,
      current,
      previous,
      history,
      currentIndex: currentIndex ?? -1,
    },
    selection,
    teaching: {
      mode: teachingMode,
      currentStep: buildTeachingStep(current),
    },
    presentation: { followExecution },
  }
}
