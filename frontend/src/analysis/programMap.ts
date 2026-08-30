import type { AnyCodeStructureNode, CodeStructure, CodeStructureNode } from '../types/codeStructure'
import type { AgentAlgorithmModule, AlgorithmModule, ProgramMap } from '../types/programMap'

export const sourceHash = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const descendants = (
  node: AnyCodeStructureNode,
  nodesById: Map<string, AnyCodeStructureNode>,
) => {
  const result: AnyCodeStructureNode[] = []
  const visit = (current: AnyCodeStructureNode) => {
    current.children.forEach((id) => {
      const child = nodesById.get(id)
      if (!child) return
      result.push(child)
      visit(child)
    })
  }
  visit(node)
  return result
}

const addModule = (modules: AlgorithmModule[], module: Omit<AlgorithmModule, 'children'>) => {
  modules.push({ ...module, children: [] })
  if (module.parentId) {
    modules.find((candidate) => candidate.id === module.parentId)?.children.push(module.id)
  }
}

const functionForCall = (
  callId: string,
  nodesById: Map<string, AnyCodeStructureNode>,
) => {
  let node = nodesById.get(callId)
  while (node && node.kind !== 'function') {
    node = node.parentId ? nodesById.get(node.parentId) : undefined
  }
  return node?.kind === 'function' ? node : undefined
}

const recursiveFunctions = (
  structure: CodeStructure,
  nodesById: Map<string, AnyCodeStructureNode>,
) => {
  const edges = new Map<string, Set<string>>()
  structure.relations.filter((relation) => relation.type === 'calls' && relation.resolved).forEach((relation) => {
    const caller = functionForCall(relation.from, nodesById)
    const target = relation.to ? nodesById.get(relation.to) : undefined
    if (!caller || target?.kind !== 'function') return
    const outgoing = edges.get(caller.id) ?? new Set<string>()
    outgoing.add(target.id)
    edges.set(caller.id, outgoing)
  })
  const recursive = new Set<string>()
  const reaches = (start: string, current: string, visited: Set<string>): boolean => {
    for (const target of edges.get(current) ?? []) {
      if (target === start) return true
      if (visited.has(target)) continue
      visited.add(target)
      if (reaches(start, target, visited)) return true
    }
    return false
  }
  edges.forEach((_, functionId) => {
    if (reaches(functionId, functionId, new Set([functionId]))) recursive.add(functionId)
  })
  return recursive
}

const arrayComparison = (node: AnyCodeStructureNode): node is CodeStructureNode<'condition'> =>
  node.kind === 'condition' && Boolean(node.details.expression?.match(/\w+\s*\[[^\]]+]\s*(?:[<>]=?|[!=]=)/))

const arrayWrite = (node: AnyCodeStructureNode) =>
  node.kind === 'assignment' && Boolean(node.details.target?.includes('['))

