import { useMemo, useState, type ReactNode } from 'react'
import type { CodeStructure } from '../types/codeStructure'
import type { AlgorithmModule, ProgramMap } from '../types/programMap'

interface ProgramMapPanelProps {
  map: ProgramMap
  structure: CodeStructure
  activeModulePath: string[]
  onSourceSelect: (sourceNodeId: string) => void
  onOpenDetails: (functionId: string) => void
}

const EXPANDED_KEY = 'clvlp:program-map:expanded:v1'
const DECISIONS_KEY = 'clvlp:program-map:decisions:v1'

const readStringSet = (key: string) => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return new Set<string>(Array.isArray(value) ? value : [])
  } catch {
    return new Set<string>()
  }
}

const saveStringSet = (key: string, value: Set<string>) =>
  localStorage.setItem(key, JSON.stringify([...value]))

const hintLabels: Record<string, string> = {
  'call-graph': '函数图',
  'function-flow': '流程图',
  array: '柱状图',
  'comparison-card': '比较卡片',
  'recursion-tree': '递归树',
  matrix: '矩阵',
  memory: '内存',
}

export function ProgramMapPanel({
  map,
  structure,
  activeModulePath,
  onSourceSelect,
  onOpenDetails,
}: ProgramMapPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const stored = readStringSet(EXPANDED_KEY)
    if (stored.size > 0) return stored
    return new Set(map.modules.filter((module) => module.kind === 'program' || module.kind === 'function').map((module) => module.stableKey))
  })
  const [confirmed, setConfirmed] = useState<Set<string>>(() => readStringSet(`${DECISIONS_KEY}:confirmed`))
  const [ignored, setIgnored] = useState<Set<string>>(() => readStringSet(`${DECISIONS_KEY}:ignored`))
  const modulesById = useMemo(() => new Map(map.modules.map((module) => [module.id, module])), [map.modules])
  const activeSet = new Set(activeModulePath)

  const decide = (module: AlgorithmModule, decision: 'confirmed' | 'ignored') => {
    const setter = decision === 'confirmed' ? setConfirmed : setIgnored
    const key = `${DECISIONS_KEY}:${decision}`
    setter((current) => {
      const next = new Set(current)
      next.add(module.stableKey)
      saveStringSet(key, next)
      return next
    })
  }

  const toggle = (module: AlgorithmModule) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(module.stableKey)) next.delete(module.stableKey)
      else next.add(module.stableKey)
      saveStringSet(EXPANDED_KEY, next)
      return next
    })
  }

  const functionIdFor = (module: AlgorithmModule) => {
    const nodesById = new Map(structure.nodes.map((node) => [node.id, node]))
    for (const sourceNodeId of module.sourceNodeIds) {
      let current = nodesById.get(sourceNodeId)
      while (current && current.kind !== 'function') {
        current = current.parentId ? nodesById.get(current.parentId) : undefined
      }
      if (current?.kind === 'function') return current.id
    }
    return undefined
  }

  const renderModule = (module: AlgorithmModule, depth: number): ReactNode => {
    if (ignored.has(module.stableKey)) return null
    const children = module.children.map((id) => modulesById.get(id)).filter(Boolean) as AlgorithmModule[]
    const isExpanded = expanded.has(module.stableKey)
    const suggested = module.status === 'suggested' && !confirmed.has(module.stableKey)
    const functionId = functionIdFor(module)
    return (
      <li key={module.id} className="program-map-item">
        <div
          className={`program-map-row${activeSet.has(module.id) ? ' is-active' : ''}${suggested ? ' is-suggested' : ''}`}
          style={{ paddingLeft: `${10 + depth * 18}px` }}
        >
          <button
            className="program-map-toggle"
            type="button"
            disabled={children.length === 0}
            onClick={() => toggle(module)}
            aria-label={isExpanded ? '折叠模块' : '展开模块'}
          >{children.length ? (isExpanded ? '⌄' : '›') : '·'}</button>
          <button
            className="program-map-main"
            type="button"
            onClick={() => module.sourceNodeIds[0] && onSourceSelect(module.sourceNodeIds[0])}
          >
            <strong>{module.title}</strong>
            <span>{module.evidence[0]}</span>
          </button>
          <div className="program-map-hints">
            {module.visualizationHints.slice(0, 2).map((hint) => (
              <span key={hint}>{hintLabels[hint] ?? hint}</span>
            ))}
          </div>
          {functionId && module.kind !== 'operation' && (
            <button className="program-map-detail" type="button" onClick={() => onOpenDetails(functionId)}>
              查看内部
            </button>
          )}
        </div>
        {suggested && (
          <div className="program-map-suggestion" style={{ marginLeft: `${38 + depth * 18}px` }}>
            <span>{module.origin === 'agent' ? 'Agent 建议' : '本地候选'} · {Math.round(module.confidence * 100)}%</span>
            <button type="button" onClick={() => decide(module, 'confirmed')}>采用</button>
            <button type="button" onClick={() => decide(module, 'ignored')}>忽略</button>
          </div>
        )}
        {isExpanded && children.length > 0 && (
          <ul>{children.map((child) => renderModule(child, depth + 1))}</ul>
        )}
      </li>
    )
  }

  const roots = map.modules.filter((module) => !module.parentId)
  return (
    <section className="program-map-panel" aria-label="教学程序地图">
      <header>
        <div>
          <strong>教学程序地图</strong>
          <span>点击模块查看源码，查看内部可打开详细控制流</span>
        </div>
        <span className={`program-map-agent status-${map.agentStatus}`}>
          {map.agentStatus === 'analyzing'
            ? 'Agent 分析中'
            : map.agentStatus === 'completed'
              ? 'Agent 已完成'
              : map.agentConfigured
                ? 'Agent 可用'
                : '本地识别'}
        </span>
      </header>
      {map.message && <div className="program-map-message">{map.message}</div>}
      <ul className="program-map-tree">{roots.map((module) => renderModule(module, 0))}</ul>
    </section>
  )
}
