import type { CodeStructure } from './codeStructure'
import type {
  MemoryObject,
  SourceLocation,
  StackFrame,
  TraceStep,
  TraceVariable,
} from './trace'

export interface VariableChange extends Record<string, unknown> {
  kind: 'declare' | 'update' | 'out_of_scope' | string
  variableId: string
  oldValue?: unknown
  newValue?: unknown
}

export interface ComparisonOperand {
  role: 'left' | 'right'
  expression: string
  kind: 'scalar' | 'array_element' | 'pointer_dereference' | 'literal' | 'unknown'
  variableId?: string
  variableName?: string
  indices?: number[]
  value?: unknown
  address?: string
  resolved: boolean
}

export interface ComparisonFact {
  kind: 'comparison'
  expression: string
  operator: '>' | '<' | '>=' | '<=' | '==' | '!='
  operands: [ComparisonOperand, ComparisonOperand]
  result?: boolean
}

export interface ArrayAccessFact {
  kind: 'array_access'
  variableId: string
  variableName: string
  indices: number[]
  access: 'read' | 'write'
}

export interface SwapFact {
  kind: 'swap'
  variableId: string
  variableName: string
  indices: [number, number]
}

export interface RecursionFact {
  kind: 'recursion'
  functionName: string
  depth: number
}

export type SemanticFact =
  | ComparisonFact
  | ArrayAccessFact
  | SwapFact
  | RecursionFact

export interface MemorySnapshot {
  variables: TraceVariable[]
  callStack: StackFrame[]
  objects: MemoryObject[]
}

export interface ExecutionCursor {
  step: number
  currentLocation: SourceLocation
  executedLocation?: SourceLocation
  currentNodeId?: string
  functionId?: string
  ancestorNodeIds: string[]
  activeModulePath: string[]
  variables: TraceVariable[]
  callStack: StackFrame[]
  memory: MemorySnapshot
  changes: VariableChange[]
  facts: SemanticFact[]
  activeMemoryIds: string[]
  traceStep: TraceStep
}

export interface ExecutionSession {
  structure: CodeStructure
  cursors: ExecutionCursor[]
  currentIndex: number
}
