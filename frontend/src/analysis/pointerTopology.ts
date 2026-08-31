import type {
  DetectedStructure,
  PointerTopology,
  PointerTopologyEdge,
  PointerTopologyNode,
  StructureShape,
} from '../types/dataStructure'
import type { ExecutionCursor } from '../types/executionCursor'
import type { MemoryField, PointerReference, TraceVariable } from '../types/trace'

const DEFAULT_MAX_NODES = 200
const DEFAULT_MAX_DEPTH = 32

const pointerRole = (pointer: PointerReference) => {
  const expression = pointer.sourceExpression ?? pointer.id
  const match = expression.match(/(?:->|\.)([A-Za-z_]\w*)\s*$/)
  if (match) return match[1]
  const path = pointer.id.split(':').at(-1)
  return path && !/^\d+$/.test(path) ? path : 'target'
}

const collectFieldPointers = (fields: readonly MemoryField[], target: PointerReference[]) => {
  fields.forEach((field) => {
    if (field.pointer) target.push(field.pointer)
    collectFieldPointers(field.fields, target)
  })
}

const allPointers = (cursor: ExecutionCursor) => {
  const pointers = [...cursor.memory.pointers]
  cursor.variables.forEach((variable) => collectFieldPointers(variable.fields ?? [], pointers))
  cursor.memory.objects.forEach((object) => collectFieldPointers(object.fields ?? [], pointers))
  const unique = new Map(pointers.map((pointer) => [pointer.id, pointer]))
  return [...unique.values()]
}

const nodeForId = (
  cursor: ExecutionCursor,
  memoryObjectId: string,
  rootVariableId: string,
): PointerTopologyNode => {
  const variable = cursor.variables.find((item) => item.id === memoryObjectId)
  const object = cursor.memory.objects.find((item) => item.id === memoryObjectId)
  return {
    id: `topology:${memoryObjectId}`,
    memoryObjectId,
    variableId: variable?.id,
    label: variable?.name ?? memoryObjectId,
    type: variable?.type ?? object?.type,
    value: variable ? variable.value : object?.value,
    address: variable?.storage?.address ?? object?.address,
    size: variable?.storage?.size ?? object?.size,
    status: object?.lifetime?.status ?? 'alive',
    root: memoryObjectId === rootVariableId,
  }
}

const sourceIdForPointer = (pointer: PointerReference) => pointer.sourceVariableId

export function buildPointerTopology(
  cursor: ExecutionCursor,
  rootVariableId: string,
  options: { maxNodes?: number; maxDepth?: number } = {},
): PointerTopology {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const pointers = allPointers(cursor)
  const bySource = new Map<string, PointerReference[]>()
  pointers.forEach((pointer) => {
    const source = sourceIdForPointer(pointer)
    bySource.set(source, [...(bySource.get(source) ?? []), pointer])
  })

  const nodes = new Map<string, PointerTopologyNode>()
  const edges = new Map<string, PointerTopologyEdge>()
  const queue: Array<{ id: string; depth: number }> = [{ id: rootVariableId, depth: 0 }]
  const visited = new Set<string>()
  let truncated = false
  let maxDepthReached = false

  while (queue.length > 0) {
    const current = queue.shift()!
    if (visited.has(current.id)) continue
    if (current.depth > maxDepth) {
      maxDepthReached = true
      continue
    }
    if (nodes.size >= maxNodes) {
      truncated = true
      break
    }
    visited.add(current.id)
    nodes.set(current.id, nodeForId(cursor, current.id, rootVariableId))
    for (const pointer of bySource.get(current.id) ?? []) {
      const targetId = pointer.targetObjectId
      edges.set(pointer.id, {
        id: pointer.id,
        sourceId: current.id,
        targetId,
        sourceExpression: pointer.sourceExpression ?? pointer.id,
        role: pointerRole(pointer),
        status: pointer.status,
        addressValue: pointer.addressValue,
        offset: pointer.offset,
      })
      if (targetId && !visited.has(targetId)) queue.push({ id: targetId, depth: current.depth + 1 })
    }
  }

  // A root pointer commonly points to the first heap node. Keeping both nodes makes
  // &p, p and *p visible without pretending that the pointer variable is the heap node.
  return {
    rootVariableId,
    rootNodeId: nodes.has(rootVariableId) ? rootVariableId : undefined,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    truncated,
    maxDepthReached,
  }
}

const nestedArrayDepth = (value: unknown): number =>
  Array.isArray(value) && value.length > 0
    ? 1 + Math.max(...value.map(nestedArrayDepth))
    : 0

