import { describe, expect, it } from 'vitest'
import type { ExecutionCursor } from '../types/executionCursor'
import type { MemoryObject, PointerReference, TraceStep, TraceVariable } from '../types/trace'
import { buildPointerTopology, detectStructure } from './pointerTopology'

const pointer = (
  id: string,
  sourceVariableId: string,
  targetObjectId: string | undefined,
  role = 'next',
  status: PointerReference['status'] = targetObjectId ? 'resolved' : 'null',
): PointerReference => ({
  id,
  sourceVariableId,
  sourceExpression: `${sourceVariableId}.${role}`,
  addressValue: targetObjectId ? '0x2000' : '0x0',
  targetObjectId,
  status,
})

const cursor = (
  variables: TraceVariable[],
  pointers: PointerReference[] = [],
  objects: MemoryObject[] = [],
): ExecutionCursor => {
  const traceStep: TraceStep = {
    step: 0,
    location: { file: 'main.c', line: 1 },
    event: { type: 'function_enter', data: {} },
    state: { variables, callStack: [], memory: objects, pointers },
    output: { stdout: '', stderr: '' },
  }
  return {
    step: 0,
    currentLocation: traceStep.location,
    ancestorNodeIds: [], activeModulePath: [], variables, callStack: [],
    memory: { variables, callStack: [], objects, pointers },
    changes: [], facts: [], activeMemoryIds: [], traceStep,
  }
}

const head: TraceVariable = {
  id: 'main:head', name: 'head', type: 'Node *', value: '0x2000', scope: 'main',
  storage: { address: '0x1000', size: 8, region: 'stack', available: true },
}

const object = (id: string, address: string): MemoryObject => ({
  id, address, size: 16, type: 'Node', value: {}, region: 'heap', lifetime: { status: 'alive' },
})

describe('pointer topology and deterministic structure detection', () => {
  it('detects a linear linked sequence and preserves the pointer variable as its root', () => {
    const pointers = [
      pointer('p:head', 'main:head', 'heap:1', 'target'),
      pointer('p:1:next', 'heap:1', 'heap:2'),
      pointer('p:2:next', 'heap:2', undefined),
    ]
    const current = cursor([head], pointers, [object('heap:1', '0x2000'), object('heap:2', '0x2010')])
    const detected = detectStructure(current, head.id)

    expect(detected.shape).toBe('linked_sequence')
    expect(detected.confidence).toBe('certain')
    expect(detected.topology.nodes.map((node) => node.memoryObjectId)).toEqual(['main:head', 'heap:1', 'heap:2'])
  })

  it('detects a circular list without recursing forever', () => {
    const pointers = [
      pointer('p:head', 'main:head', 'heap:1', 'target'),
      pointer('p:1:next', 'heap:1', 'heap:2'),
      pointer('p:2:next', 'heap:2', 'heap:1'),
    ]
    const detected = detectStructure(
      cursor([head], pointers, [object('heap:1', '0x2000'), object('heap:2', '0x2010')]),
      head.id,
    )

    expect(detected.shape).toBe('circular_sequence')
    expect(detected.topology.nodes).toHaveLength(3)
  })

  it('uses branching and parent counts to distinguish trees from general graphs', () => {
    const base = [pointer('p:head', 'main:head', 'heap:1', 'target')]
    const treePointers = [
      ...base,
      pointer('p:1:left', 'heap:1', 'heap:2', 'left'),
      pointer('p:1:right', 'heap:1', 'heap:3', 'right'),
    ]
    const objects = [object('heap:1', '0x2000'), object('heap:2', '0x2010'), object('heap:3', '0x2020')]
    expect(detectStructure(cursor([head], treePointers, objects), head.id).shape).toBe('tree')

    const graphPointers = [
      ...treePointers,
      pointer('p:2:shared', 'heap:2', 'heap:3', 'edge'),
    ]
    expect(detectStructure(cursor([head], graphPointers, objects), head.id).shape).toBe('graph')
  })

  it('recognizes arrays and matrices from observed runtime values', () => {
    const array: TraceVariable = { id: 'main:a', name: 'a', type: 'int [3]', value: [1, 2, 3], scope: 'main' }
    const matrix: TraceVariable = { id: 'main:m', name: 'm', type: 'int [2][2]', value: [[1, 2], [3, 4]], scope: 'main' }
    const current = cursor([array, matrix])

    expect(detectStructure(current, array.id).shape).toBe('contiguous_sequence')
    expect(detectStructure(current, matrix.id).shape).toBe('matrix')
  })

  it('caps traversal and marks a truncated topology', () => {
    const pointers = [
      pointer('p:head', 'main:head', 'heap:1', 'target'),
      pointer('p:1', 'heap:1', 'heap:2'),
      pointer('p:2', 'heap:2', 'heap:3'),
    ]
    const topology = buildPointerTopology(
      cursor([head], pointers, [object('heap:1', '0x2000'), object('heap:2', '0x2010'), object('heap:3', '0x2020')]),
      head.id,
      { maxNodes: 2 },
    )

    expect(topology.nodes).toHaveLength(2)
    expect(topology.truncated).toBe(true)
  })
})
