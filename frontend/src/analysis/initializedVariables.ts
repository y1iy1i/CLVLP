import type { VisualizationContext } from '../types/visualization'

const lineInside = (line: number, start: { line: number; column: number }, end: { line: number; column: number }) =>
  line >= start.line && (line < end.line || (line === end.line && end.column > 1))

export function buildInitializedVariableIds(context: VisualizationContext) {
  const initialized = new Set<string>()
  const end = Math.min(context.execution.currentIndex, context.execution.history.length - 1)
  if (end < 0) return initialized
  const structureNodes = context.static.structure.nodes

  context.execution.history.slice(0, end + 1).forEach((cursor) => {
    cursor.variables.forEach((variable) => {
      if (variable.role === 'parameter' || variable.role === 'global') initialized.add(variable.id)
    })
    cursor.changes.forEach((change) => {
      if (change.kind === 'declare') initialized.add(change.variableId)
    })

    const executed = cursor.executedLocation
    if (!executed) return
    const currentFrameIds = new Set(cursor.callStack[0]?.variables ?? [])
    const names = structureNodes.flatMap((node) => {
      if (node.range.file !== executed.file || !lineInside(executed.line, node.range.start, node.range.end)) return []
      if (node.kind === 'variable' && node.details.initialValue !== undefined && node.name) return [node.name]
      if (node.kind === 'assignment' && node.details.target) {
        const match = node.details.target.match(/^[A-Za-z_]\w*/)
        return match ? [match[0]] : []
      }
      return []
    })
    names.forEach((name) => {
      const candidate = cursor.variables.find((variable) =>
        variable.name === name && (variable.role === 'global' || currentFrameIds.has(variable.id)),
      )
      if (candidate) initialized.add(candidate.id)
    })
  })
  return initialized
}
