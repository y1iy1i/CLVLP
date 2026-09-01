import type { TraceVariable } from '../types/trace'
import type { VisualizationContext } from '../types/visualization'

export const isDataStructureVariable = (variable: TraceVariable) =>
  Array.isArray(variable.value)
  || (variable.fields?.length ?? 0) > 0
  || Boolean(variable.pointer)

export const preferredDataStructureVariableId = (context: VisualizationContext) => {
  const candidates = context.execution.current?.variables.filter(isDataStructureVariable) ?? []
  return candidates.find((variable) => variable.id === context.selection.variableId)?.id
    ?? candidates.find((variable) => variable.id === context.selection.structureRootVariableId)?.id
    ?? candidates.find((variable) => variable.id === context.selection.memoryObjectId)?.id
    ?? candidates[0]?.id
}
