import type { AgentAlgorithmModule } from '../types/programMap'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

export interface AgentAnalysisResponse {
  configured: boolean
  status: 'completed' | 'unavailable' | 'failed'
  sourceHash: string
  modules: AgentAlgorithmModule[]
  message?: string
}

export async function analyzeAlgorithms(
  request: {
    code: string
    entryFile: string
    sourceHash: string
    evidence: Record<string, unknown>
  },
  signal?: AbortSignal,
): Promise<AgentAnalysisResponse> {
  const response = await fetch(`${API_BASE_URL}/api/agent/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok) throw new Error(`Agent API 请求失败：${response.status}`)
  return await response.json() as AgentAnalysisResponse
}
