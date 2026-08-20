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
  name: string
  type: string
  value: unknown
  scope: string
}

export interface StackFrame {
  function: string
  variables: string[]
}

export interface MemoryObject {
  id: string
  address?: string
  type: string
  value: unknown
}

export interface ExecutionState {
  variables: TraceVariable[]
  callStack: StackFrame[]
  memory: MemoryObject[]
}

export interface StepOutput {
  stdout: string
  stderr: string
}

export interface TraceStep {
  step: number
  location: SourceLocation
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
  schemaVersion: '1.0'
  runId: string
  status: RunStatus
  source: TraceSource
  trace: TraceStep[]
  summary: TraceSummary
  error: TraceError | null
}
