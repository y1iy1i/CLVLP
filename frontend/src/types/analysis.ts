import type { CodeStructure } from './codeStructure'

export interface AnalyzeCodeRequest {
  type: 'analyze'
  requestId: number
  code: string
  entryFile: string
}

export interface AnalyzeCodeSuccess {
  type: 'result'
  requestId: number
  structure: CodeStructure
}

export interface AnalyzeCodeFailure {
  type: 'failure'
  requestId: number
  message: string
}

export type AnalyzeCodeResponse = AnalyzeCodeSuccess | AnalyzeCodeFailure
