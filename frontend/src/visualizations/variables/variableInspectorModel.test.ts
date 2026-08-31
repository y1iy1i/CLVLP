import { describe, expect, it } from 'vitest'
import type { ExecutionCursor } from '../../types/executionCursor'
import type { VisualizationContext } from '../../types/visualization'
import { buildVariableInspectorGroups } from './variableInspectorModel'

const cursor = (
  step: number,
  variables: ExecutionCursor['variables'],
  changes: ExecutionCursor['changes'] = [],
): ExecutionCursor => ({
  step,
  currentLocation: { file: 'main.c', line: step + 1 },
  ancestorNodeIds: [],
  activeModulePath: [],
  variables,
  callStack: [
    { id: 'child', function: 'child', variables: variables.filter((item) => item.frameId === 'child').map((item) => item.id) },
    { id: 'main', function: 'main', variables: variables.filter((item) => item.frameId === 'main').map((item) => item.id) },
  ],
  memory: { variables, callStack: [], objects: [], pointers: [] },
  changes,
  facts: changes.filter((change) => change.kind !== 'out_of_scope').map((change, index) => ({
    id: `fact:${step}:${index}`,
    kind: 'assignment' as const,
    variableId: change.variableId,
    changeKind: change.kind as 'declare' | 'update',
    oldValue: change.oldValue,
    newValue: change.newValue,
    location: { file: 'main.c', line: step },
    activeVariableIds: [change.variableId],
    activeMemoryObjectIds: [change.variableId],
    origin: 'observed' as const,
  })),
  activeMemoryIds: changes.map((change) => change.variableId),
  traceStep: {
    step,
    location: { file: 'main.c', line: step + 1 },
    event: { type: 'line_executed', data: {} },
    state: { variables, callStack: [], memory: [] },
    output: { stdout: '', stderr: '' },
  },
})

const contextFor = (history: ExecutionCursor[], index = history.length - 1): VisualizationContext => ({
  schemaVersion: '1.0',
  source: { code: '', entryFile: 'main.c' },
  static: {
    structure: { schemaVersion: '1.0', status: 'complete', source: { entryFile: 'main.c', language: 'c' }, nodes: [], relations: [], diagnostics: [], summary: { totalNodes: 0, truncated: false } },
    programMap: null,
    callGraph: { id: 'calls', kind: 'call_graph', nodes: [], edges: [], diagnostics: [] },
    functionGraphs: new Map(),
  },
  execution: { status: 'completed', current: history[index], previous: history[index - 1] ?? null, history, currentIndex: index },
  selection: {},
  teaching: { mode: 'beginner' },
  presentation: { followExecution: true },
})

describe('variable inspector model', () => {
  it('groups current, parent and global variables without merging shadowed names', () => {
    const variables = [
      { id: 'child:value', frameId: 'child', name: 'value', type: 'int', value: 2, scope: 'child', role: 'local' as const },
      { id: 'main:value', frameId: 'main', name: 'value', type: 'int', value: 1, scope: 'main', role: 'local' as const },
      { id: 'global:value', name: 'value', type: 'int', value: 10, scope: 'global', role: 'global' as const },
    ]
    const groups = buildVariableInspectorGroups(contextFor([cursor(1, variables, [
      { kind: 'declare', variableId: 'child:value', newValue: 2 },
      { kind: 'declare', variableId: 'main:value', newValue: 1 },
    ])]))

    expect(groups.map((group) => group.title)).toEqual(['child() · 当前函数', 'main()', '全局变量'])
    expect(groups.flatMap((group) => group.items.map((item) => item.variable.id))).toEqual([
      'child:value', 'main:value', 'global:value',
    ])
    expect(groups[0].items[0].activity).toBe('declare')
  })

  it('distinguishes a write from a deterministic read fact', () => {
    const variable = { id: 'main:value', frameId: 'main', name: 'value', type: 'int', value: 1, scope: 'main', role: 'local' as const }
    const declared = cursor(0, [variable], [{ kind: 'declare', variableId: variable.id, newValue: 1 }])
    const written = cursor(1, [{ ...variable, value: 2 }], [{ kind: 'update', variableId: variable.id, oldValue: 1, newValue: 2 }])
    expect(buildVariableInspectorGroups(contextFor([declared, written]))[1].items[0].activity).toBe('write')

    const read = cursor(2, [{ ...variable, value: 2 }])
    read.facts = [{
      id: 'fact:read',
      kind: 'variable_access',
      variableId: variable.id,
      variableName: variable.name,
      access: 'read',
      value: 2,
      location: { file: 'main.c', line: 3 },
      activeVariableIds: [variable.id],
      activeMemoryObjectIds: [variable.id],
      origin: 'derived',
    }]
    expect(buildVariableInspectorGroups(contextFor([declared, written, read]))[1].items[0].activity).toBe('read')
  })

  it('uses at most the latest 20 cursors and preserves numeric gaps', () => {
    const history = Array.from({ length: 24 }, (_, index) => cursor(
      index,
      index === 10 ? [] : [{
        id: 'main:n', frameId: 'main', name: 'n', type: 'int', value: index, scope: 'main', role: 'local' as const,
      }],
      index === 0 ? [{ kind: 'declare', variableId: 'main:n', newValue: 0 }] : [],
    ))
    const item = buildVariableInspectorGroups(contextFor(history))[1].items[0]

    expect(item.history).toHaveLength(20)
    expect(item.history[0].step).toBe(4)
    expect(item.history.find((point) => point.step === 10)?.value).toBeUndefined()
  })

  it('shows the old value for an out-of-scope variable for one step', () => {
    const variable = { id: 'child:temp', frameId: 'child', name: 'temp', type: 'int', value: 3, scope: 'child', role: 'local' as const }
    const previous = cursor(1, [variable])
    const current = cursor(2, [], [{ kind: 'out_of_scope', variableId: variable.id, oldValue: 3 }])
    const groups = buildVariableInspectorGroups(contextFor([previous, current]))

    expect(groups.at(-1)).toMatchObject({ id: 'out-of-scope' })
    expect(groups.at(-1)?.items[0]).toMatchObject({
      activity: 'out_of_scope',
      previousValue: 3,
    })
  })

  it('hides uninitialized locals when a frame is entered but keeps parameters', () => {
    const variables = [
      { id: 'child:argument', frameId: 'child', name: 'argument', type: 'int', value: 2, scope: 'child', role: 'parameter' as const },
      { id: 'child:local', frameId: 'child', name: 'local', type: 'int', value: 987654, scope: 'child', role: 'local' as const },
    ]
    const entered = cursor(1, variables)
    entered.facts = [{
      id: 'fact:enter',
      kind: 'function_call',
      functionName: 'child',
      frameId: 'child',
      argumentVariableIds: ['child:argument'],
      callKind: 'direct',
      location: { file: 'main.c', line: 2 },
      activeVariableIds: ['child:argument'],
      activeMemoryObjectIds: ['child:argument'],
      origin: 'observed',
    }]

    const groups = buildVariableInspectorGroups(contextFor([entered]))

    expect(groups[0].items.map((item) => item.variable.id)).toEqual(['child:argument'])
  })
})
