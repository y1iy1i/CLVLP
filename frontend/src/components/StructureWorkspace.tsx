import { useState } from 'react'
import { ProgramMapPanel } from './ProgramMapPanel'
import type { AnalysisPhase } from '../analysis/useCodeStructure'
import type { CodeStructure } from '../types/codeStructure'
import type { VisualizationContext, VisualizationScope } from '../types/visualization'

interface StructureWorkspaceProps {
  structure: CodeStructure | null
  context: VisualizationContext | null
  phase: AnalysisPhase
  followExecution: boolean
  onFollowExecutionChange: (value: boolean) => void
  onSourceSelect: (sourceNodeId: string) => void
  onOpenVisualization: (moduleId: string, scope?: VisualizationScope) => void
}

export function StructureWorkspace({
  structure,
  context,
  phase,
  followExecution,
  onFollowExecutionChange,
  onSourceSelect,
  onOpenVisualization,
}: StructureWorkspaceProps) {
  const [workspaceView, setWorkspaceView] = useState<'map' | 'details'>('map')

  if (!structure && phase !== 'failed') {
    return <div className="structure-loading">正在浏览器中加载 Tree-sitter 并分析 C 代码…</div>
  }

  if (!structure || structure.status === 'failed' || !context) {
    return (
      <div className="structure-error">
        <strong>代码结构分析没有启动成功</strong>
        <span>{structure?.diagnostics[0]?.message ?? '未知分析错误'}</span>
      </div>
    )
  }

  const programMap = context.static.programMap
  const cursor = context.execution.current
  const openDetails = () => {
    setWorkspaceView('details')
    onOpenVisualization('call-graph', { kind: 'program' })
  }

  return (
    <div className="structure-workspace">
      <div className="structure-toolbar">
        <span className={`analysis-status analysis-status-${structure.status}`}>
          {phase === 'analyzing' ? '分析中…' : structure.status === 'partial' ? '部分结构' : '结构已更新'}
        </span>
        <span>{structure.summary.totalNodes} 节点</span>
        <label>
          <input
            type="checkbox"
            checked={followExecution}
            onChange={(event) => onFollowExecutionChange(event.target.checked)}
          />
          跟随执行
        </label>
        <button className={workspaceView === 'map' ? 'active' : ''} type="button" onClick={() => setWorkspaceView('map')}>教学地图</button>
        <button className={workspaceView === 'details' ? 'active' : ''} type="button" onClick={openDetails}>详细结构</button>
        {workspaceView === 'details' && structure.nodes.filter((node) => node.kind === 'function').map((node) => (
          <button key={node.id} type="button" onClick={() => onOpenVisualization(
            'function-flow',
            { kind: 'function', functionId: node.id },
          )}>
            打开 {node.name ?? '函数'}
          </button>
        ))}
      </div>
      {structure.diagnostics.length > 0 && (
        <div className="structure-diagnostics" title={structure.diagnostics.map((item) => item.message).join('\n')}>
          {structure.diagnostics.length} 条诊断 · {structure.diagnostics[0].message}
        </div>
      )}
      {workspaceView === 'map' && programMap ? (
        <ProgramMapPanel
          map={programMap}
          structure={structure}
          activeModulePath={cursor?.activeModulePath ?? []}
          onSourceSelect={onSourceSelect}
          onOpenDetails={(functionId) => {
            setWorkspaceView('details')
            onOpenVisualization('function-flow', { kind: 'function', functionId })
          }}
        />
      ) : (
        <div className="structure-details-placeholder">
          <strong>详细结构已在浮动工作区中打开</strong>
          <span>可以拖动、缩放并与变量观察器并排查看。</span>
          <button type="button" onClick={() => onOpenVisualization('call-graph')}>打开函数总图</button>
        </div>
      )}
    </div>
  )
}
