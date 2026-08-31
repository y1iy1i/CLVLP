import type { SemanticFact } from '../types/executionCursor'
import type {
  MemoryMapModel,
  MemoryRegion,
  MemoryRegionLane,
} from '../types/memoryMap'
import type { ExecutionCursor } from '../types/executionCursor'
import type { VisualizationContext } from '../types/visualization'
import { parseArrayElementMemoryId } from './arrayAccess'

const addressValue = (address?: string) => {
  if (!address || !/^0x[0-9a-f]+$/i.test(address)) return undefined
  try {
    return BigInt(address)
  } catch {
    return undefined
  }
}

const endAddress = (start?: string, size?: number) => {
  const value = addressValue(start)
  return value !== undefined && size !== undefined
    ? `0x${(value + BigInt(size)).toString(16)}`
    : undefined
}

const parentMemoryId = (id: string) => parseArrayElementMemoryId(id)?.variableId ?? id

const factAccesses = (fact: SemanticFact) => {
  if (fact.kind === 'variable_access') return [{ id: fact.variableId, access: fact.access }]
  if (fact.kind === 'array_access') return [{ id: fact.variableId, access: fact.access }]
  if (fact.kind === 'assignment') return [{ id: fact.variableId, access: 'write' as const }]
  if (fact.kind === 'pointer_access') {
    const access = fact.access === 'write' ? 'write' as const : 'read' as const
    return [
      { id: fact.variableId, access },
      ...(fact.targetObjectId ? [{ id: fact.targetObjectId, access: 'read' as const }] : []),
    ]
  }
  if (fact.kind === 'allocation' && fact.memoryObjectId) {
    return [{ id: fact.memoryObjectId, access: 'write' as const }]
  }
  return []
}

const accessCounts = (history: readonly ExecutionCursor[], currentIndex: number) => {
  const reads = new Map<string, number>()
  const writes = new Map<string, number>()
  history.slice(0, Math.max(0, currentIndex) + 1).forEach((cursor) => {
    cursor.facts.flatMap(factAccesses).forEach(({ id, access }) => {
      const target = access === 'read' ? reads : writes
      const key = parentMemoryId(id)
      target.set(key, (target.get(key) ?? 0) + 1)
    })
  })
  return { reads, writes }
}

const currentAccesses = (cursor: ExecutionCursor | null) => {
  const result = new Map<string, 'read' | 'write'>()
  cursor?.facts.flatMap(factAccesses).forEach(({ id, access }) => {
    const key = parentMemoryId(id)
    if (access === 'write' || !result.has(key)) result.set(key, access)
  })
  return result
}

const heapBytes = (cursor: ExecutionCursor) => {
  const seen = new Set<string>()
  return cursor.memory.objects.reduce((total, object) => {
    if (object.region !== 'heap' || object.lifetime?.status === 'freed' || seen.has(object.id)) return total
    seen.add(object.id)
    return total + (object.size ?? 0)
  }, 0)
}

const emptyLane = (region: MemoryRegion): MemoryRegionLane => ({
  region,
  ranges: [],
  capturedBytes: 0,
  liveBytes: 0,
  freedBytes: 0,
  discontinuities: [],
})

const sortAndMeasure = (lane: MemoryRegionLane) => {
  lane.ranges.sort((left, right) => {
    const leftAddress = addressValue(left.startAddress)
    const rightAddress = addressValue(right.startAddress)
    if (leftAddress === undefined) return rightAddress === undefined ? left.label.localeCompare(right.label) : 1
    if (rightAddress === undefined) return -1
    return leftAddress < rightAddress ? -1 : leftAddress > rightAddress ? 1 : 0
  })
  lane.ranges.forEach((range) => {
    if (range.size === undefined) return
    lane.capturedBytes += range.size
    if (range.status === 'freed') lane.freedBytes += range.size
    else lane.liveBytes += range.size
  })
  for (let index = 0; index < lane.ranges.length - 1; index += 1) {
    const current = lane.ranges[index]
    const next = lane.ranges[index + 1]
    const currentEnd = addressValue(current.endAddress)
    const nextStart = addressValue(next.startAddress)
    if (currentEnd === undefined || nextStart === undefined || nextStart <= currentEnd) continue
    const gap = nextStart - currentEnd
    lane.discontinuities.push({
      afterRangeId: current.id,
      gapBytes: gap <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(gap) : undefined,
    })
  }
}

