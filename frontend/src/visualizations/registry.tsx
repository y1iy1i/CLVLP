import type { ComponentType } from 'react'
import type { CodeStructure } from '../types/codeStructure'
import type { FlowGraph } from '../types/flowGraph'
import { CallGraphModule, FunctionFlowModule } from './VisualizationModules'

export interface VisualizationContext {
  structure: CodeStructure
  callGraph: FlowGraph
  functionGraphs: Map<string, FlowGraph>
  activeSourceNodeId: string | null
  ancestorSourceNodeIds: string[]
  onSourceSelect: (sourceNodeId: string) => void
  onOpenFunction: (functionId: string) => void
}

export interface VisualizationModuleProps {
  context: VisualizationContext
  instanceKey?: string
}

export interface VisualizationModuleDefinition {
  id: 'call-graph' | 'function-flow'
  title: string
  component: ComponentType<VisualizationModuleProps>
  defaultSize: { width: number; height: number }
  minSize: { width: number; height: number }
  allowMultiple: boolean
}

export const visualizationRegistry: VisualizationModuleDefinition[] = [
  {
    id: 'call-graph',
    title: '函数总关系图',
    component: CallGraphModule,
    defaultSize: { width: 500, height: 430 },
    minSize: { width: 320, height: 240 },
    allowMultiple: false,
  },
  {
    id: 'function-flow',
    title: '函数流程图',
    component: FunctionFlowModule,
    defaultSize: { width: 500, height: 500 },
    minSize: { width: 320, height: 260 },
    allowMultiple: true,
  },
]

export const visualizationModuleById = new Map(
  visualizationRegistry.map((module) => [module.id, module]),
)
