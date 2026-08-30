import type { VisualizationModuleProps } from './registry'
import { FlowGraphCanvas } from './structure/FlowGraphCanvas'

export function CallGraphModule({ context, actions }: VisualizationModuleProps) {
  return (
    <FlowGraphCanvas
      graph={context.static.callGraph}
      activeSourceNodeId={context.execution.current?.currentNodeId ?? null}
      ancestorSourceNodeIds={context.execution.current?.ancestorNodeIds ?? []}
      autoExpandAncestors={context.presentation.followExecution}
      onSourceSelect={actions.selectSourceNode}
      onOpenFunction={(functionId) => actions.openVisualization(
        'function-flow',
        { kind: 'function', functionId },
      )}
    />
  )
}

export function FunctionFlowModule({ context, scope, actions }: VisualizationModuleProps) {
  const graph = scope.kind === 'function'
    ? context.static.functionGraphs.get(scope.functionId)
    : undefined
  if (!graph) return <div className="visualization-empty">函数已不存在或尚未完成解析。</div>
  return (
    <FlowGraphCanvas
      graph={graph}
      activeSourceNodeId={context.execution.current?.currentNodeId ?? null}
      ancestorSourceNodeIds={context.execution.current?.ancestorNodeIds ?? []}
      autoExpandAncestors={context.presentation.followExecution}
      onSourceSelect={actions.selectSourceNode}
    />
  )
}
