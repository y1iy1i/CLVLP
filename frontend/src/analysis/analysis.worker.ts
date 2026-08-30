/// <reference lib="webworker" />

import { Language, Parser } from 'web-tree-sitter'
import treeSitterWasmUrl from 'web-tree-sitter/web-tree-sitter.wasm?url'
import cLanguageWasmUrl from 'tree-sitter-c/tree-sitter-c.wasm?url'
import { mapCCodeStructure } from './codeStructureMapper'
import type { AnalyzeCodeRequest, AnalyzeCodeResponse } from '../types/analysis'

let parserPromise: Promise<Parser> | null = null

const getParser = () => {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init({ locateFile: () => treeSitterWasmUrl })
      const language = await Language.load(cLanguageWasmUrl)
      const parser = new Parser()
      parser.setLanguage(language)
      return parser
    })()
  }
  return parserPromise
}

self.addEventListener('message', async (event: MessageEvent<AnalyzeCodeRequest>) => {
  if (event.data.type !== 'analyze') return
  const { requestId, code, entryFile } = event.data
  try {
    const parser = await getParser()
    parser.reset()
    const tree = parser.parse(code)
    if (!tree) throw new Error('Tree-sitter 没有返回语法树。')
    try {
      const response: AnalyzeCodeResponse = {
        type: 'result',
        requestId,
        structure: mapCCodeStructure(tree.rootNode, code, entryFile),
      }
      self.postMessage(response)
    } finally {
      tree.delete()
    }
  } catch (error) {
    const response: AnalyzeCodeResponse = {
      type: 'failure',
      requestId,
      message: error instanceof Error ? error.message : 'Tree-sitter 初始化失败。',
    }
    self.postMessage(response)
  }
})
