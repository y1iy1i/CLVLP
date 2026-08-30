import { useEffect, useRef, useState } from 'react'
import type { AnalyzeCodeRequest, AnalyzeCodeResponse } from '../types/analysis'
import type { CodeStructure } from '../types/codeStructure'

export type AnalysisPhase = 'idle' | 'analyzing' | 'ready' | 'failed'

const failedStructure = (entryFile: string, message: string): CodeStructure => ({
  schemaVersion: '1.0',
  analysisId: `failed:${Date.now()}`,
  status: 'failed',
  provider: 'tree-sitter',
  providerVersion: '0.26.13/c-0.24.1',
  source: { entryFile, files: [entryFile], language: 'c' },
  nodes: [],
  relations: [],
  diagnostics: [{ severity: 'error', code: 'PARSER_INIT_FAILED', message }],
  summary: { totalNodes: 0, totalRelations: 0, nodeCounts: {} },
})

export function useCodeStructure(code: string, entryFile = 'main.c', delay = 400) {
  const workerRef = useRef<Worker | null>(null)
  const latestRequest = useRef(0)
  const [structure, setStructure] = useState<CodeStructure | null>(null)
  const [phase, setPhase] = useState<AnalysisPhase>('idle')

  useEffect(() => {
    const worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.addEventListener('message', (event: MessageEvent<AnalyzeCodeResponse>) => {
      if (event.data.requestId !== latestRequest.current) return
      if (event.data.type === 'result') {
        setStructure(event.data.structure)
        setPhase('ready')
      } else {
        setStructure(failedStructure(entryFile, event.data.message))
        setPhase('failed')
      }
    })
    worker.addEventListener('error', (event) => {
      setStructure(failedStructure(entryFile, event.message || '分析 Worker 无法启动。'))
      setPhase('failed')
    })
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [entryFile])

  useEffect(() => {
    setPhase('analyzing')
    const requestId = ++latestRequest.current
    const timer = window.setTimeout(() => {
      const request: AnalyzeCodeRequest = { type: 'analyze', requestId, code, entryFile }
      workerRef.current?.postMessage(request)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [code, delay, entryFile])

  return { structure, phase }
}
