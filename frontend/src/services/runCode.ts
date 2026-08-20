import type { ExecutionTrace } from '../types/trace'

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000'

interface ApiErrorBody {
  detail?: string | Array<{ msg?: string }>
}

const getErrorMessage = (body: ApiErrorBody): string => {
  if (typeof body.detail === 'string') return body.detail
  if (Array.isArray(body.detail)) {
    return body.detail.map((item) => item.msg ?? '请求参数错误').join('；')
  }
  return '后端运行请求失败'
}

export async function runCode(code: string): Promise<ExecutionTrace> {
  const response = await fetch(`${API_BASE_URL}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, entryFile: 'main.c' }),
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody
    throw new Error(getErrorMessage(body))
  }

  return (await response.json()) as ExecutionTrace
}
