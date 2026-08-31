import { describe, expect, it } from 'vitest'
import type { ExecutionCursor } from '../types/executionCursor'
import type { VisualizationContext } from '../types/visualization'
import { buildInitializedVariableIds } from './initializedVariables'

const local = (name: string) => ({
  id: `frame:main:${name}`,
  frameId: 'frame:main',
  name,
  type: 'struct TreeNode',
  value: '{...}',
  scope: 'main',
  role: 'local' as const,
  fields: [],
})

describe('buildInitializedVariableIds', () => {
  it('uses the executed declaration line instead of nearby stack byte changes', () => {
    const n4 = local('n4')
    const n3 = local('n3')
    const cursor = {
      executedLocation: { file: 'main.c', line: 17 },
      variables: [n4, n3],
      callStack: [{ id: 'frame:main', function: 'main', variables: [n4.id, n3.id] }],
      changes: [{ kind: 'update', variableId: n3.id }],
    } as unknown as ExecutionCursor
    const context = {
      execution: { currentIndex: 0, history: [cursor] },
      static: {
        structure: {
          nodes: [
            {
              kind: 'variable', name: 'n4',
              range: { file: 'main.c', start: { line: 17, column: 3 }, end: { line: 17, column: 38 } },
              details: { initialValue: '{4, NULL, NULL}' },
            },
            {
              kind: 'variable', name: 'n3',
              range: { file: 'main.c', start: { line: 20, column: 3 }, end: { line: 20, column: 38 } },
              details: { initialValue: '{3, NULL, NULL}' },
            },
          ],
        },
      },
    } as unknown as VisualizationContext

    const initialized = buildInitializedVariableIds(context)
    expect(initialized.has(n4.id)).toBe(true)
    expect(initialized.has(n3.id)).toBe(false)
  })
})
