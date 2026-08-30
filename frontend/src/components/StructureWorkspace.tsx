import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { buildAllFlowGraphs } from '../analysis/flowGraphBuilder'
import type { AnalysisPhase } from '../analysis/useCodeStructure'
import type { CodeStructure } from '../types/codeStructure'
import {
  visualizationModuleById,
  type VisualizationContext,
  type VisualizationModuleDefinition,
} from '../visualizations/registry'

type ModuleId = VisualizationModuleDefinition['id']

interface WindowState {
  id: string
  moduleId: ModuleId
  instanceKey?: string
  title: string
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  maximized: boolean
}

interface StructureWorkspaceProps {
  structure: CodeStructure | null
  phase: AnalysisPhase
  activeSourceNodeId: string | null
  ancestorSourceNodeIds: string[]
  followFunctionId: string | null
  followExecution: boolean
  onFollowExecutionChange: (value: boolean) => void
  onSourceSelect: (sourceNodeId: string) => void
}

const WINDOWS_KEY = 'clvlp:visualization-windows:v1'

const readWindows = (): WindowState[] => {
  try {
    const value = JSON.parse(localStorage.getItem(WINDOWS_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

const saveWindows = (windows: WindowState[]) =>
  localStorage.setItem(WINDOWS_KEY, JSON.stringify(windows))

export function StructureWorkspace({
  structure,
  phase,
  activeSourceNodeId,
  ancestorSourceNodeIds,
  followFunctionId,
  followExecution,
  onFollowExecutionChange,
  onSourceSelect,
}: StructureWorkspaceProps) {
  const desktopRef = useRef<HTMLDivElement | null>(null)
  const lastFollowedFunction = useRef<string | null>(null)
  const [windows, setWindows] = useState<WindowState[]>(readWindows)
  const [desktopSize, setDesktopSize] = useState({ width: 560, height: 700 })
  const [topZ, setTopZ] = useState(() => Math.max(1, ...readWindows().map((window) => window.z)))

  const graphs = useMemo(() => structure ? buildAllFlowGraphs(structure) : null, [structure])

  const defaultCallGraphWindow = useCallback((): WindowState => ({
    id: 'call-graph',
    moduleId: 'call-graph',
    title: '函数总关系图',
    x: 18,
    y: 18,
    width: Math.min(500, Math.max(320, desktopSize.width - 36)),
    height: Math.min(430, Math.max(240, desktopSize.height - 48)),
    z: 1,
    minimized: false,
    maximized: false,
  }), [desktopSize.height, desktopSize.width])

  useEffect(() => {
    const element = desktopRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setDesktopSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const commitWindows = useCallback((updater: (current: WindowState[]) => WindowState[]) => {
    setWindows((current) => {
      const next = updater(current)
      saveWindows(next)
      return next
    })
  }, [])

  const focusWindow = useCallback((windowId: string) => {
    setTopZ((currentZ) => {
      const nextZ = currentZ + 1
      commitWindows((current) => current.map((window) =>
        window.id === windowId ? { ...window, z: nextZ, minimized: false } : window,
      ))
      return nextZ
    })
  }, [commitWindows])

  const openWindow = useCallback((moduleId: ModuleId, instanceKey?: string) => {
    const definition = visualizationModuleById.get(moduleId)
    if (!definition) return
    const functionNode = moduleId === 'function-flow' && instanceKey
      ? structure?.nodes.find((node) =>
          node.kind === 'function' && (node.id === instanceKey || node.stableKey === instanceKey),
        )
      : undefined
    const resolvedInstanceKey = functionNode?.stableKey ?? instanceKey
    const id = resolvedInstanceKey ? `${moduleId}:${resolvedInstanceKey}` : moduleId
    const existing = windows.find((window) => window.id === id)
    if (existing) {
      focusWindow(existing.id)
      return
    }
    const nextZ = topZ + 1
    const offset = (windows.length % 5) * 26
    const width = Math.min(definition.defaultSize.width, Math.max(definition.minSize.width, desktopSize.width - 36))
    const height = Math.min(definition.defaultSize.height, Math.max(definition.minSize.height, desktopSize.height - 48))
    commitWindows((current) => [...current, {
      id,
      moduleId,
      instanceKey: resolvedInstanceKey,
      title: functionNode ? `${functionNode.name ?? '函数'} 流程` : definition.title,
      x: Math.min(18 + offset, Math.max(0, desktopSize.width - width)),
      y: Math.min(18 + offset, Math.max(0, desktopSize.height - height)),
      width,
      height,
      z: nextZ,
      minimized: false,
      maximized: false,
    }])
    setTopZ(nextZ)
  }, [commitWindows, desktopSize, focusWindow, structure, topZ, windows])

  useEffect(() => {
    if (!structure || !graphs) return
    const functionKeys = new Set(
      structure.nodes.filter((node) => node.kind === 'function').map((node) => node.stableKey),
    )
    commitWindows((current) => {
      const valid = current.filter((window) =>
        window.moduleId !== 'function-flow' || Boolean(window.instanceKey && functionKeys.has(window.instanceKey)),
      )
      return valid.some((window) => window.moduleId === 'call-graph')
        ? valid
        : [defaultCallGraphWindow(), ...valid]
    })
  }, [commitWindows, defaultCallGraphWindow, graphs, structure])

  useEffect(() => {
    if (
      followExecution &&
      followFunctionId &&
      followFunctionId !== lastFollowedFunction.current &&
      graphs?.functionGraphs.has(followFunctionId)
    ) {
      lastFollowedFunction.current = followFunctionId
      openWindow('function-flow', followFunctionId)
    }
  }, [followExecution, followFunctionId, graphs, openWindow])

  const resetWindows = () => {
    localStorage.removeItem(WINDOWS_KEY)
    const defaults = [defaultCallGraphWindow()]
    saveWindows(defaults)
    setWindows(defaults)
    setTopZ(1)
  }

  if (!structure && phase !== 'failed') {
    return <div className="structure-loading">正在浏览器中加载 Tree-sitter 并分析 C 代码…</div>
  }

  if (!structure || structure.status === 'failed' || !graphs) {
    return (
      <div className="structure-error">
        <strong>代码结构分析没有启动成功</strong>
        <span>{structure?.diagnostics[0]?.message ?? '未知分析错误'}</span>
      </div>
    )
  }

  const visualizationContext: VisualizationContext = {
    structure,
    callGraph: graphs.callGraph,
    functionGraphs: graphs.functionGraphs,
    activeSourceNodeId,
    ancestorSourceNodeIds,
    followExecution,
    onSourceSelect,
    onOpenFunction: (functionId) => openWindow('function-flow', functionId),
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
        <button type="button" onClick={() => openWindow('call-graph')}>函数总图</button>
        {structure.nodes.filter((node) => node.kind === 'function').map((node) => (
          <button key={node.id} type="button" onClick={() => openWindow('function-flow', node.id)}>
            打开 {node.name ?? '函数'}
          </button>
        ))}
        <button type="button" onClick={resetWindows}>恢复窗口</button>
      </div>
      {structure.diagnostics.length > 0 && (
        <div className="structure-diagnostics" title={structure.diagnostics.map((item) => item.message).join('\n')}>
          {structure.diagnostics.length} 条诊断 · {structure.diagnostics[0].message}
        </div>
      )}
      <div className="visualization-desktop" ref={desktopRef}>
        {windows.map((window) => {
          const definition = visualizationModuleById.get(window.moduleId)
          if (!definition) return null
          const Module = definition.component
          const maximized = window.maximized
          return (
            <Rnd
              key={window.id}
              bounds="parent"
              dragHandleClassName="visual-window-titlebar"
              disableDragging={maximized}
              enableResizing={!maximized && !window.minimized}
              minWidth={definition.minSize.width}
              minHeight={definition.minSize.height}
              size={{
                width: maximized ? Math.max(0, desktopSize.width - 8) : window.width,
                height: window.minimized ? 38 : maximized ? Math.max(0, desktopSize.height - 8) : window.height,
              }}
              position={{ x: maximized ? 4 : window.x, y: maximized ? 4 : window.y }}
              style={{ zIndex: window.z }}
              onMouseDown={() => setTimeout(() => focusWindow(window.id), 0)}
              onDragStop={(_, data) => commitWindows((current) => current.map((item) =>
                item.id === window.id ? { ...item, x: data.x, y: data.y } : item,
              ))}
              onResizeStop={(_, __, element, ___, position) => commitWindows((current) => current.map((item) =>
                item.id === window.id
                  ? { ...item, width: element.offsetWidth, height: element.offsetHeight, x: position.x, y: position.y }
                  : item,
              ))}
            >
              <section className={`visual-window ${window.minimized ? 'is-minimized' : ''}`}>
                <header className="visual-window-titlebar">
                  <strong>{window.title}</strong>
                  <div>
                    <button
                      type="button"
                      title={window.minimized ? '展开' : '最小化'}
                      onClick={() => commitWindows((current) => current.map((item) =>
                        item.id === window.id ? { ...item, minimized: !item.minimized, maximized: false } : item,
                      ))}
                    >{window.minimized ? '□' : '—'}</button>
                    <button
                      type="button"
                      title={window.maximized ? '还原' : '最大化'}
                      onClick={() => commitWindows((current) => current.map((item) =>
                        item.id === window.id ? { ...item, maximized: !item.maximized, minimized: false } : item,
                      ))}
                    >{window.maximized ? '❐' : '□'}</button>
                    <button
                      type="button"
                      title="关闭"
                      onClick={() => commitWindows((current) => current.filter((item) => item.id !== window.id))}
                    >×</button>
                  </div>
                </header>
                {!window.minimized && (
                  <div className="visual-window-body">
                    <Module context={visualizationContext} instanceKey={window.instanceKey} />
                  </div>
                )}
              </section>
            </Rnd>
          )
        })}
      </div>
    </div>
  )
}
