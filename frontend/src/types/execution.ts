export type ExecutionStatus =
  | 'completed'
  | 'compile_error'
  | 'runtime_error'
  | 'timeout'

export interface CompilerDescriptor {
  name: 'gcc'
  languageStandard: 'c11'
  image: string
}

export interface ExecutionLimits {
  compileTimeoutSeconds: number
  runTimeoutSeconds: number
  memoryMegabytes: number
  cpuCount: number
  processLimit: number
  maxOutputBytes: number
  networkEnabled: false
}

export interface OutputTruncation {
  stdout: boolean
  stderr: boolean
}

export interface ExecutionError {
  type: string
  message: string
}

export interface ExecutionResult {
  schemaVersion: '1.0'
  runId: string
  status: ExecutionStatus
  source: {
    entryFile: string
    language: 'c'
  }
  compiler: CompilerDescriptor
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  outputTruncated: OutputTruncation
  limits: ExecutionLimits
  error: ExecutionError | null
}
