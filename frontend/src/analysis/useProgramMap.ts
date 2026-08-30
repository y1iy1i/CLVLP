import { useEffect, useMemo, useState } from 'react'
import { analyzeAlgorithms, type AgentAnalysisResponse } from '../services/analyzeAlgorithms'
import type { CodeStructure } from '../types/codeStructure'
import type { ProgramMap } from '../types/programMap'
import {
  algorithmEvidence,
  buildLocalProgramMap,
  mergeAgentModules,
} from './programMap'

const responseCache = new Map<string, AgentAnalysisResponse>()

export function useProgramMap(code: string, structure: CodeStructure | null) {
  const local = useMemo(
    () => structure ? buildLocalProgramMap(structure, code) : null,
    [code, structure],
  )
  const [agentResponse, setAgentResponse] = useState<AgentAnalysisResponse | null>(null)
  const [analyzingHash, setAnalyzingHash] = useState<string | null>(null)

  useEffect(() => {
    if (!structure || !local || structure.status === 'failed') return
    const cached = responseCache.get(local.sourceHash)
    if (cached) {
      setAgentResponse(cached)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setAnalyzingHash(local.sourceHash)
      void analyzeAlgorithms({
        code,
        entryFile: structure.source.entryFile,
        sourceHash: local.sourceHash,
        evidence: algorithmEvidence(structure, local),
      }, controller.signal).then((response) => {
        if (controller.signal.aborted) return
        responseCache.set(response.sourceHash, response)
        setAgentResponse(response)
      }).catch(() => {
        if (!controller.signal.aborted) {
          setAgentResponse({
            configured: false,
            status: 'failed',
            sourceHash: local.sourceHash,
            modules: [],
            message: 'Agent API 不可用，已继续使用本地分析。',
          })
        }
      }).finally(() => {
        if (!controller.signal.aborted) setAnalyzingHash(null)
      })
    }, 1500)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [code, local, structure])

  return useMemo<ProgramMap | null>(() => {
    if (!local || !structure) return null
    if (analyzingHash === local.sourceHash) {
      return { ...local, agentStatus: 'analyzing' }
    }
    if (!agentResponse || agentResponse.sourceHash !== local.sourceHash) return local
    if (agentResponse.status === 'completed') {
      return mergeAgentModules(local, agentResponse.modules, structure)
    }
    return {
      ...local,
      agentConfigured: agentResponse.configured,
      agentStatus: agentResponse.status,
      message: agentResponse.message,
    }
  }, [agentResponse, analyzingHash, local, structure])
}
