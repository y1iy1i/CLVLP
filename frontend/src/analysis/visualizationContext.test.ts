import { describe, expect, it } from 'vitest'
import type { CodeStructure } from '../types/codeStructure'
import type { ExecutionCursor } from '../types/executionCursor'
import type { FlowGraph } from '../types/flowGraph'
import type { ExecutionTrace, TraceStep } from '../types/trace'
import { buildTeachingStep } from './teachingStep'
import { buildVisualizationContext } from './visualizationContext'

const traceStep: TraceStep = {
  step: 1,
  location: { file: 'main.c', line: 3 },
  event: { type: 'line_executed', data: {} },
  state: {
    variables: [
      { id: 'main:a', name: 'a', type: 'int', value: 5, scope: 'main' },
      { id: 'main:b', name: 'b', type: 'int', value: 3, scope: 'main' },
    ],
    callStack: [{ id: 'frame:main:1', function: 'main', variables: ['main:a', 'main:b'] }],
    memory: [],
    pointers: [],
  },
  output: { stdout: '', stderr: '' },
}

const cursor: ExecutionCursor = {
  step: 1,
  currentLocation: traceStep.location,
  currentNodeId: 'condition:1',
  functionId: 'function:main',
  ancestorNodeIds: ['function:main'],
  activeModulePath: [],
  variables: traceStep.state.variables,
  callStack: traceStep.state.callStack,
  memory: {
    variables: traceStep.state.variables,
    callStack: traceStep.state.callStack,
    objects: [],
    pointers: [],
  },
  changes: [],
  facts: [{
    kind: 'comparison',
    expression: 'a > b',
    operator: '>',
    operands: [
      { role: 'left', expression: 'a', kind: 'scalar', variableId: 'main:a', value: 5, resolved: true },
      { role: 'right', expression: 'b', kind: 'scalar', variableId: 'main:b', value: 3, resolved: true },
    ],
    result: true,
  }],
  activeMemoryIds: ['main:a', 'main:b'],
  traceStep,
}

const structure: CodeStructure = {
  schemaVersion: '1.0',
  analysisId: 'analysis-1',
  status: 'completed',
  provider: 'tree-sitter',
  source: { entryFile: 'main.c', files: ['main.c'], language: 'c' },
  nodes: [],
  relations: [],
  diagnostics: [],
  summary: { totalNodes: 0, totalRelations: 0, nodeCounts: {} },
}

const callGraph: FlowGraph = {
  id: 'call-graph',
  kind: 'call_graph',
  title: '函数关系',
  nodes: [],
  edges: [],
  diagnostics: [],
  truncated: false,
}

describe('visualization context', () => {
  it('creates a beginner explanation from deterministic comparison facts', () => {
    const teaching = buildTeachingStep(cursor)

    expect(teaching?.title).toBe('正在比较两个值')
    expect(teaching?.description).toContain('a = 5')
    expect(teaching?.result).toBe('条件结果：成立')
    expect(teaching?.activeVariableIds).toEqual(['main:a', 'main:b'])
  })

  it('combines static structure and the selected execution cursor', () => {
    const trace: ExecutionTrace = {
      schemaVersion: '1.2',
      runId: 'run-1',
      status: 'completed',
      source: { entryFile: 'main.c', language: 'c' },
      trace: [traceStep],
      summary: { totalSteps: 1, exitCode: 0, truncated: false },
      error: null,
    }

    const context = buildVisualizationContext({
      code: 'int main(void) { return 0; }',
      entryFile: 'main.c',
      structure,
      programMap: null,
      callGraph,
      functionGraphs: new Map(),
      trace,
      isRunning: false,
      history: [cursor],
      currentIndex: 0,
      selection: { variableId: 'main:a' },
      teachingMode: 'beginner',
      followExecution: true,
    })

    expect(context.execution.current).toBe(cursor)
    expect(context.execution.status).toBe('completed')
    expect(context.selection.variableId).toBe('main:a')
    expect(context.teaching.currentStep?.result).toBe('条件结果：成立')
    expect(context.static.callGraph).toBe(callGraph)
  })
})
