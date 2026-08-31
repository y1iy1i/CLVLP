import type { MemoryField, TraceVariable } from '../types/trace'

export const arrayElementMemoryId = (variableId: string, indices: readonly number[]) =>
  `${variableId}:element:${indices.join('.')}`

export const parseArrayElementMemoryId = (memoryObjectId?: string) => {
  if (!memoryObjectId) return undefined
  const marker = ':element:'
  const markerIndex = memoryObjectId.lastIndexOf(marker)
  if (markerIndex < 0) return undefined
  const indices = memoryObjectId.slice(markerIndex + marker.length).split('.').map(Number)
  if (indices.length === 0 || indices.some((index) => !Number.isInteger(index) || index < 0)) return undefined
  return { variableId: memoryObjectId.slice(0, markerIndex), indices }
}

const indexedValue = (value: unknown, indices: readonly number[]) => {
  let current = value
  for (const index of indices) {
    if (!Array.isArray(current) || index < 0 || index >= current.length) return undefined
    current = current[index]
  }
  return current
}

const fieldForIndex = (fields: readonly MemoryField[], index: number) =>
  fields.find((field) => {
    const expression = field.expression?.replace(/\s/g, '') ?? ''
    return field.name === String(index)
      || field.name === `[${index}]`
      || expression.endsWith(`[${index}]`)
  }) ?? fields[index]

const fieldAtIndices = (variable: TraceVariable, indices: readonly number[]) => {
  let fields = variable.fields ?? []
  let field: MemoryField | undefined
  let byteOffset = 0
  for (const index of indices) {
    field = fieldForIndex(fields, index)
    if (!field) return undefined
    if (field.offset !== undefined) byteOffset += field.offset
    fields = field.fields
  }
  return field ? { field, byteOffset } : undefined
}

const numericAddress = (address?: string) => {
  if (!address || !/^0x[0-9a-f]+$/i.test(address)) return undefined
  try {
    return BigInt(address)
  } catch {
    return undefined
  }
}

const computedArrayOffset = (variable: TraceVariable, indices: readonly number[]) => {
  if (!Array.isArray(variable.value) || indices.length !== 1) return undefined
  const totalSize = variable.storage?.size
  if (!totalSize || variable.value.length === 0 || totalSize % variable.value.length !== 0) return undefined
  const index = indices[0]
  if (index < 0 || index >= variable.value.length) return undefined
  return index * (totalSize / variable.value.length)
}

export const resolveArrayElement = (variable: TraceVariable, indices: readonly number[]) => {
  const value = indexedValue(variable.value, indices)
  const observed = fieldAtIndices(variable, indices)
  const computedOffset = computedArrayOffset(variable, indices)
  const byteOffset = observed?.field.address ? observed.byteOffset : computedOffset
  const baseAddress = numericAddress(variable.storage?.address)
  const computedAddress = baseAddress !== undefined && byteOffset !== undefined
    ? `0x${(baseAddress + BigInt(byteOffset)).toString(16)}`
    : undefined
  const address = observed?.field.address ?? computedAddress
  const elementSize = Array.isArray(variable.value) && variable.storage?.size
    ? variable.storage.size / variable.value.length
    : undefined
  const bytes = variable.storage?.bytes && byteOffset !== undefined && elementSize && Number.isInteger(elementSize)
    ? variable.storage.bytes.slice(byteOffset * 2, (byteOffset + elementSize) * 2) || undefined
    : undefined
  return {
    value,
    address,
    byteOffset,
    bytes,
    resolved: value !== undefined,
    addressOrigin: observed?.field.address
      ? 'observed' as const
      : computedAddress
        ? 'computed' as const
        : undefined,
  }
}
