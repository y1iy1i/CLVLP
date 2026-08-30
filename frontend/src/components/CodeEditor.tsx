import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type { SourceRange } from '../types/codeStructure'

interface CodeEditorProps {
  code: string
  currentLine?: number
  selectedRange?: SourceRange | null
  onChange: (code: string) => void
}

export function CodeEditor({ code, currentLine, selectedRange, onChange }: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const traceDecorationIds = useRef<string[]>([])
  const structureDecorationIds = useRef<string[]>([])

  const handleMount: OnMount = (mountedEditor) => {
    editorRef.current = mountedEditor
  }

  useEffect(() => {
    const mountedEditor = editorRef.current
    if (!mountedEditor) return

    traceDecorationIds.current = mountedEditor.deltaDecorations(
      traceDecorationIds.current,
      currentLine
        ? [
            {
              range: {
                startLineNumber: currentLine,
                startColumn: 1,
                endLineNumber: currentLine,
                endColumn: 1,
              },
              options: {
                isWholeLine: true,
                className: 'trace-current-line',
                linesDecorationsClassName: 'trace-current-line-gutter',
              },
            },
          ]
        : [],
    )

    if (currentLine) mountedEditor.revealLineInCenterIfOutsideViewport(currentLine)
  }, [currentLine])

  useEffect(() => {
    const mountedEditor = editorRef.current
    if (!mountedEditor) return
    structureDecorationIds.current = mountedEditor.deltaDecorations(
      structureDecorationIds.current,
      selectedRange
        ? [{
            range: {
              startLineNumber: selectedRange.start.line,
              startColumn: selectedRange.start.column,
              endLineNumber: selectedRange.end.line,
              endColumn: Math.max(1, selectedRange.end.column),
            },
            options: {
              className: 'structure-selected-range',
              inlineClassName: 'structure-selected-inline',
              overviewRuler: { color: '#72a7ff88', position: 7 },
            },
          }]
        : [],
    )
    if (selectedRange) {
      mountedEditor.setSelection({
        startLineNumber: selectedRange.start.line,
        startColumn: selectedRange.start.column,
        endLineNumber: selectedRange.end.line,
        endColumn: Math.max(1, selectedRange.end.column),
      })
      mountedEditor.revealRangeInCenterIfOutsideViewport({
        startLineNumber: selectedRange.start.line,
        startColumn: selectedRange.start.column,
        endLineNumber: selectedRange.end.line,
        endColumn: Math.max(1, selectedRange.end.column),
      })
    }
  }, [selectedRange])

  return (
    <Editor
      height="100%"
      language="c"
      theme="vs-dark"
      value={code}
      onChange={(value) => onChange(value ?? '')}
      onMount={handleMount}
      loading={<div className="editor-loading">正在加载代码编辑器…</div>}
      options={{
        automaticLayout: true,
        fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
        fontSize: 14,
        lineHeight: 23,
        minimap: { enabled: false },
        padding: { top: 16, bottom: 16 },
        renderLineHighlight: 'none',
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        tabSize: 4,
      }}
    />
  )
}
