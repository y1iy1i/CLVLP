import type { StructureDiagnostic } from './codeStructure'

export type FlowGraphKind = 'call_graph' | 'function_flow'

export type FlowNodeKind =
  | 'start'
  | 'end'
  | 'function'
  | 'process'
  | 'decision'
  | 'loop'
  | 'call'
  | 'return'
  | 'jump'
  | 'external'

export type FlowEdgeType =
  | 'next'
  | 'true'
  | 'false'
  | 'loop_back'
  | 'break'
  | 'continue'
  | 'goto'
  | 'return'
  | 'calls'

export interface FlowNode {
  id: string
  stableKey: string
  kind: FlowNodeKind
  label: string
  sourceNodeId: string | null
  details?: Record<string, unknown>
}

export interface FlowEdge {
  id: string
  type: FlowEdgeType
  from: string
  to: string
  label?: string
}

export interface FlowGraph {
  id: string
  kind: FlowGraphKind
  title: string
  functionId?: string
  nodes: FlowNode[]
  edges: FlowEdge[]
  diagnostics: StructureDiagnostic[]
  truncated: boolean
}