export function buildMemoryMapModel(context: VisualizationContext): MemoryMapModel {
  const cursor = context.execution.current
  const lanes = {
    stack: emptyLane('stack'),
    global: emptyLane('global'),
    heap: emptyLane('heap'),
  }
  if (!cursor) {
    return {
      lanes,
      summary: {
        capturedStackBytes: 0,
        globalBytes: 0,
        liveHeapBytes: 0,
        freedHeapBytes: 0,
        peakHeapBytes: 0,
        unknownSizeCount: 0,
      },
      registerVariables: [],
    }
  }

  const counts = accessCounts(context.execution.history, context.execution.currentIndex)
  const active = currentAccesses(cursor)
  const variables = new Map(cursor.variables.map((variable) => [variable.id, variable]))
  const seen = new Set<string>()
  const newlyAllocated = new Set(cursor.facts.flatMap((fact) =>
    fact.kind === 'allocation' && fact.memoryObjectId && fact.success ? [fact.memoryObjectId] : [],
  ))
  const selectedMemoryId = context.selection.memoryObjectId
    ? parentMemoryId(context.selection.memoryObjectId)
    : undefined

  cursor.memory.objects.forEach((object) => {
    if (seen.has(object.id)) return
    const variable = variables.get(object.id)
    const region = object.region ?? (variable?.storage?.region === 'global' ? 'global' : 'heap')
    if (region !== 'stack' && region !== 'global' && region !== 'heap') return
    seen.add(object.id)
    const start = object.address ?? variable?.storage?.address
    const size = object.size ?? variable?.storage?.size
    lanes[region].ranges.push({
      id: object.id,
      label: variable?.name ?? object.id,
      region,
      frameId: variable?.frameId,
      variableId: variable?.id,
      memoryObjectId: object.id,
      startAddress: start,
      endAddress: endAddress(start, size),
      size,
      type: object.type ?? variable?.type,
      value: variable ? variable.value : object.value,
      bytes: object.bytes ?? variable?.storage?.bytes,
      fields: object.fields ?? variable?.fields ?? [],
      pointer: variable?.pointer,
      status: object.lifetime?.status ?? 'alive',
      readCount: counts.reads.get(object.id) ?? 0,
      writeCount: counts.writes.get(object.id) ?? 0,
      activeAccess: active.get(object.id),
      newlyAllocated: newlyAllocated.has(object.id),
      selected: selectedMemoryId === object.id,
    })
  })

  const registerVariables = cursor.variables.filter((variable) => variable.storage?.region === 'register')
  cursor.variables.forEach((variable) => {
    const region = variable.storage?.region
    if (seen.has(variable.id) || (region !== 'stack' && region !== 'global')) return
    seen.add(variable.id)
    const start = variable.storage?.address
    const size = variable.storage?.size
    lanes[region].ranges.push({
      id: variable.id,
      label: variable.name,
      region,
      frameId: variable.frameId,
      variableId: variable.id,
      memoryObjectId: variable.id,
      startAddress: start,
      endAddress: endAddress(start, size),
      size,
      type: variable.type,
      value: variable.value,
      bytes: variable.storage?.bytes,
      fields: variable.fields ?? [],
      pointer: variable.pointer,
      status: 'alive',
      readCount: counts.reads.get(variable.id) ?? 0,
      writeCount: counts.writes.get(variable.id) ?? 0,
      activeAccess: active.get(variable.id),
      newlyAllocated: false,
      selected: selectedMemoryId === variable.id,
    })
  })

  Object.values(lanes).forEach(sortAndMeasure)
  const peakHeapBytes = Math.max(0, ...context.execution.history
    .slice(0, Math.max(0, context.execution.currentIndex) + 1)
    .map(heapBytes))
  const allRanges = Object.values(lanes).flatMap((lane) => lane.ranges)
  return {
    lanes,
    summary: {
      capturedStackBytes: lanes.stack.liveBytes,
      globalBytes: lanes.global.liveBytes,
      liveHeapBytes: lanes.heap.liveBytes,
      freedHeapBytes: lanes.heap.freedBytes,
      peakHeapBytes,
      unknownSizeCount: allRanges.filter((range) => range.size === undefined).length,
    },
    registerVariables,
  }
}
