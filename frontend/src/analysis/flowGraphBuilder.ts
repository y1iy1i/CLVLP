import type { AnyCodeStructureNode, CodeStructure } from '../types/codeStructure'
import type { FlowEdgeType, FlowGraph, FlowNodeKind } from '../types/flowGraph'

const MAX_FLOW_NODES = 250

const childrenOf = (
  node: AnyCodeStructureNode,
  nodesById: Map<string, AnyCodeStructureNode>,
) => node.children.map((id) => nodesById.get(id)).filter(Boolean) as AnyCodeStructureNode[]

const flowKindFor = (node: AnyCodeStructureNode): FlowNodeKind | null => {
  switch (node.kind) {
    case 'condition': return 'decision'
    case 'loop': return 'loop'
    case 'call': return 'call'
    case 'return': return 'return'
    case 'jump':
    case 'label': return 'jump'
    case 'assignment': return 'process'
    case 'variable': return node.details.initialValue ? 'process' : null
    default: return null
  }
}

interface BuildContext {
  graph: FlowGraph
  nodesById: Map<string, AnyCodeStructureNode>
  edgeSequence: number
  endId: string
  gotoEdges: Array<{ from: string; label: string }>
  labels: Map<string, string>
}

const pushEdge = (
  context: BuildContext,
  from: string,
  to: string,
  type: FlowEdgeType,
  label?: string,
) => {
  if (from === to && type === 'next') return
  context.graph.edges.push({
    id: `${context.graph.id}:edge:${context.edgeSequence++}`,
    type,
    from,
    to,
    label,
  })
}

const pushSourceNode = (context: BuildContext, source: AnyCodeStructureNode) => {
  const id = `${context.graph.id}:node:${source.id}`
  if (!context.graph.nodes.some((node) => node.id === id)) {
    context.graph.nodes.push({
      id,
      stableKey: `${context.graph.id}/${source.stableKey}`,
      kind: flowKindFor(source) ?? 'process',
      label: source.kind === 'variable' ? `初始化 ${source.name ?? source.label}` : source.label,
      sourceNodeId: source.id,
      details: { sourceKind: source.kind },
    })
  }
  if (source.kind === 'label' && source.name) context.labels.set(source.name, id)
  return id
}

interface LoopTargets {
  continueTo?: string
  breakTo?: string
}

function buildSequence(
  context: BuildContext,
  sources: AnyCodeStructureNode[],
  nextId: string,
  targets: LoopTargets,
): string {
  let entry = nextId
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    entry = buildSource(context, sources[index], entry, targets)
  }
  return entry
}

