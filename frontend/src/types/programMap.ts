export type AlgorithmModuleKind =
  | 'program'
  | 'function'
  | 'algorithm'
  | 'operation'
  | 'data_structure'

export interface AlgorithmModule {
  id: string
  stableKey: string
  parentId?: string
  children: string[]
  kind: AlgorithmModuleKind
  family?: string
  title: string
  sourceNodeIds: string[]
  visualizationHints: string[]
  bindings: Record<string, string>
  origin: 'deterministic' | 'agent'
  confidence: number
  evidence: string[]
  status: 'detected' | 'suggested' | 'confirmed'
}

export interface ProgramMap {
  sourceHash: string
  modules: AlgorithmModule[]
  agentConfigured: boolean
  agentStatus: 'idle' | 'analyzing' | 'completed' | 'unavailable' | 'failed'
  message?: string
}

export interface AgentAlgorithmModule {
  title: string
  family?: string
  kind: AlgorithmModuleKind
  sourceNodeIds: string[]
  visualizationHints: string[]
  confidence: number
  evidence: string[]
}
