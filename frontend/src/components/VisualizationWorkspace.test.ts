import { describe, expect, it } from 'vitest'
import type { ExecutionCursor } from '../types/executionCursor'
import type { VisualizationContext } from '../types/visualization'
import type { TraceVariable } from '../types/trace'
import {
  isDataStructureVariable,
  preferredDataStructureVariableId,
} from './visualizationLauncherModel'

const variable = (id: string, value: unknown, extra: Partial<TraceVariable> = {}): TraceVariable => ({
  id,
  name: id,
  type: 'int',
  value,
  scope: 'main',
  ...extra,
})

const contextWith = (
  variables: TraceVariable[],
  selection: VisualizationContext['selection'] = {},
): VisualizationContext => ({
  execution: { current: { variables } as ExecutionCursor } as VisualizationContext['execution'],
  selection,
} as VisualizationContext)

describe('visualization launcher data structure selection', () => {
  it('recognizes arrays, records and pointers but not scalar loop variables', () => {
    expect(isDataStructureVariable(variable('i', 2))).toBe(false)
    expect(isDataStructureVariable(variable('arr', [5, 1, 4]))).toBe(true)
    expect(isDataStructureVariable(variable('node', {}, { fields: [{ name: 'value', type: 'int', value: 1, fields: [] }] }))).toBe(true)
    expect(isDataStructureVariable(variable('head', '0x1000', { pointer: { id: 'p', sourceVariableId: 'head', status: 'resolved' } }))).toBe(true)
  })

  it('opens the bubble-sort array without requiring a prior selection', () => {
    const context = contextWith([
      variable('i', 0),
      variable('arr', [5, 1, 4, 2, 8]),
      variable('n', 5),
    ])
    expect(preferredDataStructureVariableId(context)).toBe('arr')
  })

  it('prefers a selected structure variable over the automatic candidate', () => {
    const context = contextWith(
      [variable('arr', [1, 2]), variable('matrix', [[1, 0], [0, 1]])],
      { variableId: 'matrix' },
    )
    expect(preferredDataStructureVariableId(context)).toBe('matrix')
  })
})
