import { beforeAll, describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { Language, Parser } from 'web-tree-sitter'
import { mapCCodeStructure } from './codeStructureMapper'
import {
  buildCallGraph,
  buildFunctionFlowGraph,
  buildVisibleFlowGraph,
  matchTraceLocation,
} from './flowGraphBuilder'

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

describe('C CodeStructure mapper', () => {
  it('maps bubble sort structure and execution flow', () => {
    const structure = analyze(`
      #include <stdio.h>
      int main(void) {
        int arr[5] = {5, 1, 4, 2, 8};
        int n = 5;
        for (int i = 0; i < n - 1; i++) {
          for (int j = 0; j < n - i - 1; j++) {
            if (arr[j] > arr[j + 1]) {
              int temp = arr[j];
              arr[j] = arr[j + 1];
              arr[j + 1] = temp;
            }
          }
        }
        printf("%d", arr[0]);
        return 0;
      }
    `)
    expect(structure.status).toBe('completed')
    expect(structure.nodes.some((node) => node.kind === 'function' && node.name === 'main')).toBe(true)
    expect(structure.nodes.filter((node) => node.kind === 'loop')).toHaveLength(2)
    expect(structure.nodes.some((node) => node.kind === 'condition')).toBe(true)
    expect(structure.nodes.some((node) => node.kind === 'preprocessor')).toBe(true)
    expect(structure.relations.some((relation) => relation.type === 'includes')).toBe(true)
    expect(structure.relations.some((relation) => relation.type === 'writes')).toBe(true)
    expect(structure.relations.some((relation) => relation.type === 'reads')).toBe(true)

    const main = structure.nodes.find((node) => node.kind === 'function' && node.name === 'main')!
    const flow = buildFunctionFlowGraph(structure, main.id)!
    expect(flow.nodes.some((node) => node.kind === 'start')).toBe(true)
    expect(flow.nodes.some((node) => node.kind === 'loop')).toBe(true)
    expect(flow.edges.some((edge) => edge.type === 'loop_back' || edge.to.includes(':loop:'))).toBe(true)
    expect(flow.edges.some((edge) => edge.type === 'true')).toBe(true)
    expect(flow.edges.some((edge) => edge.type === 'false')).toBe(true)
  })

  it('resolves direct calls and keeps library calls external, including recursion', () => {
    const structure = analyze(`
      int fact(int n) { return n < 2 ? 1 : n * fact(n - 1); }
      int main(void) { puts("go"); return fact(4); }
    `)
    const calls = structure.relations.filter((relation) => relation.type === 'calls')
    expect(calls.some((relation) => relation.targetName === 'fact' && relation.resolved)).toBe(true)
    expect(calls.some((relation) => relation.targetName === 'puts' && !relation.resolved)).toBe(true)
    const graph = buildCallGraph(structure)
    expect(graph.nodes.some((node) => node.kind === 'external' && node.label.includes('puts'))).toBe(true)
    expect(graph.edges.some((edge) => edge.from === edge.to && edge.label === '递归')).toBe(true)
  })

  it('maps types, switch branches and all jump forms', () => {
    const structure = analyze(`
      typedef struct Point { int x; int y; } Point;
      int run(int n) {
        Point p = {0, 1};
      again:
        switch (n) { case 1: n++; break; default: n--; }
        while (n > 0) { n--; if (n == 2) continue; if (n == 1) goto again; }
        return p.x;
      }
    `)
    expect(structure.nodes.some((node) => node.kind === 'type')).toBe(true)
    expect(structure.nodes.filter((node) => node.kind === 'member').length).toBeGreaterThanOrEqual(2)
    expect(structure.nodes.some((node) => node.kind === 'label' && node.name === 'again')).toBe(true)
    const jumps = structure.nodes.filter((node) => node.kind === 'jump')
    expect(jumps.some((node) => node.details.jumpType === 'break')).toBe(true)
    expect(jumps.some((node) => node.details.jumpType === 'continue')).toBe(true)
    expect(jumps.some((node) => node.details.jumpType === 'goto')).toBe(true)
  })

  it('keeps stable keys when blank lines are inserted', () => {
    const first = analyze('int main(void) {\n  int value = 1;\n  return value;\n}')
    const second = analyze('\n\nint main(void) {\n  int value = 1;\n  return value;\n}')
    const interesting = (structure: typeof first) => structure.nodes
      .filter((node) => ['function', 'variable', 'return'].includes(node.kind))
      .map((node) => node.stableKey)
    expect(interesting(second)).toEqual(interesting(first))
  })

  it('returns partial useful structure for incomplete code', () => {
    const structure = analyze('int main(void) { int value = 1; if (value > 0) { value++')
    expect(structure.status).toBe('partial')
    expect(structure.nodes.some((node) => node.kind === 'function')).toBe(true)
    expect(structure.diagnostics.length).toBeGreaterThan(0)
  })

  it('matches the most specific trace node and its teaching ancestors', () => {
    const structure = analyze(`int main(void) {
      int n = 2;
      while (n > 0) {
        n--;
      }
      return 0;
    }`)
    const match = matchTraceLocation(structure, 'main.c', 4)
    expect(match.currentNodeId).not.toBeNull()
    expect(match.functionId).not.toBeNull()
    expect(match.ancestorIds.length).toBeGreaterThan(0)
  })

  it('matches consecutive declarations without shifting to the previous line', () => {
    const structure = analyze(`int main(void) {
      int first = 1;
      int second = 2;
      return second;
    }`)
    const second = structure.nodes.find(
      (node) => node.kind === 'variable' && node.name === 'second',
    )!
    expect(matchTraceLocation(structure, 'main.c', 3).currentNodeId).toBe(second.id)
  })

  it('keeps the full flow while progressively revealing nested control flow', () => {
    const structure = analyze(`int main(void) {
      int values[3] = {3, 2, 1};
      for (int i = 0; i < 2; i++) {
        for (int j = 0; j < 2 - i; j++) {
          if (values[j] > values[j + 1]) values[j] = values[j + 1];
        }
      }
      return 0;
    }`)
    const main = structure.nodes.find((node) => node.kind === 'function')!
    const full = buildFunctionFlowGraph(structure, main.id)!
    const fullNodeCount = full.nodes.length
    const loops = full.nodes.filter((node) => node.kind === 'loop')
    const outer = loops.find((node) => !node.parentGroupId)!
    const inner = loops.find((node) => node.parentGroupId === outer.id)!
    const decision = full.nodes.find((node) => node.kind === 'decision')!

    const collapsed = buildVisibleFlowGraph(full, new Set())
    expect(collapsed.nodes.some((node) => node.id === outer.id)).toBe(true)
    expect(collapsed.nodes.some((node) => node.id === inner.id)).toBe(false)

    const outerExpanded = buildVisibleFlowGraph(full, new Set([outer.stableKey]))
    expect(outerExpanded.nodes.some((node) => node.id === inner.id)).toBe(true)
    expect(outerExpanded.nodes.some((node) => node.id === decision.id)).toBe(false)

    const nestedExpanded = buildVisibleFlowGraph(
      full,
      new Set([outer.stableKey, inner.stableKey]),
    )
    expect(nestedExpanded.nodes.some((node) => node.id === decision.id)).toBe(true)
    expect(full.nodes).toHaveLength(fullNodeCount)
    expect(full.nodes.length).toBeGreaterThan(collapsed.nodes.length)
  })

  it('keeps prototypes while resolving calls to definitions and leaves function pointers unresolved', () => {
    const structure = analyze(`
      int helper(int value);
      int helper(int value) { return value + 1; }
      int main(void) {
        int (*operation)(int) = helper;
        return helper(1) + operation(2);
      }
    `)
    const helperNodes = structure.nodes.filter((node) => node.kind === 'function' && node.name === 'helper')
    expect(helperNodes.some((node) => node.details.isDefinition)).toBe(true)
    expect(helperNodes.some((node) => !node.details.isDefinition)).toBe(true)
    const calls = structure.relations.filter((relation) => relation.type === 'calls')
    expect(calls.some((relation) => relation.targetName === 'helper' && relation.resolved)).toBe(true)
    expect(calls.some((relation) => relation.targetName === 'operation' && !relation.resolved)).toBe(true)
    expect(buildCallGraph(structure).nodes.filter((node) => node.label === 'helper()')).toHaveLength(1)
  })

  it('resolves shadowed variables in their lexical block', () => {
    const structure = analyze(`int main(void) {
      int value = 1;
      { int value = 2; value++; }
      return value;
    }`)
    const values = structure.nodes.filter((node) => node.kind === 'variable' && node.name === 'value')
    expect(values).toHaveLength(2)
    const update = structure.nodes.find((node) => node.kind === 'assignment' && node.label.includes('value++'))!
    const returned = structure.nodes.find((node) => node.kind === 'return')!
    const updateWrite = structure.relations.find((relation) => relation.type === 'writes' && relation.from === update.id)
    const returnRead = structure.relations.find((relation) => relation.type === 'reads' && relation.from === returned.id)
    expect(updateWrite?.to).toBe(values[1].id)
    expect(returnRead?.to).toBe(values[0].id)
  })

  it('builds for initialization, loop-back, do-while and switch case edges correctly', () => {
    const structure = analyze(`int main(void) {
      int total = 0;
      for (int i = 0; i < 3; i++) { total += i; }
      do { total--; } while (total > 1);
      switch (total) { case 0: total = 4; break; default: total = 5; }
      return total;
    }`)
    const main = structure.nodes.find((node) => node.kind === 'function' && node.name === 'main')!
    const flow = buildFunctionFlowGraph(structure, main.id)!
    const forLoop = flow.nodes.find((node) => node.kind === 'loop' && node.label.startsWith('for'))!
    const forInitializer = flow.nodes.find((node) => node.label === '初始化 i')!
    expect(flow.edges.some((edge) => edge.from === forInitializer.id && edge.to === forLoop.id)).toBe(true)
    expect(flow.edges.some((edge) => edge.from === forLoop.id && edge.to === forInitializer.id)).toBe(false)
    expect(flow.edges.some((edge) => edge.type === 'loop_back')).toBe(true)

    const doLoop = flow.nodes.find((node) => node.kind === 'loop' && node.label.startsWith('do…while'))!
    const start = flow.nodes.find((node) => node.kind === 'start')!
    expect(flow.edges.some((edge) => edge.from === doLoop.id && edge.type === 'true')).toBe(true)
    expect(flow.edges.some((edge) => edge.from === start.id)).toBe(true)

    const switchNode = flow.nodes.find((node) => node.kind === 'decision' && node.label.startsWith('switch'))!
    const switchEdges = flow.edges.filter((edge) => edge.from === switchNode.id)
    expect(switchEdges.some((edge) => edge.label?.startsWith('case'))).toBe(true)
    expect(switchEdges.some((edge) => edge.label === 'default')).toBe(true)
  })

  it('truncates oversized visual flows without discarding the structure', () => {
    const assignments = Array.from({ length: 280 }, (_, index) => `value = ${index};`).join('\n')
    const structure = analyze(`int main(void) { int value = 0; ${assignments} return value; }`)
    const main = structure.nodes.find((node) => node.kind === 'function')!
    const flow = buildFunctionFlowGraph(structure, main.id)!
    expect(flow.truncated).toBe(true)
    expect(flow.nodes.length).toBeLessThanOrEqual(250)
    expect(flow.diagnostics.some((diagnostic) => diagnostic.code === 'FLOW_TRUNCATED')).toBe(true)
    expect(structure.nodes.length).toBeGreaterThan(flow.nodes.length)
  })
})
