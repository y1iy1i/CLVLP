import type { MemoryField, PointerReference, TraceVariable } from './trace'

export type MemoryRegion = 'stack' | 'global' | 'heap'

export interface MemoryRange {
  id: string
  label: string
  region: MemoryRegion
  frameId?: string
  variableId?: string
  memoryObjectId: string
  startAddress?: string
  endAddress?: string
  size?: number
  type?: string
  value?: unknown
  bytes?: string
  fields: MemoryField[]
  pointer?: PointerReference
  initialized: boolean
  status: 'alive' | 'freed' | 'unknown'
  activeAccess?: 'read' | 'write'
  newlyAllocated: boolean
  selected: boolean
}

export interface MemoryDiscontinuity {
  afterRangeId: string
  gapBytes?: number
}

export interface MemoryRegionLane {
  region: MemoryRegion
  ranges: MemoryRange[]
  capturedBytes: number
  liveBytes: number
  freedBytes: number
  discontinuities: MemoryDiscontinuity[]
}

export interface MemoryUsageSummary {
  capturedStackBytes: number
  globalBytes: number
  liveHeapBytes: number
  freedHeapBytes: number
  peakHeapBytes: number
  unknownSizeCount: number
}

export interface MemoryMapModel {
  lanes: Record<MemoryRegion, MemoryRegionLane>
  summary: MemoryUsageSummary
  registerVariables: TraceVariable[]
}
