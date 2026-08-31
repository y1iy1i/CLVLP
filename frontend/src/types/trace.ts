export type RunStatus =
  | 'completed'
  | 'compile_error'
  | 'runtime_error'
  | 'timeout'
  | 'cancelled'

export interface TraceSource {
  entryFile: string
  language: 'c'
}

export interface SourceLocation {
  file: string
  line: number
  column?: number
}

export interface TraceEvent {
  type: string
  data: Record<string, unknown>
}

export interface TraceVariable {
  id: string
  frameId?: string
  name: string
  type: string
  value: unknown
  scope: string
  role?: 'parameter' | 'local' | 'global'
  available?: boolean
  storage?: VariableStorage
  pointer?: PointerReference
  pointeeSize?: number
  fields?: MemoryField[]
}

export interface VariableStorage {
  address?: string
  size?: number
  region: 'stack' | 'global' | 'heap' | 'register' | 'unknown'
  available: boolean
  unavailableReason?: string
  bytes?: string
}

export interface PointerReference {
  id: string
  sourceVariableId: string
  sourceExpression?: string
  sourceAddress?: string
  addressValue?: string | null
  targetObjectId?: string
  targetAddress?: string
  offset?: number
  targetType?: string
  elementSize?: number
  elementCount?: number
  status: 'resolved' | 'null' | 'dangling' | 'unreadable' | 'unknown'
}

export interface MemoryField {
  name: string
  type: string
  value: unknown
  expression?: string
  address?: string
  offset?: number
  size?: number
  pointeeSize?: number
  pointer?: PointerReference
  fields: MemoryField[]
}

export interface StackFrame {
  id: string
  parentFrameId?: string
  function: string
  variables: string[]
  arguments?: string[]
  locals?: string[]
}

export interface MemoryObject {
  id: string
  address?: string
  size?: number
  type: string
  value: unknown
  region?: 'stack' | 'global' | 'heap'
  bytes?: string
  readable?: boolean
  fields?: MemoryField[]
  lifetime?: {
    allocatedAtStep?: number
    freedAtStep?: number
    status: 'alive' | 'freed' | 'unknown'
  }
}

export interface ExecutionState {
  variables: TraceVariable[]
  callStack: StackFrame[]
  memory: MemoryObject[]
  pointers?: PointerReference[]
}

export interface StepOutput {
  stdout: string
  stderr: string
}

export interface TraceStep {
  step: number
  location: SourceLocation
  executedLocation?: SourceLocation
  event: TraceEvent
  state: ExecutionState
  output: StepOutput
}

export interface TraceSummary {
  totalSteps: number
  exitCode: number | null
  truncated: boolean
}

export interface TraceError {
  type: string
  message: string
  details?: Record<string, unknown>
}

export interface ExecutionTrace {
  schemaVersion: '1.0' | '1.1' | '1.2'
  runId: string
  status: RunStatus
  source: TraceSource
  trace: TraceStep[]
  summary: TraceSummary
  error: TraceError | null
}
