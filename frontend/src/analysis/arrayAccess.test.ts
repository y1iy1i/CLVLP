import { describe, expect, it } from 'vitest'
import type { TraceVariable } from '../types/trace'
import { arrayElementMemoryId, parseArrayElementMemoryId, resolveArrayElement } from './arrayAccess'

const arrayVariable = (overrides: Partial<TraceVariable> = {}): TraceVariable => ({
  id: 'frame:main:1:arr',
  name: 'arr',
  type: 'int [3]',
  value: [5, 1, 4],
  scope: 'main',
  storage: {
    address: '0x1000',
    size: 12,
    region: 'stack',
    available: true,
    bytes: '050000000100000004000000',
  },
  ...overrides,
})

describe('array element memory resolution', () => {
  it('prefers the element address captured by GDB', () => {
    const variable = arrayVariable({
      fields: [
        { name: '0', type: 'int', value: 5, address: '0x1000', offset: 0, fields: [] },
        { name: '1', type: 'int', value: 1, address: '0x1004', offset: 4, fields: [] },
        { name: '2', type: 'int', value: 4, address: '0x1008', offset: 8, fields: [] },
      ],
    })

    expect(resolveArrayElement(variable, [1])).toMatchObject({
      value: 1,
      address: '0x1004',
      byteOffset: 4,
      bytes: '01000000',
      addressOrigin: 'observed',
      resolved: true,
    })
  })

  it('computes a one-dimensional element address only when layout data is available', () => {
    expect(resolveArrayElement(arrayVariable(), [2])).toMatchObject({
      value: 4,
      address: '0x1008',
      byteOffset: 8,
      addressOrigin: 'computed',
    })
    expect(resolveArrayElement(arrayVariable({ storage: undefined }), [2])).toMatchObject({
      value: 4,
      address: undefined,
      byteOffset: undefined,
      addressOrigin: undefined,
    })
  })

  it('keeps element selection IDs stable and reversible', () => {
    const id = arrayElementMemoryId('frame:main:1:matrix', [1, 2])
    expect(parseArrayElementMemoryId(id)).toEqual({
      variableId: 'frame:main:1:matrix',
      indices: [1, 2],
    })
  })
})
