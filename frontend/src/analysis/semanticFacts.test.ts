import { beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Language, Parser } from 'web-tree-sitter'
import type { ExecutionState, TraceStep } from '../types/trace'
import { mapCCodeStructure } from './codeStructureMapper'
import { buildSemanticFacts } from './semanticFacts'

let parser: Parser

beforeAll(async () => {
  const runtime = fileURLToPath(new URL('../../node_modules/web-tree-sitter/web-tree-sitter.wasm', import.meta.url))
  const languageWasm = fileURLToPath(new URL('../../node_modules/tree-sitter-c/tree-sitter-c.wasm', import.meta.url))
  await Parser.init({ locateFile: () => runtime })
  parser = new Parser()
  parser.setLanguage(await Language.load(languageWasm))
})

const analyze = (code: string) => {
  const tree = parser.parse(code)
  if (!tree) throw new Error('parse failed')
  try {
    return mapCCodeStructure(tree.rootNode, code, 'main.c')
  } finally {
    tree.delete()
  }
}

const state = (overrides: Partial<ExecutionState> = {}): ExecutionState => ({
  variables: [],
  callStack: [],
  memory: [],
  pointers: [],
  ...overrides,
})

const step = (
  index: number,
  line: number,
  executionState: ExecutionState,
  event: TraceStep['event'] = { type: 'line_executed', data: {} },
  executedLine?: number,
): TraceStep => ({
  step: index,
  location: { file: 'main.c', line },
  executedLocation: executedLine === undefined ? undefined : { file: 'main.c', line: executedLine },
  event,
  state: executionState,
  output: { stdout: '', stderr: '' },
})

