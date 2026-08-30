import type { CodeStructure } from './codeStructure'
import type {
  MemoryObject,
  PointerReference,
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

export interface SemanticFactMetadata {
  id: string
  sourceNodeId?: string
  location: SourceLocation
  activeVariableIds: string[]
  activeMemoryObjectIds: string[]
  origin: 'observed' | 'derived'
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

export interface ComparisonFact extends SemanticFactMetadata {
  kind: 'comparison'
  expression: string
  operator: '>' | '<' | '>=' | '<=' | '==' | '!='
  operands: [ComparisonOperand, ComparisonOperand]
  result?: boolean
}

export interface ArrayAccessFact extends SemanticFactMetadata {
  kind: 'array_access'
  variableId: string
  variableName: string
  indices: number[]
  access: 'read' | 'write'
}

export interface SwapFact extends SemanticFactMetadata {
  kind: 'swap'
  variableId: string
  variableName: string
  indices: [number, number]
}

export interface RecursionFact extends SemanticFactMetadata {
  kind: 'recursion'
  functionName: string
  depth: number
}

export interface VariableAccessFact extends SemanticFactMetadata {
  kind: 'variable_access'
  variableId: string
  variableName: string
  access: 'read' | 'write'
  value?: unknown
}

export interface PointerAccessFact extends SemanticFactMetadata {
  kind: 'pointer_access'
  variableId: string
  expression: string
  address?: string
  targetObjectId?: string
  status: 'resolved' | 'null' | 'dangling' | 'unreadable' | 'unknown'
  access: 'read' | 'write' | 'dereference'
  resolved: boolean
}

export interface AssignmentFact extends SemanticFactMetadata {
  kind: 'assignment'
  variableId: string
  changeKind: 'declare' | 'update' | 'out_of_scope'
  oldValue?: unknown
  newValue?: unknown
}

export interface FunctionCallFact extends SemanticFactMetadata {
  kind: 'function_call'
  functionName: string
  frameId?: string
  argumentVariableIds: string[]
  callKind: 'entry' | 'direct' | 'recursive'
}

export interface FunctionReturnFact extends SemanticFactMetadata {
  kind: 'function_return'
  functionName: string
  frameId?: string
  returnAvailable: boolean
  returnValue?: unknown
  returnType?: string
}

export interface BranchFact extends SemanticFactMetadata {
  kind: 'branch'
  expression?: string
  selected: 'true' | 'false' | 'case' | 'default' | 'unknown'
}

export interface AllocationFact extends SemanticFactMetadata {
  kind: 'allocation'
  operation: 'malloc' | 'calloc' | 'realloc'
  memoryObjectId?: string
  address?: string
  previousAddress?: string
  size?: number
  success: boolean
}

export interface DeallocationFact extends SemanticFactMetadata {
  kind: 'deallocation'
  memoryObjectId?: string
  address?: string
  operation: 'free' | 'realloc'
}

export interface OutputFact extends SemanticFactMetadata {
  kind: 'output'
  channel: 'stdout' | 'stderr'
  text: string
}

export interface RuntimeErrorFact extends SemanticFactMetadata {
  kind: 'runtime_error'
  signal?: string
  message: string
}

export type SemanticFact =
  | ComparisonFact
  | ArrayAccessFact
  | SwapFact
  | RecursionFact
  | VariableAccessFact
  | PointerAccessFact
  | AssignmentFact
  | FunctionCallFact
  | FunctionReturnFact
  | BranchFact
  | AllocationFact
  | DeallocationFact
  | OutputFact
  | RuntimeErrorFact

export interface MemorySnapshot {
  variables: TraceVariable[]
  callStack: StackFrame[]
  objects: MemoryObject[]
  pointers: PointerReference[]
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