function buildSource(
  context: BuildContext,
  source: AnyCodeStructureNode,
  nextId: string,
  targets: LoopTargets,
): string {
  if (context.graph.nodes.length >= MAX_FLOW_NODES) {
    context.graph.truncated = true
    return nextId
  }
  const children = childrenOf(source, context.nodesById)
  if (source.kind === 'block' || source.kind === 'branch') {
    return buildSequence(context, children, nextId, targets)
  }

  if (source.kind === 'condition') {
    const decisionId = pushSourceNode(context, source)
    const branches = children.filter((child) => child.kind === 'branch')
    const thenBranch = branches.find((branch) => branch.details.branchType === 'then')
    const elseBranch = branches.find((branch) => branch.details.branchType === 'else')
    const caseBranches = branches.filter((branch) =>
      branch.details.branchType === 'case' || branch.details.branchType === 'default',
    )
    if (caseBranches.length) {
      caseBranches.forEach((branch) => {
        const branchEntry = buildSequence(
          context,
          childrenOf(branch, context.nodesById),
          nextId,
          targets,
        )
        pushEdge(
          context,
          decisionId,
          branchEntry,
          branch.details.branchType === 'default' ? 'false' : 'true',
          branch.details.branchType === 'default' ? 'default' : `case ${branch.details.caseValue ?? ''}`,
        )
      })
    } else {
      const thenEntry = thenBranch
        ? buildSequence(context, childrenOf(thenBranch, context.nodesById), nextId, targets)
        : nextId
      const elseEntry = elseBranch
        ? buildSequence(context, childrenOf(elseBranch, context.nodesById), nextId, targets)
        : nextId
      pushEdge(context, decisionId, thenEntry, 'true', '是')
      pushEdge(context, decisionId, elseEntry, 'false', '否')
    }
    return decisionId
  }

  if (source.kind === 'loop') {
    const loopId = pushSourceNode(context, source)
    const initializerIds = new Set(source.details.initializerNodeIds ?? [])
    const bodyIds = new Set([
      ...(source.details.bodyNodeIds ?? []),
      ...(source.details.updateNodeIds ?? []),
    ])
    const initializerChildren = children.filter((child) => initializerIds.has(child.id))
    const bodyChildren = bodyIds.size
      ? children.filter((child) => bodyIds.has(child.id))
      : children.filter((child) => !initializerIds.has(child.id) && child.kind !== 'parameter')
    const bodyEntry = buildSequence(
      context,
      bodyChildren,
      loopId,
      { continueTo: loopId, breakTo: nextId },
    )
    pushEdge(context, loopId, bodyEntry, 'true', '继续循环')
    pushEdge(context, loopId, nextId, 'false', '退出循环')
    const loopEntry = source.details.loopType === 'do_while' ? bodyEntry : loopId
    return buildSequence(context, initializerChildren, loopEntry, targets)
  }

  const kind = flowKindFor(source)
  if (!kind) return buildSequence(context, children, nextId, targets)
  const id = pushSourceNode(context, source)

  if (source.kind === 'return') {
    pushEdge(context, id, context.endId, 'return', '返回')
    return id
  }
  if (source.kind === 'jump') {
    if (source.details.jumpType === 'break') {
      pushEdge(context, id, targets.breakTo ?? nextId, 'break', 'break')
    } else if (source.details.jumpType === 'continue') {
      pushEdge(context, id, targets.continueTo ?? nextId, 'continue', 'continue')
    } else if (source.details.targetLabel) {
      context.gotoEdges.push({ from: id, label: source.details.targetLabel })
    }
    return id
  }
  if (source.kind === 'label') {
    const childEntry = buildSequence(context, children, nextId, targets)
    pushEdge(context, id, childEntry, 'next')
    return id
  }

  const childEntry = children.length
    ? buildSequence(context, children, nextId, targets)
    : nextId
  pushEdge(
    context,
    id,
    childEntry,
    targets.continueTo && childEntry === targets.continueTo ? 'loop_back' : 'next',
  )
  return id
}

export function buildFunctionFlowGraph(
  structure: CodeStructure,
  functionId: string,
): FlowGraph | null {
  const nodesById = new Map(structure.nodes.map((node) => [node.id, node]))
  const functionNode = nodesById.get(functionId)
  if (!functionNode || functionNode.kind !== 'function') return null
  const graphId = `function-flow:${functionNode.stableKey}`
  const startId = `${graphId}:start`
  const endId = `${graphId}:end`
  const graph: FlowGraph = {
    id: graphId,
    kind: 'function_flow',
    title: `${functionNode.name ?? '函数'} 流程`,
    functionId,
    nodes: [
      { id: startId, stableKey: `${graphId}/start`, kind: 'start', label: '开始', sourceNodeId: functionId },
      { id: endId, stableKey: `${graphId}/end`, kind: 'end', label: '结束', sourceNodeId: null },
    ],
    edges: [],
    diagnostics: [],
    truncated: false,
  }
  const context: BuildContext = {
    graph,
    nodesById,
    edgeSequence: 0,
    endId,
    gotoEdges: [],
    labels: new Map(),
  }
  const body = childrenOf(functionNode, nodesById).filter((node) => node.kind !== 'parameter')
  const entry = buildSequence(context, body, endId, {})
  pushEdge(context, startId, entry, 'next')
  for (const pending of context.gotoEdges) {
    const target = context.labels.get(pending.label)
    if (target) pushEdge(context, pending.from, target, 'goto', `goto ${pending.label}`)
  }
  if (graph.truncated) {
    graph.diagnostics.push({
      severity: 'warning',
      code: 'FLOW_TRUNCATED',
      message: `函数流程节点超过 ${MAX_FLOW_NODES} 个，图形已截断，完整 CodeStructure 仍然保留。`,
      range: functionNode.range,
    })
  }
  return graph
}

