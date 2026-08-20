interface FileExplorerProps {
  fileName: string
}

export function FileExplorer({ fileName }: FileExplorerProps) {
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
      <div className="explorer-spacer" />
      <div className="explorer-note">
        <span className="note-dot" />
        本地示例文件
      </div>
    </aside>
  )
}