export function buildLocalProgramMap(structure: CodeStructure, code: string): ProgramMap {
  const nodesById = new Map(structure.nodes.map((node) => [node.id, node]))
  const modules: AlgorithmModule[] = []
  const rootId = `program:${structure.source.entryFile}`
  addModule(modules, {
    id: rootId,
    stableKey: rootId,
    kind: 'program',
    title: '程序流程图',
    sourceNodeIds: structure.nodes.map((node) => node.id),
    visualizationHints: ['call-graph'],
    bindings: {},
    origin: 'deterministic',
    confidence: 1,
    evidence: ['当前编辑文件'],
    status: 'detected',
  })

  const recursive = recursiveFunctions(structure, nodesById)
  const functions = structure.nodes.filter(
    (node) => node.kind === 'function' && node.details.isDefinition,
  )
  functions.forEach((functionNode) => {
    const functionDescendants = descendants(functionNode, nodesById)
    const functionId = `module:function:${functionNode.stableKey}`
    addModule(modules, {
      id: functionId,
      stableKey: functionId,
      parentId: rootId,
      kind: 'function',
      title: `${functionNode.name ?? '匿名函数'}：函数`,
      sourceNodeIds: [functionNode.id, ...functionDescendants.map((node) => node.id)],
      visualizationHints: ['function-flow'],
      bindings: {},
      origin: 'deterministic',
      confidence: 1,
      evidence: ['Tree-sitter 函数定义'],
      status: 'detected',
    })

    const loops = functionDescendants.filter((node) => node.kind === 'loop')
    const comparisons = functionDescendants.filter(arrayComparison)
    const writes = functionDescendants.filter(arrayWrite)
    const isRecursive = recursive.has(functionNode.id)
    const hasNestedLoop = loops.some((loop) =>
      descendants(loop, nodesById).some((node) => node.kind === 'loop'),
    )
    const bubbleLike = hasNestedLoop && comparisons.length > 0 && writes.length >= 2
    const quickLike = isRecursive && (
      /quick|partition|pivot/i.test(functionNode.name ?? '') ||
      functionDescendants.some((node) => /partition|pivot/i.test(node.label))
    )

    let algorithmId: string | undefined
    if (quickLike || bubbleLike || isRecursive || hasNestedLoop) {
      const family = quickLike
        ? 'quick_sort'
        : bubbleLike
          ? 'exchange_sort'
          : isRecursive
            ? 'recursion'
            : 'nested_loop'
      const title = quickLike
        ? '快速排序候选：递归分治'
        : bubbleLike
          ? '交换排序候选：重复比较与交换'
          : isRecursive
            ? '递归算法'
            : '嵌套循环'
      algorithmId = `module:algorithm:${functionNode.stableKey}:${family}`
      addModule(modules, {
        id: algorithmId,
        stableKey: algorithmId,
        parentId: functionId,
        kind: 'algorithm',
        family,
        title,
        sourceNodeIds: functionDescendants.map((node) => node.id),
        visualizationHints: isRecursive ? ['recursion-tree', 'function-flow'] : ['array', 'function-flow'],
        bindings: {},
        origin: 'deterministic',
        confidence: quickLike || bubbleLike ? 0.78 : 0.96,
        evidence: [
          ...(isRecursive ? ['调用关系存在递归环'] : []),
          ...(hasNestedLoop ? ['存在嵌套循环'] : []),
          ...(comparisons.length ? ['存在数组元素比较'] : []),
          ...(writes.length >= 2 ? ['同一区域存在多次数组写入'] : []),
        ],
        status: quickLike || bubbleLike ? 'suggested' : 'detected',
      })
    }

    const operationParent = algorithmId ?? functionId
    comparisons.slice(0, 4).forEach((condition, index) => {
      const id = `module:comparison:${condition.stableKey}`
      addModule(modules, {
        id,
        stableKey: id,
        parentId: operationParent,
        kind: 'operation',
        family: 'comparison',
        title: `数组比较${comparisons.length > 1 ? ` ${index + 1}` : ''}`,
        sourceNodeIds: [condition.id],
        visualizationHints: ['comparison-card', 'array'],
        bindings: {},
        origin: 'deterministic',
        confidence: 0.98,
        evidence: [condition.details.expression ?? condition.label],
        status: 'detected',
      })
    })

    if (writes.length >= 2) {
      const id = `module:swap:${functionNode.stableKey}`
      addModule(modules, {
        id,
        stableKey: id,
        parentId: operationParent,
        kind: 'operation',
        family: 'swap',
        title: '数组元素交换候选',
        sourceNodeIds: writes.map((node) => node.id),
        visualizationHints: ['array'],
        bindings: {},
        origin: 'deterministic',
        confidence: 0.72,
        evidence: [`检测到 ${writes.length} 次数组元素写入，运行后由 Trace 验证是否互换`],
        status: 'suggested',
      })
    }
  })

  return {
    sourceHash: sourceHash(code),
    modules,
    agentConfigured: false,
    agentStatus: 'idle',
  }
}

export function mergeAgentModules(
  local: ProgramMap,
  suggestions: AgentAlgorithmModule[],
  structure: CodeStructure,
): ProgramMap {
  const validNodeIds = new Set(structure.nodes.map((node) => node.id))
  const modules = local.modules.map((module) => ({ ...module, children: [...module.children] }))
  const localCoverage = modules.filter((module) => module.kind !== 'program')
  suggestions.forEach((suggestion, index) => {
    const sourceNodeIds = suggestion.sourceNodeIds.filter((id) => validNodeIds.has(id))
    if (sourceNodeIds.length === 0) return
    const parent = [...localCoverage].reverse().find((module) =>
      sourceNodeIds.some((id) => module.sourceNodeIds.includes(id)),
    ) ?? modules[0]
    const id = `module:agent:${local.sourceHash}:${index}`
    addModule(modules, {
      id,
      stableKey: id,
      parentId: parent.id,
      kind: suggestion.kind,
      family: suggestion.family,
      title: suggestion.title,
      sourceNodeIds,
      visualizationHints: suggestion.visualizationHints,
      bindings: {},
      origin: 'agent',
      confidence: Math.max(0, Math.min(1, suggestion.confidence)),
      evidence: suggestion.evidence,
      status: 'suggested',
    })
  })
  return { ...local, modules, agentConfigured: true, agentStatus: 'completed' }
}

export function algorithmEvidence(structure: CodeStructure, local: ProgramMap) {
  return {
    functions: structure.nodes.filter((node) => node.kind === 'function').map((node) => ({
      id: node.id,
      name: node.name,
      label: node.label,
    })),
    loops: structure.nodes.filter((node) => node.kind === 'loop').map((node) => ({
      id: node.id,
      parentId: node.parentId,
      label: node.label,
    })),
    conditions: structure.nodes.filter((node) => node.kind === 'condition').map((node) => ({
      id: node.id,
      parentId: node.parentId,
      expression: node.details.expression,
    })),
    calls: structure.relations.filter((relation) => relation.type === 'calls').map((relation) => ({
      from: relation.from,
      to: relation.to,
      targetName: relation.targetName,
      resolved: relation.resolved,
    })),
    writes: structure.relations.filter((relation) => relation.type === 'writes').map((relation) => ({
      from: relation.from,
      to: relation.to,
    })),
    localCandidates: local.modules.filter((module) => module.kind === 'algorithm' || module.kind === 'operation'),
  }
}
