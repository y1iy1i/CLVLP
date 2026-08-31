import { describe, expect, it } from 'vitest'
import type { ExecutionCursor, SemanticFact } from '../types/executionCursor'
import type { TraceStep, TraceVariable } from '../types/trace'
import type { VisualizationContext } from '../types/visualization'
import { buildMemoryMapModel } from './memoryMap'

const location = { file: 'main.c', line: 5 }

const variable = (
  id: string,
  name: string,
  value: unknown,
  address: string | undefined,
  size: number | undefined,
  region: 'stack' | 'global' | 'heap' | 'register' | 'unknown',
): TraceVariable => ({
  id,
  frameId: region === 'stack' || region === 'register' ? 'frame:main' : undefined,
  name,
  type: name === 'arr' ? 'int [3]' : 'int',
  value,
  scope: region === 'global' ? 'global' : 'main',
  storage: { address, size, region, available: true },
  fields: [],
})

const step = (index: number, variables: TraceVariable[]): TraceStep => ({
  step: index,
  location,
  event: { type: 'line_executed', data: {} },
  state: {
    variables,
    callStack: [{ id: 'frame:main', function: 'main', variables: variables.map((item) => item.id) }],
    memory: [],
    pointers: [],
  },
  output: { stdout: '', stderr: '' },
})

const cursor = (
  index: number,
  variables: TraceVariable[],
  facts: SemanticFact[],
  objects: ExecutionCursor['memory']['objects'] = [],
): ExecutionCursor => {
  const traceStep = step(index, variables)
  return {
    step: index,
    currentLocation: location,
    ancestorNodeIds: [],
    activeModulePath: [],
    variables,
    callStack: traceStep.state.callStack,
    memory: { variables, callStack: traceStep.state.callStack, objects, pointers: [] },
    changes: [],
    facts,
    activeMemoryIds: [],
    traceStep,
  }
}

const fact = (
  id: string,
  variableId: string,
  access: 'read' | 'write',
): SemanticFact => ({
  id,
  kind: 'variable_access',
  variableId,
  variableName: variableId,
  access,
  location,
  activeVariableIds: [variableId],
  activeMemoryObjectIds: [variableId],
  origin: 'derived',
})

const context = (
  history: ExecutionCursor[],
  currentIndex = history.length - 1,
  selectedMemoryObjectId?: string,
): VisualizationContext => ({
  schemaVersion: '1.0',
  source: { code: '', entryFile: 'main.c' },
  static: {
    structure: {
      schemaVersion: '1.0', analysisId: 'test', status: 'completed', provider: 'tree-sitter',
      source: { entryFile: 'main.c', files: ['main.c'], language: 'c' },
      nodes: [], relations: [], diagnostics: [],
      summary: { totalNodes: 0, totalRelations: 0, nodeCounts: {} },
    },
    programMap: null,
    callGraph: { id: 'calls', kind: 'call_graph', title: '', nodes: [], edges: [], diagnostics: [], truncated: false },
    functionGraphs: new Map(),
  },
  execution: {
    status: 'completed',
    current: history[currentIndex] ?? null,
    previous: currentIndex > 0 ? history[currentIndex - 1] : null,
    history,
    currentIndex,
  },
  selection: { memoryObjectId: selectedMemoryObjectId },
  teaching: { mode: 'beginner' },
  presentation: { followExecution: true },
})

describe('buildMemoryMapModel', () => {
  it('keeps memory regions separate and reports only observed gaps', () => {
    const variables = [
      variable('main:a', 'a', 1, '0x1000', 4, 'stack'),
      variable('main:b', 'b', 2, '0x1008', 4, 'stack'),
      variable('global:g', 'g', 3, '0x4000', 4, 'global'),
    ]
    const model = buildMemoryMapModel(context([cursor(0, variables, [])]))

    expect(model.lanes.stack.capturedBytes).toBe(8)
    expect(model.lanes.global.capturedBytes).toBe(4)
    expect(model.lanes.stack.discontinuities).toEqual([{ afterRangeId: 'main:a', gapBytes: 4 }])
    expect(model.lanes.stack.ranges[0].endAddress).toBe('0x1004')
  })

  it('merges variables with memory objects and excludes freed heap from live bytes', () => {
    const variables = [variable('main:arr', 'arr', [1, 2, 3], '0x2000', 12, 'stack')]
    const objects: ExecutionCursor['memory']['objects'] = [
      { id: 'main:arr', address: '0x2000', size: 12, type: 'int [3]', value: [1, 2, 3], region: 'stack' },
      { id: 'heap:1', address: '0x9000', size: 32, type: 'void *', value: null, region: 'heap', lifetime: { status: 'alive' } },
      { id: 'heap:old', address: '0x9100', size: 16, type: 'void *', value: null, region: 'heap', lifetime: { status: 'freed' } },
    ]
    const model = buildMemoryMapModel(context([cursor(0, variables, [], objects)]))

    expect(model.lanes.stack.ranges).toHaveLength(1)
    expect(model.summary.liveHeapBytes).toBe(32)
    expect(model.summary.freedHeapBytes).toBe(16)
  })

  it('shows only the current step access and prioritizes current writes', () => {
    const variables = [variable('main:a', 'a', 3, '0x1000', 4, 'stack')]
    const history = [
      cursor(0, variables, [fact('read-0', 'main:a', 'read')]),
      cursor(1, variables, [fact('write-1', 'main:a', 'write')]),
      cursor(2, variables, [fact('read-2', 'main:a', 'read')]),
    ]
    const model = buildMemoryMapModel(context(history, 1))
    const range = model.lanes.stack.ranges[0]

    expect(range.activeAccess).toBe('write')
  })

  it('selects an array parent when an element memory id is selected', () => {
    const variables = [variable('main:arr', 'arr', [1, 2, 3], '0x2000', 12, 'stack')]
    const model = buildMemoryMapModel(context(
      [cursor(0, variables, [])],
      0,
      'main:arr:element:1',
    ))

    expect(model.lanes.stack.ranges[0].selected).toBe(true)
  })
})