const pointerShape = (topology: PointerTopology): { shape: StructureShape; confidence: DetectedStructure['confidence']; evidence: string[] } => {
  const resolved = topology.edges.filter((edge) => edge.status === 'resolved' && edge.targetId)
  if (resolved.length === 0) {
    return { shape: 'generic_pointer_graph', confidence: 'generic', evidence: ['没有足够的已解析指针关系'] }
  }
  const ids = new Set(topology.nodes.map((node) => node.memoryObjectId))
  const outgoing = new Map<string, number>()
  const incoming = new Map<string, number>()
  resolved.forEach((edge) => {
    outgoing.set(edge.sourceId, (outgoing.get(edge.sourceId) ?? 0) + 1)
    if (edge.targetId) incoming.set(edge.targetId, (incoming.get(edge.targetId) ?? 0) + 1)
  })
  const maxOut = Math.max(0, ...outgoing.values())
  const maxIn = Math.max(0, ...incoming.values())
  const hasCycle = (() => {
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const edgesBySource = new Map<string, string[]>()
    resolved.forEach((edge) => {
      if (edge.targetId && ids.has(edge.targetId)) {
        edgesBySource.set(edge.sourceId, [...(edgesBySource.get(edge.sourceId) ?? []), edge.targetId])
      }
    })
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return true
      if (visited.has(id)) return false
      visiting.add(id)
      if ((edgesBySource.get(id) ?? []).some(visit)) return true
      visiting.delete(id)
      visited.add(id)
      return false
    }
    return [...ids].some(visit)
  })()
  const roles = new Set(resolved.map((edge) => edge.role.toLowerCase()))

  if (maxOut <= 1) {
    return hasCycle
      ? { shape: 'circular_sequence', confidence: 'certain', evidence: ['每个节点最多一个后继', '指针最终回到已访问节点'] }
      : { shape: 'linked_sequence', confidence: 'certain', evidence: ['每个节点最多一个后继', '未发现环'] }
  }
  if (!hasCycle && maxIn <= 1) {
    return {
      shape: 'tree',
      confidence: roles.has('left') || roles.has('right') ? 'certain' : 'probable',
      evidence: [roles.has('left') || roles.has('right') ? '发现 left/right 子节点' : '每个节点最多一个父节点', '未发现环'],
    }
  }
  return {
    shape: 'generic_pointer_graph',
    confidence: 'generic',
    evidence: [hasCycle ? '存在复杂环或回边' : '存在共享子节点', maxIn > 1 ? '至少一个对象被多个指针引用' : '节点存在多条连接', '现有证据不足以确认是邻接表'],
  }
}

export function detectStructure(cursor: ExecutionCursor, rootVariableId: string): DetectedStructure {
  const variable = cursor.variables.find((item) => item.id === rootVariableId)
  const topology = buildPointerTopology(cursor, rootVariableId)
  let result: ReturnType<typeof pointerShape>
  const depth = nestedArrayDepth(variable?.value)
  const pointerEdges = topology.edges.filter((edge) => edge.status === 'resolved')

  if (depth >= 2) {
    const matrixValue = Array.isArray(variable?.value) ? variable.value : []
    const looksLikeAdjacencyMatrix = /graph|adj|matrix/i.test(`${variable?.name ?? ''} ${variable?.type ?? ''}`)
      && matrixValue.every((row) => Array.isArray(row) && row.length === matrixValue.length)
    result = looksLikeAdjacencyMatrix
      ? { shape: 'adjacency_matrix', confidence: 'probable', evidence: ['变量是方阵', '名称表明它用于保存图的邻接关系'] }
      : { shape: 'matrix', confidence: 'certain', evidence: [`运行时值具有 ${depth} 层连续数组`] }
  } else if (depth === 1) {
    result = pointerEdges.length > 1
      ? { shape: 'adjacency_list', confidence: 'probable', evidence: ['根变量是连续指针数组', '每个入口关联一条边链'] }
      : { shape: 'contiguous_sequence', confidence: 'certain', evidence: ['类型和值表明它是连续序列'] }
  } else if ((variable?.fields?.length ?? 0) > 0 && pointerEdges.length === 0) {
    result = { shape: 'record', confidence: 'certain', evidence: ['GDB 已采集结构体或 union 字段'] }
  } else {
    result = pointerShape(topology)
  }

  return {
    id: `structure:${rootVariableId}`,
    rootVariableId,
    ...result,
    memoryObjectIds: topology.nodes.map((node) => node.memoryObjectId),
    topology,
  }
}

export function detectStructures(cursor: ExecutionCursor): DetectedStructure[] {
  return cursor.variables
    .filter((variable: TraceVariable) =>
      Array.isArray(variable.value)
      || (variable.fields?.length ?? 0) > 0
      || Boolean(variable.pointer),
    )
    .map((variable) => detectStructure(cursor, variable.id))
}