export function buildCallGraph(structure: CodeStructure): FlowGraph {
  const functionsByName = new Map<string, AnyCodeStructureNode>()
  for (const node of structure.nodes.filter((item) => item.kind === 'function')) {
    const key = node.name ?? node.id
    const existing = functionsByName.get(key)
    if (!existing || (node.details.isDefinition && existing.kind === 'function' && !existing.details.isDefinition)) {
      functionsByName.set(key, node)
    }
  }
  const functions = [...functionsByName.values()]
  const nodesById = new Map(structure.nodes.map((node) => [node.id, node]))
  const graph: FlowGraph = {
    id: `call-graph:${structure.source.entryFile}`,
    kind: 'call_graph',
    title: '函数总关系图',
    nodes: functions.map((node) => ({
      id: `call-graph:function:${node.id}`,
      stableKey: `call-graph/${node.stableKey}`,
      kind: 'function',
      label: `${node.name ?? 'anonymous'}()`,
      sourceNodeId: node.id,
    })),
    edges: [],
    diagnostics: [],
    truncated: false,
  }
  const flowIdBySource = new Map(graph.nodes.map((node) => [node.sourceNodeId!, node.id]))
  const externalByName = new Map<string, string>()
  const callers = new Map<string, string>()
  for (const call of structure.nodes.filter((node) => node.kind === 'call')) {
    let ancestor = call.parentId ? nodesById.get(call.parentId) : undefined
    while (ancestor && ancestor.kind !== 'function') {
      ancestor = ancestor.parentId ? nodesById.get(ancestor.parentId) : undefined
    }
    if (ancestor) callers.set(call.id, ancestor.id)
  }
  let edgeIndex = 0
  for (const relation of structure.relations.filter((item) => item.type === 'calls')) {
    const callerSourceId = callers.get(relation.from)
    const from = callerSourceId ? flowIdBySource.get(callerSourceId) : undefined
    if (!from) continue
    let to = relation.resolved && relation.to ? flowIdBySource.get(relation.to) : undefined
    if (!to) {
      const name = relation.targetName ?? '间接调用'
      to = externalByName.get(name)
      if (!to) {
        to = `call-graph:external:${name}`
        externalByName.set(name, to)
        graph.nodes.push({
          id: to,
          stableKey: `call-graph/external:${name}`,
          kind: 'external',
          label: `${name}（外部）`,
          sourceNodeId: relation.from,
        })
      }
    }
    graph.edges.push({
      id: `call-graph:edge:${edgeIndex++}`,
      type: 'calls',
      from,
      to,
      label: from === to ? '递归' : undefined,
    })
  }
  return graph
}

export function buildAllFlowGraphs(structure: CodeStructure) {
  return {
    callGraph: buildCallGraph(structure),
    functionGraphs: new Map(
      structure.nodes
        .filter((node) => node.kind === 'function')
        .map((node) => [node.id, buildFunctionFlowGraph(structure, node.id)!]),
    ),
  }
}

export function isLineInsideNode(node: AnyCodeStructureNode, file: string, line: number) {
  if (node.range.file !== file) return false
  return line >= node.range.start.line && line <= node.range.end.line
}

export function matchTraceLocation(
  structure: CodeStructure | null,
  file: string,
  line: number,
) {
  if (!structure) return { currentNodeId: null, ancestorIds: [], functionId: null }
  const nodesById = new Map(structure.nodes.map((node) => [node.id, node]))
  const candidates = structure.nodes
    .filter((node) => isLineInsideNode(node, file, line) && (node.kind === 'function' || flowKindFor(node)))
    .sort((a, b) => {
      const aSpan = a.range.end.line - a.range.start.line
      const bSpan = b.range.end.line - b.range.start.line
      return aSpan - bSpan || b.range.start.column - a.range.start.column
    })
  const current = candidates[0]
  if (!current) return { currentNodeId: null, ancestorIds: [], functionId: null }
  const ancestorIds: string[] = []
  let functionId: string | null = current.kind === 'function' ? current.id : null
  let parent = current.parentId ? nodesById.get(current.parentId) : undefined
  while (parent) {
    if (parent.kind === 'condition' || parent.kind === 'loop' || parent.kind === 'function') {
      ancestorIds.push(parent.id)
    }
    if (parent.kind === 'function') functionId = parent.id
    parent = parent.parentId ? nodesById.get(parent.parentId) : undefined
  }
  return { currentNodeId: current.id, ancestorIds, functionId }
}
