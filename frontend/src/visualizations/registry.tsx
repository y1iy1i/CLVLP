import type { ComponentType } from 'react'
import type {
  VisualizationActions,
  VisualizationCategory,
  VisualizationContext,
  VisualizationScope,
  VisualizationSupport,
} from '../types/visualization'
import { CallGraphModule, FunctionFlowModule } from './VisualizationModules'
import { VariableInspector } from './variables/VariableInspector'
import { MemoryGraph } from './memory/MemoryGraph'
import { DataStructureView } from './dataStructure/DataStructureView'

export type { VisualizationContext } from '../types/visualization'

export interface VisualizationModuleProps {
  instanceId: string
  scope: VisualizationScope
  context: VisualizationContext
  actions: VisualizationActions
}

export interface VisualizationModuleDefinition {
  id: string
  title: string
  category: VisualizationCategory
  component: ComponentType<VisualizationModuleProps>
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
  allowMultiple: boolean
  supports: (
    context: VisualizationContext,
    scope: VisualizationScope,
  ) => VisualizationSupport
}

export const visualizationRegistry: VisualizationModuleDefinition[] = [
  {
    id: 'variable-inspector',
    title: '变量观察器',
    category: 'runtime-state',
    component: VariableInspector,
    defaultSize: { width: 460, height: 480 },
    minSize: { width: 340, height: 260 },
    allowMultiple: false,
    supports: () => ({ available: true, priority: 110 }),
  },
  {
    id: 'memory-graph',
    title: '内存与指针图',
    category: 'memory',
    component: MemoryGraph,
    defaultSize: { width: 680, height: 580 },
    minSize: { width: 440, height: 340 },
    allowMultiple: false,
    supports: (context) => ({
      available: Boolean(context.execution.current),
      reason: context.execution.current ? undefined : '运行 Trace 后才能查看内存图。',
      priority: 105,
    }),
  },
  {
    id: 'data-structure',
    title: '数据结构视图',
    category: 'data-flow',
    component: DataStructureView,
    defaultSize: { width: 600, height: 520 },
    minSize: { width: 380, height: 300 },
    allowMultiple: true,
    supports: (context, scope) => ({
      available: scope.kind === 'data-structure'
        && Boolean(context.execution.current?.variables.some((item) => item.id === scope.rootVariableId)),
      reason: scope.kind === 'data-structure' ? '当前 Run 中没有这个根变量。' : '数据结构视图需要根变量。',
      priority: 100,
    }),
  },
  {
    id: 'call-graph',
    title: '函数总关系图',
    category: 'architecture',
    component: CallGraphModule,
    defaultSize: { width: 500, height: 430 },
    minSize: { width: 320, height: 240 },
    allowMultiple: false,
    supports: () => ({ available: true, priority: 100 }),
  },
  {
    id: 'function-flow',
    title: '函数流程图',
    category: 'data-flow',
    component: FunctionFlowModule,
    defaultSize: { width: 500, height: 500 },
    minSize: { width: 320, height: 260 },
    allowMultiple: true,
    supports: (context, scope) => ({
      available: scope.kind === 'function' && context.static.functionGraphs.has(scope.functionId),
      reason: scope.kind === 'function' ? undefined : '函数流程图需要一个函数范围。',
      priority: 90,
    }),
  },
]

export const visualizationModuleById = new Map(
  visualizationRegistry.map((module) => [module.id, module]),
)
