import type { CodeStructure } from './codeStructure'
import type { ExecutionCursor } from './executionCursor'
import type { FlowGraph } from './flowGraph'
import type { ProgramMap } from './programMap'

export type TeachingMode = 'beginner' | 'advanced'

export type VisualizationExecutionStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'error'

export type VisualizationCategory =
  | 'architecture'
  | 'data-flow'
  | 'runtime-state'
  | 'memory'
  | 'algorithm'

export type VisualizationScope =
  | { kind: 'program' }
  | { kind: 'function'; functionId: string }
  | { kind: 'module'; moduleId: string; sourceNodeIds: string[] }
  | { kind: 'variable'; variableId: string }
  | { kind: 'memory-object'; memoryObjectId: string }

export interface TeachingStep {
  title: string
  description: string
  sourceNodeId?: string
  activeVariableIds: string[]
  activeMemoryObjectIds: string[]
  result?: string
  warning?: string
}

export interface VisualizationSelection {
  sourceNodeId?: string
  functionId?: string
  variableId?: string
  memoryObjectId?: string
  moduleId?: string
}

export interface VisualizationContext {
  schemaVersion: '1.0'
  source: {
    code: string
    entryFile: string
  }
  static: {
    structure: CodeStructure
    programMap: ProgramMap | null
    callGraph: FlowGraph
    functionGraphs: ReadonlyMap<string, FlowGraph>
  }
  execution: {
    runId?: string
    status: VisualizationExecutionStatus
    current: ExecutionCursor | null
    previous: ExecutionCursor | null
    history: readonly ExecutionCursor[]
    currentIndex: number
  }
  selection: VisualizationSelection
  teaching: {
    mode: TeachingMode
    currentStep?: TeachingStep
  }
  presentation: {
    followExecution: boolean
  }
}

export interface VisualizationActions {
  seekStep(step: number): void
  selectSourceNode(nodeId: string): void
  selectFunction(functionId: string): void
  selectVariable(variableId: string): void
  selectMemoryObject(memoryObjectId: string): void
  openVisualization(moduleId: string, scope?: VisualizationScope): void
  closeVisualization(instanceId: string): void
}

export interface VisualizationSupport {
  available: boolean
  reason?: string
  priority?: number
}
