import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import type { CodeStructure } from '../types/codeStructure'
import type {
  VisualizationActions,
  VisualizationContext,
  VisualizationScope,
} from '../types/visualization'
import {
  visualizationModuleById,
  type VisualizationModuleDefinition,
} from '../visualizations/registry'

type ModuleId = VisualizationModuleDefinition['id']

interface WindowState {
  id: string
  moduleId: ModuleId
  instanceKey?: string
  scope?: VisualizationScope
  title: string
  x: number
  y: number
  width: number
  height: number
  z: number
  minimized: boolean
  maximized: boolean
}

interface VisualizationWorkspaceProps {
  context: VisualizationContext | null
  structure: CodeStructure | null
  onSourceSelect: (sourceNodeId: string) => void
  onSeekStep: (step: number) => void
  onVariableSelect: (variableId: string) => void
  onMemoryObjectSelect: (memoryObjectId: string) => void
}

export interface VisualizationWorkspaceHandle {
  openVisualization: (moduleId: string, scope?: VisualizationScope) => void
  resetWindows: () => void
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

export const VisualizationWorkspace = forwardRef<
  VisualizationWorkspaceHandle,
  VisualizationWorkspaceProps
>(function VisualizationWorkspace({
  context,
  structure,
  onSourceSelect,
  onSeekStep,
  onVariableSelect,
  onMemoryObjectSelect,
}, ref) {
  const desktopRef = useRef<HTMLDivElement | null>(null)
  const lastFollowedFunction = useRef<string | null>(null)
  const autoOpenedVariables = useRef(false)
  const [windows, setWindows] = useState<WindowState[]>(readWindows)
  const [desktopSize, setDesktopSize] = useState({ width: 560, height: 700 })
  const [topZ, setTopZ] = useState(() => Math.max(1, ...readWindows().map((window) => window.z)))
  const hasCurrentCursor = Boolean(context?.execution.current)

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

  const openWindow = useCallback((
    moduleId: string,
    scope: VisualizationScope = { kind: 'program' },
  ) => {
    const definition = visualizationModuleById.get(moduleId)
    if (!definition || !context) return
    const requestedFunctionId = scope.kind === 'function' ? scope.functionId : undefined
    const functionNode = moduleId === 'function-flow' && requestedFunctionId
      ? structure?.nodes.find((node) =>
          node.kind === 'function' && (node.id === requestedFunctionId || node.stableKey === requestedFunctionId),
        )
      : undefined
    const resolvedScope: VisualizationScope = functionNode
      ? { kind: 'function', functionId: functionNode.id }
      : scope
    if (!definition.supports(context, resolvedScope).available) return
    const instanceKey = functionNode?.stableKey
      ?? (resolvedScope.kind === 'function' ? resolvedScope.functionId : undefined)
      ?? (resolvedScope.kind === 'module' ? resolvedScope.moduleId : undefined)
      ?? (resolvedScope.kind === 'variable' ? resolvedScope.variableId : undefined)
      ?? (resolvedScope.kind === 'data-structure' ? resolvedScope.rootVariableId : undefined)
      ?? (resolvedScope.kind === 'memory-object' ? resolvedScope.memoryObjectId : undefined)
    const id = definition.allowMultiple && instanceKey
      ? `${moduleId}:${instanceKey}`
      : moduleId
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
      instanceKey,
      scope: resolvedScope,
      title: functionNode
        ? `${functionNode.name ?? '函数'} 流程`
        : resolvedScope.kind === 'data-structure'
          ? `${context.execution.current?.variables.find((item) => item.id === resolvedScope.rootVariableId)?.name ?? '变量'} 结构`
          : definition.title,
      x: Math.min(18 + offset, Math.max(0, desktopSize.width - width)),
      y: Math.min(48 + offset, Math.max(0, desktopSize.height - height)),
      width,
      height,
      z: nextZ,
      minimized: false,
      maximized: false,
    }])
    setTopZ(nextZ)
  }, [commitWindows, context, desktopSize, focusWindow, structure, topZ, windows])

  const resetWindows = useCallback(() => {
    localStorage.removeItem(WINDOWS_KEY)
    const moduleId = hasCurrentCursor ? 'variable-inspector' : 'call-graph'
    const definition = visualizationModuleById.get(moduleId)
    const defaults: WindowState[] = definition ? [{
      id: moduleId,
      moduleId,
      title: definition.title,
      x: 18,
      y: 48,
      width: Math.min(definition.defaultSize.width, Math.max(definition.minSize.width, desktopSize.width - 36)),
      height: Math.min(definition.defaultSize.height, Math.max(definition.minSize.height, desktopSize.height - 64)),
      z: 1,
      minimized: false,
      maximized: false,
    }] : []
    saveWindows(defaults)
    setWindows(defaults)
    setTopZ(1)
  }, [desktopSize.height, desktopSize.width, hasCurrentCursor])

  useImperativeHandle(ref, () => ({ openVisualization: openWindow, resetWindows }), [openWindow, resetWindows])

  useEffect(() => {
    if (!structure) return
    const functionKeys = new Set(
      structure.nodes.filter((node) => node.kind === 'function').map((node) => node.stableKey),
    )
    // Window state must follow a newly parsed structure; stale function instances cannot render safely.
    // oxlint-disable-next-line react/set-state-in-effect
    commitWindows((current) => current.filter((window) =>
      window.moduleId !== 'function-flow' || Boolean(window.instanceKey && functionKeys.has(window.instanceKey)),
    ))
  }, [commitWindows, structure])

  useEffect(() => {
    if (!context?.execution.current) return
    const variableIds = new Set(context.execution.current.variables.map((variable) => variable.id))
    // The workspace persists external window state; remove instances whose runtime root disappeared.
    // oxlint-disable-next-line react/set-state-in-effect
    commitWindows((current) => current.filter((window) =>
      window.moduleId !== 'data-structure' || Boolean(window.instanceKey && variableIds.has(window.instanceKey)),
    ))
  }, [commitWindows, context?.execution])

  useEffect(() => {
    const functionId = context?.execution.current?.functionId
    if (
      context?.presentation.followExecution
      && functionId
      && functionId !== lastFollowedFunction.current
      && context.static.functionGraphs.has(functionId)
    ) {
      lastFollowedFunction.current = functionId
      openWindow('function-flow', { kind: 'function', functionId })
    }
  }, [context, openWindow])

  useEffect(() => {
    if (!autoOpenedVariables.current && context?.execution.current) {
      autoOpenedVariables.current = true
      openWindow('variable-inspector')
    }
  }, [context, openWindow])

  if (!context || !structure) return null

  const actions: VisualizationActions = {
    seekStep: onSeekStep,
    selectSourceNode: onSourceSelect,
    selectFunction: (functionId) => openWindow('function-flow', { kind: 'function', functionId }),
    selectVariable: onVariableSelect,
    selectMemoryObject: onMemoryObjectSelect,
    openDataStructure: (rootVariableId) => openWindow('data-structure', { kind: 'data-structure', rootVariableId }),
    focusMemoryObject: (memoryObjectId) => {
      onMemoryObjectSelect(memoryObjectId)
      openWindow('memory-graph')
    },
    openVisualization: openWindow,
    closeVisualization: (instanceId) =>
      commitWindows((current) => current.filter((item) => item.id !== instanceId)),
  }

  return (
    <div className="visualization-overlay" ref={desktopRef} aria-label="通用可视化工作区">
      <div className="visualization-launcher">
        <button type="button" onClick={() => openWindow('variable-inspector')}>变量</button>
        <button type="button" onClick={() => openWindow('memory-graph')}>内存图</button>
        {context.selection.variableId && (
          <button type="button" onClick={() => openWindow('data-structure', {
            kind: 'data-structure',
            rootVariableId: context.selection.variableId!,
          })}>当前变量结构</button>
        )}
        <button type="button" onClick={() => openWindow('call-graph')}>函数总图</button>
        {context.execution.current?.functionId && (
          <button type="button" onClick={() => openWindow(
            'function-flow',
            { kind: 'function', functionId: context.execution.current!.functionId! },
          )}>当前函数</button>
        )}
        <button type="button" onClick={resetWindows}>恢复</button>
      </div>
      {windows.map((window) => {
        const definition = visualizationModuleById.get(window.moduleId)
        if (!definition) return null
        const functionNode = window.instanceKey
          ? structure.nodes.find((node) => node.kind === 'function' && node.stableKey === window.instanceKey)
          : undefined
        const scope = functionNode
          ? { kind: 'function' as const, functionId: functionNode.id }
          : window.scope ?? { kind: 'program' as const }
        if (!definition.supports(context, scope).available) return null
        const Module = definition.component
        return (
          <Rnd
            key={window.id}
            bounds="parent"
            dragHandleClassName="visual-window-titlebar"
            disableDragging={window.maximized}
            enableResizing={!window.maximized && !window.minimized}
            minWidth={definition.minSize.width}
            minHeight={definition.minSize.height}
            size={{
              width: window.maximized ? Math.max(0, desktopSize.width - 8) : window.width,
              height: window.minimized ? 38 : window.maximized ? Math.max(0, desktopSize.height - 8) : window.height,
            }}
            position={{ x: window.maximized ? 4 : window.x, y: window.maximized ? 4 : window.y }}
            style={{ zIndex: window.z, pointerEvents: 'auto' }}
            onMouseDown={() => focusWindow(window.id)}
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
                  <button type="button" title={window.minimized ? '展开' : '最小化'} onClick={() =>
                    commitWindows((current) => current.map((item) => item.id === window.id
                      ? { ...item, minimized: !item.minimized, maximized: false }
                      : item))
                  }>{window.minimized ? '□' : '—'}</button>
                  <button type="button" title={window.maximized ? '还原' : '最大化'} onClick={() =>
                    commitWindows((current) => current.map((item) => item.id === window.id
                      ? { ...item, maximized: !item.maximized, minimized: false }
                      : item))
                  }>{window.maximized ? '❐' : '□'}</button>
                  <button type="button" title="关闭" onClick={() =>
                    commitWindows((current) => current.filter((item) => item.id !== window.id))
                  }>×</button>
                </div>
              </header>
              {!window.minimized && (
                <div className="visual-window-body">
                  <Module instanceId={window.id} scope={scope} context={context} actions={actions} />
                </div>
              )}
            </section>
          </Rnd>
        )
      })}
    </div>
  )
})