describe('SemanticFact adapter', () => {
  it('separates current reads from the assignment that just executed and respects shadowing', () => {
    const structure = analyze(`int x = 100;
int main(void) {
  int x = 1;
  x = x + 1;
  if (x > 1) return x;
  return 0;
}`)
    const previous = step(1, 4, state({
      variables: [
        { id: 'frame:main:1:x', frameId: 'frame:main:1', name: 'x', type: 'int', value: 1, scope: 'main' },
        { id: 'global:x', name: 'x', type: 'int', value: 100, scope: 'global', role: 'global' },
      ],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['frame:main:1:x'] }],
    }))
    const current = step(2, 5, state({
      variables: [
        { id: 'frame:main:1:x', frameId: 'frame:main:1', name: 'x', type: 'int', value: 2, scope: 'main' },
        { id: 'global:x', name: 'x', type: 'int', value: 100, scope: 'global', role: 'global' },
      ],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['frame:main:1:x'] }],
    }), {
      type: 'line_executed',
      data: {
        changes: [{
          kind: 'update',
          variableId: 'frame:main:1:x',
          oldValue: 1,
          newValue: 2,
        }],
      },
    }, 4)

    const result = buildSemanticFacts(structure, current, previous)
    const assignment = result.facts.find((fact) => fact.kind === 'assignment')
    const comparison = result.facts.find((fact) => fact.kind === 'comparison')
    const branch = result.facts.find((fact) => fact.kind === 'branch')

    expect(assignment).toMatchObject({
      variableId: 'frame:main:1:x',
      location: { line: 4 },
      origin: 'observed',
    })
    expect(comparison).toMatchObject({
      result: true,
      location: { line: 5 },
      activeVariableIds: ['frame:main:1:x'],
      origin: 'derived',
    })
    expect(branch).toMatchObject({ selected: 'true', location: { line: 5 } })
    expect(result.facts).toContainEqual(expect.objectContaining({
      kind: 'variable_access',
      access: 'read',
      variableId: 'frame:main:1:x',
      origin: 'derived',
    }))
    expect(result.facts.some((fact) => fact.activeVariableIds.includes('global:x'))).toBe(false)

    const falseStep = step(3, 5, state({
      variables: [{ id: 'frame:main:1:x', frameId: 'frame:main:1', name: 'x', type: 'int', value: 0, scope: 'main' }],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['frame:main:1:x'] }],
    }))
    expect(buildSemanticFacts(structure, falseStep).facts.find(
      (fact) => fact.kind === 'branch',
    )).toMatchObject({ selected: 'false' })
  })

  it.each(['resolved', 'null', 'dangling', 'unreadable', 'unknown'] as const)(
    'emits a %s pointer access without inventing a target',
    (status) => {
      const structure = analyze(`int main(void) {
  int number = 10;
  int *pointer = &number;
  if (*pointer > 0) return 0;
  return 1;
}`)
      const pointer = {
        id: 'pointer:frame:main:1:pointer',
        sourceVariableId: 'frame:main:1:pointer',
        sourceExpression: 'pointer',
        addressValue: status === 'null' ? '0x0' : '0x1000',
        targetObjectId: status === 'resolved' || status === 'dangling' ? 'frame:main:1:number' : undefined,
        status,
      }
      const current = step(3, 4, state({
        variables: [
          { id: 'frame:main:1:number', frameId: 'frame:main:1', name: 'number', type: 'int', value: 10, scope: 'main' },
          { id: 'frame:main:1:pointer', frameId: 'frame:main:1', name: 'pointer', type: 'int *', value: pointer.addressValue, scope: 'main', pointer },
        ],
        callStack: [{ id: 'frame:main:1', function: 'main', variables: ['frame:main:1:number', 'frame:main:1:pointer'] }],
        memory: status === 'resolved'
          ? [{ id: 'frame:main:1:number', address: '0x1000', size: 4, type: 'int', value: 10, region: 'stack' }]
          : [],
        pointers: [pointer],
      }))

      const facts = buildSemanticFacts(structure, current).facts
      const fact = facts.find((item) => item.kind === 'pointer_access')

      expect(fact).toMatchObject({
        status,
        resolved: status === 'resolved',
        access: 'dereference',
      })
      expect(fact?.targetObjectId).toBe(pointer.targetObjectId)
      if (status === 'resolved') {
        expect(facts.find((item) => item.kind === 'comparison')).toMatchObject({ result: true })
      }
    },
  )

  it('distinguishes writing a pointer variable from dereferencing it', () => {
    const structure = analyze(`int main(void) {
  int first = 1;
  int second = 2;
  int *pointer = &first;
  pointer = &second;
  return *pointer;
}`)
    const previous = step(1, 5, state({
      variables: [{
        id: 'frame:main:1:pointer',
        name: 'pointer',
        type: 'int *',
        value: '0x1000',
        scope: 'main',
      }],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['frame:main:1:pointer'] }],
    }))
    const reference = {
      id: 'pointer:frame:main:1:pointer',
      sourceVariableId: 'frame:main:1:pointer',
      sourceExpression: 'pointer',
      addressValue: '0x2000',
      targetObjectId: 'frame:main:1:second',
      status: 'resolved' as const,
    }
    const current = step(2, 6, state({
      variables: [{
        id: 'frame:main:1:pointer',
        name: 'pointer',
        type: 'int *',
        value: '0x2000',
        scope: 'main',
        pointer: reference,
      }],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['frame:main:1:pointer'] }],
      pointers: [reference],
    }), {
      type: 'line_executed',
      data: {
        changes: [{
          kind: 'update',
          variableId: 'frame:main:1:pointer',
          oldValue: '0x1000',
          newValue: '0x2000',
        }],
      },
    }, 5)

    const pointerFacts = buildSemanticFacts(structure, current, previous).facts.filter(
      (fact) => fact.kind === 'pointer_access',
    )
    expect(pointerFacts).toContainEqual(expect.objectContaining({
      access: 'write',
      location: expect.objectContaining({ line: 5 }),
      targetObjectId: 'frame:main:1:second',
    }))
    expect(pointerFacts).toContainEqual(expect.objectContaining({
      access: 'dereference',
      location: expect.objectContaining({ line: 6 }),
      targetObjectId: 'frame:main:1:second',
    }))
  })

  it('combines compound-assignment AST access with an observed value change', () => {
    const structure = analyze(`int main(void) {
  int value = 1;
  value += 2;
  return value;
}`)
    const previous = step(1, 3, state({
      variables: [{ id: 'frame:main:1:value', name: 'value', type: 'int', value: 1, scope: 'main' }],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['frame:main:1:value'] }],
    }))
    const current = step(2, 4, state({
      variables: [{ id: 'frame:main:1:value', name: 'value', type: 'int', value: 3, scope: 'main' }],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['frame:main:1:value'] }],
    }), {
      type: 'line_executed',
      data: { changes: [{ kind: 'update', variableId: 'frame:main:1:value', oldValue: 1, newValue: 3 }] },
    }, 3)

    const facts = buildSemanticFacts(structure, current, previous).facts

    expect(facts.find((fact) => fact.kind === 'assignment')).toMatchObject({ oldValue: 1, newValue: 3 })
    expect(facts).toContainEqual(expect.objectContaining({
      kind: 'variable_access',
      access: 'write',
      variableId: 'frame:main:1:value',
    }))
  })

  it('records calls, recursion and real return values', () => {
    const entry = step(0, 1, state({
      callStack: [{ id: 'frame:main:1', function: 'main', variables: [] }],
    }), {
      type: 'function_enter',
      data: { initial: true, frames: [{ id: 'frame:main:1', function: 'main' }] },
    })
    expect(buildSemanticFacts(null, entry).facts.find(
      (fact) => fact.kind === 'function_call',
    )).toMatchObject({ functionName: 'main', callKind: 'entry', location: { line: 1 } })

    const entered = step(3, 2, state({
      variables: [{ id: 'frame:fact:2:n', frameId: 'frame:fact:2', name: 'n', type: 'int', value: 2, scope: 'fact', role: 'parameter' }],
      callStack: [
        { id: 'frame:fact:2', parentFrameId: 'frame:fact:1', function: 'fact', variables: ['frame:fact:2:n'], arguments: ['frame:fact:2:n'] },
        { id: 'frame:fact:1', parentFrameId: 'frame:main:1', function: 'fact', variables: [] },
        { id: 'frame:main:1', function: 'main', variables: [] },
      ],
    }), {
      type: 'function_enter',
      data: { frames: [{ id: 'frame:fact:2', function: 'fact' }] },
    }, 8)
    const enteredFacts = buildSemanticFacts(null, entered).facts
    expect(enteredFacts.find((fact) => fact.kind === 'function_call')).toMatchObject({
      functionName: 'fact',
      callKind: 'recursive',
      argumentVariableIds: ['frame:fact:2:n'],
      location: { line: 8 },
    })
    expect(enteredFacts.find((fact) => fact.kind === 'recursion')).toMatchObject({ depth: 2 })

    const returned = step(4, 9, state({
      callStack: [{ id: 'frame:main:1', function: 'main', variables: [] }],
    }), {
      type: 'function_exit',
      data: {
        frames: [{
          id: 'frame:fact:1',
          function: 'fact',
          returnAvailable: true,
          returnType: 'int',
          returnValue: 2,
        }, {
          id: 'frame:void:1',
          function: 'log_value',
          returnAvailable: false,
        }],
      },
    }, 3)
    expect(buildSemanticFacts(null, returned).facts.find((fact) => fact.kind === 'function_return')).toMatchObject({
      functionName: 'fact',
      returnAvailable: true,
      returnType: 'int',
      returnValue: 2,
      location: { line: 3 },
    })
    expect(buildSemanticFacts(null, returned).facts.find(
      (fact) => fact.kind === 'function_return' && fact.functionName === 'log_value',
    )).toMatchObject({ returnAvailable: false })
  })

  it('normalizes allocation, realloc, free and failed allocation records', () => {
    const previous = step(1, 3, state({
      memory: [{ id: 'heap:1', address: '0x1000', size: 8, type: 'int', value: null, region: 'heap' }],
    }))
    const current = step(2, 4, state({
      memory: [
        { id: 'heap:1', address: '0x1000', size: 8, type: 'int', value: null, region: 'heap', lifetime: { status: 'freed' } },
        { id: 'heap:2', address: '0x2000', size: 16, type: 'int', value: null, region: 'heap' },
      ],
    }), {
      type: 'allocation',
      data: {
        allocations: [
          { operation: 'realloc', allocationId: 'heap:2', address: '0x2000', previousAddress: '0x1000', size: 16, success: true },
          { operation: 'calloc', allocationId: 'heap:3', address: '0x3000', size: 8, success: true },
          { operation: 'malloc', allocationId: null, address: '0x0', size: 32, success: false },
          { operation: 'free', allocationId: 'heap:2', address: '0x2000' },
        ],
      },
    }, 3)

    const facts = buildSemanticFacts(null, current, previous).facts

    expect(facts.filter((fact) => fact.kind === 'allocation')).toHaveLength(3)
    expect(facts.find((fact) => fact.kind === 'allocation' && fact.operation === 'malloc')).toMatchObject({ success: false })
    expect(facts).toContainEqual(expect.objectContaining({ kind: 'deallocation', operation: 'realloc', memoryObjectId: 'heap:1' }))
    expect(facts).toContainEqual(expect.objectContaining({ kind: 'deallocation', operation: 'free', memoryObjectId: 'heap:2' }))
  })

  it('keeps observable legacy changes, output and runtime errors without a structure tree', () => {
    const legacy = step(1, 2, state({
      variables: [{ id: 'main:i', name: 'i', type: 'int', value: 0, scope: 'main' }],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['main:i'] }],
    }), {
      type: 'declare',
      data: { variableId: 'main:i', stdoutDelta: 'hello' },
    })
    const legacyFacts = buildSemanticFacts(null, legacy).facts
    expect(legacyFacts.find((fact) => fact.kind === 'assignment')).toMatchObject({
      changeKind: 'declare',
      variableId: 'main:i',
    })
    expect(legacyFacts.find((fact) => fact.kind === 'output')).toMatchObject({
      channel: 'stdout',
      text: 'hello',
    })

    const outOfScope = step(2, 3, state(), {
      type: 'line_executed',
      data: {
        changes: [{ kind: 'out_of_scope', variableId: 'main:i', oldValue: 0 }],
      },
    }, 2)
    expect(buildSemanticFacts(null, outOfScope, legacy).facts.find(
      (fact) => fact.kind === 'assignment',
    )).toMatchObject({ changeKind: 'out_of_scope', variableId: 'main:i', oldValue: 0 })

    const crashed = step(3, 3, state(), {
      type: 'runtime_signal',
      data: { signal: 'SIGSEGV' },
    })
    expect(buildSemanticFacts(null, crashed).facts.find((fact) => fact.kind === 'runtime_error')).toMatchObject({
      signal: 'SIGSEGV',
    })
  })

  it('produces stable unique fact IDs for the same input', () => {
    const current = step(7, 2, state({
      variables: [{ id: 'main:value', name: 'value', type: 'int', value: 2, scope: 'main' }],
      callStack: [{ id: 'frame:main:1', function: 'main', variables: ['main:value'] }],
    }), {
      type: 'update',
      data: { variableId: 'main:value' },
    }, 1)

    const first = buildSemanticFacts(null, current).facts.map((fact) => fact.id)
    const second = buildSemanticFacts(null, current).facts.map((fact) => fact.id)

    expect(first).toEqual(second)
    expect(new Set(first).size).toBe(first.length)
  })
})
