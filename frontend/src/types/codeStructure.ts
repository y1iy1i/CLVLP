export type StructureProvider = 'tree-sitter' | 'clang'

export type StructureStatus = 'completed' | 'partial' | 'failed'

export type NodeKind =
  | 'file'
  | 'function'
  | 'parameter'
  | 'variable'
  | 'type'
  | 'member'
  | 'block'
  | 'loop'
  | 'condition'
  | 'branch'
  | 'assignment'
  | 'call'
  | 'return'
  | 'jump'
  | 'label'
  | 'preprocessor'

export type RelationType =
  | 'contains'
  | 'calls'
  | 'reads'
  | 'writes'
  | 'includes'
  | 'uses_type'

export interface SourcePosition {
  line: number
  column: number
}

export interface SourceRange {
  file: string
  start: SourcePosition
  end: SourcePosition
}

export interface FileDetails {
  path: string
}

export interface FunctionDetails {
  returnType?: string
  isDefinition: boolean
  storageClass?: string
}

export interface ParameterDetails {
  dataType?: string
  position: number
}

export interface VariableDetails {
  dataType?: string
  isArray: boolean
  dimensions: number[]
  initialValue?: string
  storageClass?: string
}

export interface TypeDetails {
  typeKind: 'struct' | 'union' | 'enum' | 'typedef'
  aliasedType?: string
}

export interface MemberDetails {
  dataType?: string
  isArray: boolean
  dimensions: number[]
}

export interface BlockDetails {
  blockType: 'function' | 'loop' | 'condition' | 'standalone'
}

export interface LoopDetails {
  loopType: 'for' | 'while' | 'do_while'
  condition?: string
  initializerNodeIds?: string[]
  bodyNodeIds?: string[]
  updateNodeIds?: string[]
}

export interface ConditionDetails {
  conditionType: 'if' | 'else_if' | 'switch' | 'ternary'
  expression?: string
}

export interface BranchDetails {
  branchType: 'then' | 'else' | 'case' | 'default'
  caseValue?: string
}

export interface AssignmentDetails {
  operator: string
  target?: string
  expression?: string
}

export interface CallDetails {
  functionName: string
  arguments: string[]
}

export interface ReturnDetails {
  expression?: string
}

export interface JumpDetails {
  jumpType: 'break' | 'continue' | 'goto'
  targetLabel?: string
}

export interface LabelDetails {
  targetLabel: string
}

export interface PreprocessorDetails {
  directiveType:
    | 'include'
    | 'define'
    | 'undef'
    | 'if'
    | 'ifdef'
    | 'ifndef'
    | 'elif'
    | 'else'
    | 'endif'
    | 'pragma'
    | 'other'
  value?: string
}

export interface NodeDetailsByKind {
  file: FileDetails
  function: FunctionDetails
  parameter: ParameterDetails
  variable: VariableDetails
  type: TypeDetails
  member: MemberDetails
  block: BlockDetails
  loop: LoopDetails
  condition: ConditionDetails
  branch: BranchDetails
  assignment: AssignmentDetails
  call: CallDetails
  return: ReturnDetails
  jump: JumpDetails
  label: LabelDetails
  preprocessor: PreprocessorDetails
}

export interface CodeStructureNode<K extends NodeKind> {
  id: string
  stableKey: string
  kind: K
  name?: string
  label: string
  rawKind?: string
  range: SourceRange
  parentId: string | null
  children: string[]
  details: NodeDetailsByKind[K]
}

export type AnyCodeStructureNode = {
  [K in NodeKind]: CodeStructureNode<K>
}[NodeKind]

interface RelationBase {
  id: string
  type: RelationType
  from: string
  location?: SourceRange
  details?: Record<string, unknown>
}

export type CodeRelation = RelationBase &
  (
    | {
        resolved: true
        to: string
        targetName?: string
      }
    | {
        resolved: false
        to: null
        targetName: string
      }
  )

export interface StructureDiagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  code?: string
  range?: SourceRange
}

export interface StructureSource {
  entryFile: string
  files: string[]
  language: 'c'
}

export interface StructureSummary {
  totalNodes: number
  totalRelations: number
  nodeCounts: Partial<Record<NodeKind, number>>
}

export interface CodeStructure {
  schemaVersion: '1.0'
  analysisId: string
  status: StructureStatus
  provider: StructureProvider
  providerVersion?: string
  source: StructureSource
  nodes: AnyCodeStructureNode[]
  relations: CodeRelation[]
  diagnostics: StructureDiagnostic[]
  summary: StructureSummary
}
