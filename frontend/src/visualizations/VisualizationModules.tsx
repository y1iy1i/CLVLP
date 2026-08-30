import type { VisualizationModuleProps } from './registry'
import { FlowGraphCanvas } from './structure/FlowGraphCanvas'

export function CallGraphModule({ context }: VisualizationModuleProps) {
  return (
    <FlowGraphCanvas
      graph={context.callGraph}
      activeSourceNodeId={context.activeSourceNodeId}
      ancestorSourceNodeIds={context.ancestorSourceNodeIds}
      onSourceSelect={context.onSourceSelect}
      onOpenFunction={context.onOpenFunction}
    />
  )
}

export function FunctionFlowModule({ context, instanceKey }: VisualizationModuleProps) {
  const functionNode = instanceKey
    ? context.structure.nodes.find((node) => node.kind === 'function' && node.stableKey === instanceKey)
    : undefined
  const graph = functionNode ? context.functionGraphs.get(functionNode.id) : undefined
  if (!graph) return <div className="visualization-empty">函数已不存在或尚未完成解析。</div>
  return (
    <FlowGraphCanvas
      graph={graph}
      activeSourceNodeId={context.activeSourceNodeId}
      ancestorSourceNodeIds={context.ancestorSourceNodeIds}
      onSourceSelect={context.onSourceSelect}
    />
  )
}
