import type { PointerReference } from './trace'

export type StructureShape =
  | 'contiguous_sequence'
  | 'matrix'
  | 'record'
  | 'linked_sequence'
  | 'circular_sequence'
  | 'tree'
  | 'graph'
  | 'bucket_structure'
  | 'generic_pointer_graph'

export interface PointerTopologyNode {
  id: string
  memoryObjectId: string
  variableId?: string
  label: string
  type?: string
  value?: unknown
  address?: string
  size?: number
  status: 'alive' | 'freed' | 'unknown'
  root: boolean
}

export interface PointerTopologyEdge {
  id: string
  sourceId: string
  targetId?: string
  sourceExpression: string
  role: string
  status: PointerReference['status']
  addressValue?: string | null
  offset?: number
}

export interface PointerTopology {
  rootVariableId: string
  rootNodeId?: string
  nodes: PointerTopologyNode[]
  edges: PointerTopologyEdge[]
  truncated: boolean
  maxDepthReached: boolean
}

export interface DetectedStructure {
  id: string
  rootVariableId: string
  shape: StructureShape
  confidence: 'certain' | 'probable' | 'generic'
  evidence: string[]
  memoryObjectIds: string[]
  topology: PointerTopology
}
