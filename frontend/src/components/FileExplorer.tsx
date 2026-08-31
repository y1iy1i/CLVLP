import type { CodeExample } from '../mocks/codeExamples'

interface FileExplorerProps {
  fileName: string
  examples: CodeExample[]
  activeExampleId: string
  onExampleSelect: (example: CodeExample) => void
}

export function FileExplorer({
  fileName,
  examples,
  activeExampleId,
  onExampleSelect,
}: FileExplorerProps) {
  const categories = [...new Set(examples.map((example) => example.category))]
  return (
    <aside className="explorer" aria-label="文件目录">
      <div className="panel-heading">资源管理器</div>
      <div className="project-label">
        <span className="chevron">⌄</span>
        <span>CLVLP</span>
      </div>
      <button className="file-item active" type="button" aria-current="page">
        <span className="c-file-icon">C</span>
        <span>{fileName}</span>
      </button>
      <div className="example-heading"><span className="chevron">⌄</span><span>示例代码</span></div>
      <div className="example-list">
        {categories.map((category) => (
          <section key={category}>
            <h3>{category}</h3>
            {examples.filter((example) => example.category === category).map((example) => (
              <button
                className={`example-item${activeExampleId === example.id ? ' active' : ''}`}
                type="button"
                key={example.id}
                title={`${example.description}；点击后载入 main.c`}
                onClick={() => onExampleSelect(example)}
              >
                <span className="c-file-icon">C</span>
                <span><strong>{example.title}</strong><small>{example.description}</small></span>
              </button>
            ))}
          </section>
        ))}
      </div>
      <div className="explorer-spacer" />
      <div className="explorer-note">
        <span className="note-dot" />
        选择示例会替换 main.c，并清空上一轮运行数据
      </div>
    </aside>
  )
}
