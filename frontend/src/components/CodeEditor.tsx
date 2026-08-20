import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

interface CodeEditorProps {
  code: string
  currentLine?: number
  onChange: (code: string) => void
}

export function CodeEditor({ code, currentLine, onChange }: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const decorationIds = useRef<string[]>([])

  const handleMount: OnMount = (mountedEditor) => {
    editorRef.current = mountedEditor
  }

  useEffect(() => {
    const mountedEditor = editorRef.current
    if (!mountedEditor) return

    decorationIds.current = mountedEditor.deltaDecorations(
      decorationIds.current,
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
