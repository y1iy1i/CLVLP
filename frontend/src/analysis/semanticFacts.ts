import type { AnyCodeStructureNode, CodeStructure } from '../types/codeStructure'
import type {
  ComparisonFact,
  ComparisonOperand,
  RecursionFact,
  SemanticFact,
  SemanticFactMetadata,
  SwapFact,
  VariableChange,
} from '../types/executionCursor'
import type {
  PointerReference,
  SourceLocation,
  TraceStep,
  TraceVariable,
} from '../types/trace'
import { matchTraceLocation } from './flowGraphBuilder'

type FactPayload<T extends SemanticFact = SemanticFact> = T extends SemanticFact
  ? Omit<T, keyof SemanticFactMetadata>
  : never

export interface SemanticFactResult {
  facts: SemanticFact[]
  changes: VariableChange[]
  activeMemoryIds: string[]
}

const stripOuterParentheses = (value: string) => {
  let result = value.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let wrapsWholeExpression = true
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === '(') depth += 1
      if (result[index] === ')') depth -= 1
      if (depth === 0 && index < result.length - 1) {
        wrapsWholeExpression = false
        break
      }
    }
    if (!wrapsWholeExpression) break
    result = result.slice(1, -1).trim()
  }
  return result
}

const conditionExpression = (node?: AnyCodeStructureNode) => {
  if (node?.kind === 'condition') return node.details.expression
  if (node?.kind === 'loop') return node.details.condition
  return undefined
}

const comparisonParts = (expression: string) => {
  const value = stripOuterParentheses(expression)
  let squareDepth = 0
  let roundDepth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '[') squareDepth += 1
    else if (character === ']') squareDepth -= 1
    else if (character === '(') roundDepth += 1
    else if (character === ')') roundDepth -= 1
    if (squareDepth || roundDepth) continue
    const operator = ['>=', '<=', '==', '!=', '>', '<'].find(
      (candidate) => value.slice(index, index + candidate.length) === candidate,
    ) as ComparisonFact['operator'] | undefined
    if (operator) {
      return {
        left: value.slice(0, index).trim(),
        operator,
        right: value.slice(index + operator.length).trim(),
      }
    }
  }
  return null
}

class ArithmeticParser {
  private index = 0
  private readonly tokens: string[]
  private readonly variables: Map<string, number>

  constructor(
    tokens: string[],
    variables: Map<string, number>,
  ) {
    this.tokens = tokens
    this.variables = variables
  }

  parse() {
    const result = this.additive()
    return this.index === this.tokens.length && Number.isFinite(result) ? result : undefined
  }

  private additive(): number {
    let value = this.multiplicative()
    while (this.tokens[this.index] === '+' || this.tokens[this.index] === '-') {
      const operator = this.tokens[this.index++]
      const right = this.multiplicative()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  private multiplicative(): number {
    let value = this.primary()
    while (['*', '/', '%'].includes(this.tokens[this.index])) {
      const operator = this.tokens[this.index++]
      const right = this.primary()
      if (operator === '*') value *= right
      else if (operator === '/') value = Math.trunc(value / right)
      else value %= right
    }
    return value
  }

  private primary(): number {
    const token = this.tokens[this.index++]
    if (token === '-') return -this.primary()
    if (token === '(') {
      const value = this.additive()
      if (this.tokens[this.index] !== ')') return Number.NaN
      this.index += 1
      return value
    }
    if (/^\d+$/.test(token ?? '')) return Number(token)
    return this.variables.get(token) ?? Number.NaN
  }
}

const visibleVariables = (step: TraceStep) => {
  const byId = new Map(step.state.variables.map((variable) => [variable.id, variable]))
  const result = new Map<string, TraceVariable>()
  for (const frame of step.state.callStack) {
    for (const id of frame.variables) {
      const variable = byId.get(id)
      if (variable && !result.has(variable.name)) result.set(variable.name, variable)
    }
  }
  for (const variable of step.state.variables) {
    if (variable.role === 'global' && !result.has(variable.name)) {
      result.set(variable.name, variable)
    }
  }
  return result
}

const evaluateIntegerExpression = (
  expression: string,
  variables: Map<string, TraceVariable>,
) => {
  const numbers = new Map(
    [...variables.entries()].flatMap(([name, variable]) =>
      typeof variable.value === 'number' ? [[name, variable.value] as const] : [],
    ),
  )
  const tokens = expression.match(/[A-Za-z_]\w*|\d+|[()+\-*/%]/g) ?? []
  if (tokens.join('').replace(/\s/g, '') !== expression.replace(/\s/g, '')) return undefined
  return new ArithmeticParser(tokens, numbers).parse()
}

const resolveOperand = (
  role: ComparisonOperand['role'],
  expression: string,
  variables: Map<string, TraceVariable>,
  memoryObjects: Map<string, TraceStep['state']['memory'][number]>,
): ComparisonOperand => {
  const value = stripOuterParentheses(expression)
  const arrayMatch = value.match(/^([A-Za-z_]\w*)\s*\[(.+)]$/)
  if (arrayMatch) {
    const variable = variables.get(arrayMatch[1])
    const index = evaluateIntegerExpression(arrayMatch[2], variables)
    const element = Array.isArray(variable?.value) && index !== undefined
      ? variable.value[index]
      : undefined
    return {
      role,
      expression: value,
      kind: 'array_element',
      variableId: variable?.id,
      variableName: arrayMatch[1],
      indices: index === undefined ? undefined : [index],
      value: element,
      resolved: variable !== undefined && index !== undefined && element !== undefined,
    }
  }
  const pointerMatch = value.match(/^\*\s*([A-Za-z_]\w*)$/)
  if (pointerMatch) {
    const variable = variables.get(pointerMatch[1])
    const reference = variable?.pointer
    const target = reference?.targetObjectId
    const targetValue = target ? memoryObjects.get(target)?.value : undefined
    return {
      role,
      expression: value,
      kind: 'pointer_dereference',
      variableId: variable?.id,
      variableName: pointerMatch[1],
      address: reference?.addressValue ?? undefined,
      value: targetValue,
      resolved: reference?.status === 'resolved' && targetValue !== undefined,
    }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return { role, expression: value, kind: 'literal', value: Number(value), resolved: true }
  }
  const variable = variables.get(value)
  if (variable) {
    return {
      role,
      expression: value,
      kind: 'scalar',
      variableId: variable.id,
      variableName: variable.name,
      value: variable.value,
      resolved: true,
    }
  }
  return { role, expression: value, kind: 'unknown', resolved: false }
}

const compare = (operator: ComparisonFact['operator'], left: unknown, right: unknown) => {
  if (typeof left === 'number' && typeof right === 'number') {
    if (operator === '>') return left > right
    if (operator === '<') return left < right
    if (operator === '>=') return left >= right
    if (operator === '<=') return left <= right
    if (operator === '==') return left === right
    return left !== right
  }
  if (typeof left === 'string' && typeof right === 'string') {
    if (operator === '>') return left > right
    if (operator === '<') return left < right
    if (operator === '>=') return left >= right
    if (operator === '<=') return left <= right
    if (operator === '==') return left === right
    return left !== right
  }
  return undefined
}

const rawChanges = (step: TraceStep, previousStep?: TraceStep): VariableChange[] => {
  const raw = Array.isArray(step.event.data.changes) ? step.event.data.changes : []
  const parsed = raw.filter((change): change is VariableChange => Boolean(
    change && typeof change === 'object' && 'variableId' in change && 'kind' in change,
  )).filter((change) => ['declare', 'update', 'out_of_scope'].includes(change.kind))
  if (parsed.length > 0) return parsed

  const variableId = typeof step.event.data.variableId === 'string'
    ? step.event.data.variableId
    : undefined
  if (!variableId || !['declare', 'update', 'out_of_scope'].includes(step.event.type)) return []
  const current = step.state.variables.find((variable) => variable.id === variableId)
  const previous = previousStep?.state.variables.find((variable) => variable.id === variableId)
  return [{
    kind: step.event.type,
    variableId,
    oldValue: previous?.value,
    newValue: current?.value,
  }]
}

const sourceAt = (structure: CodeStructure | null, location: SourceLocation) => {
  const match = matchTraceLocation(structure, location.file, location.line)
  return {
    nodeId: match.currentNodeId ?? undefined,
    node: structure?.nodes.find((node) => node.id === match.currentNodeId),
    ancestors: match.ancestorIds,
  }
}

const nodeText = (node?: AnyCodeStructureNode) =>
  node ? `${node.label} ${JSON.stringify(node.details)}` : ''

const pointerUsedByNode = (pointer: PointerReference, node?: AnyCodeStructureNode) => {
  const text = nodeText(node)
  const variableName = pointer.sourceVariableId.split(':').at(-1) ?? ''
  const expression = pointer.sourceExpression ?? variableName
  const explicitDereference = expression !== variableName
    && (expression.includes('*') || expression.includes('->'))
  return Boolean(
    (variableName && new RegExp(`(?:\\*\\s*${variableName}\\b|\\b${variableName}\\s*->)`).test(text))
    || (explicitDereference && text.includes(expression)),
  )
}

const arrayIndicesInNode = (
  node: AnyCodeStructureNode | undefined,
  variable: TraceVariable,
  variables: Map<string, TraceVariable>,
) => {
  if (!Array.isArray(variable.value) || !node) return []
  const escapedName = variable.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = nodeText(node).matchAll(new RegExp(`\\b${escapedName}\\s*\\[([^\\]]+)]`, 'g'))
  return [...matches].flatMap((match) => {
    const index = evaluateIntegerExpression(match[1], variables)
    return index === undefined ? [] : [[index]]
  })
}

const objectIdsFor = (
  step: TraceStep,
  variableIds: string[],
  explicitObjectIds: string[] = [],
) => {
  const result = new Set([...variableIds, ...explicitObjectIds])
  for (const pointer of step.state.pointers ?? []) {
    if (variableIds.includes(pointer.sourceVariableId) && pointer.targetObjectId) {
      result.add(pointer.targetObjectId)
    }
  }
  return [...result]
}

const frameRecords = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
  : []

const allocationRecords = (value: unknown) => frameRecords(value)

export function buildSemanticFacts(
  structure: CodeStructure | null,
  step: TraceStep,
  previousStep?: TraceStep,
): SemanticFactResult {
  const facts: SemanticFact[] = []
  const seen = new Set<string>()
  const changes = rawChanges(step, previousStep)
  const variables = visibleVariables(step)
  const memoryObjects = new Map(step.state.memory.map((object) => [object.id, object]))
  const currentSource = sourceAt(structure, step.location)
  const executedLocation = step.executedLocation ?? step.location
  const executedSource = sourceAt(structure, executedLocation)

  const add = (
    payload: FactPayload,
    metadata: {
      origin: SemanticFactMetadata['origin']
      location: SourceLocation
      sourceNodeId?: string
      variableIds?: string[]
      objectIds?: string[]
    },
  ) => {
    const variableIds = [...new Set(metadata.variableIds ?? [])]
    const memoryIds = objectIdsFor(step, variableIds, metadata.objectIds)
    const key = JSON.stringify([
      payload,
      metadata.location.file,
      metadata.location.line,
      metadata.sourceNodeId,
    ])
    if (seen.has(key)) return
    seen.add(key)
    facts.push({
      ...payload,
      id: `fact:${step.step}:${payload.kind}:${facts.length}`,
      sourceNodeId: metadata.sourceNodeId,
      location: metadata.location,
      activeVariableIds: variableIds,
      activeMemoryObjectIds: memoryIds,
      origin: metadata.origin,
    } as SemanticFact)
  }

  const conditionNode = conditionExpression(currentSource.node)
    ? currentSource.node
    : currentSource.ancestors
        .map((id) => structure?.nodes.find((node) => node.id === id))
        .find((node) => node?.range.start.line === step.location.line && conditionExpression(node))
  const condition = conditionExpression(conditionNode)
  const parts = condition ? comparisonParts(condition) : null
  if (parts) {
    const left = resolveOperand('left', parts.left, variables, memoryObjects)
    const right = resolveOperand('right', parts.right, variables, memoryObjects)
    const result = left.resolved && right.resolved
      ? compare(parts.operator, left.value, right.value)
      : undefined
    const operandIds = [left.variableId, right.variableId].filter((id): id is string => Boolean(id))
    add({
      kind: 'comparison',
      expression: stripOuterParentheses(condition!),
      operator: parts.operator,
      operands: [left, right],
      result,
    }, {
      origin: 'derived',
      location: step.location,
      sourceNodeId: conditionNode?.id,
      variableIds: operandIds,
    })
    for (const operand of [left, right]) {
      if (operand.kind === 'array_element' && operand.variableId && operand.variableName && operand.indices) {
        add({
          kind: 'array_access',
          variableId: operand.variableId,
          variableName: operand.variableName,
          indices: operand.indices,
          access: 'read',
        }, {
          origin: 'derived',
          location: step.location,
          sourceNodeId: conditionNode?.id,
          variableIds: [operand.variableId],
        })
      }
    }
    if (result !== undefined) {
      add({
        kind: 'branch',
        expression: stripOuterParentheses(condition!),
        selected: result ? 'true' : 'false',
      }, {
        origin: 'derived',
        location: step.location,
        sourceNodeId: conditionNode?.id,
        variableIds: operandIds,
      })
    }
  }

  const relationsFor = (nodeId: string | undefined, type: 'reads' | 'writes') =>
    structure?.relations.filter((relation) => relation.from === nodeId && relation.type === type && relation.resolved) ?? []
  const currentReadNode = conditionNode ?? currentSource.node
  for (const relation of relationsFor(currentReadNode?.id, 'reads')) {
    const target = structure?.nodes.find((node) => node.id === relation.to)
    const variable = target?.name ? variables.get(target.name) : undefined
    if (!variable) continue
    add({
      kind: 'variable_access',
      variableId: variable.id,
      variableName: variable.name,
      access: 'read',
      value: variable.value,
    }, {
      origin: 'derived',
      location: step.location,
      sourceNodeId: currentReadNode?.id,
      variableIds: [variable.id],
    })
    for (const indices of arrayIndicesInNode(currentReadNode, variable, variables)) {
      add({
        kind: 'array_access',
        variableId: variable.id,
        variableName: variable.name,
        indices,
        access: 'read',
      }, {
        origin: 'derived',
        location: step.location,
        sourceNodeId: currentReadNode?.id,
        variableIds: [variable.id],
      })
    }
  }

  const currentById = new Map(step.state.variables.map((variable) => [variable.id, variable]))
  const previousById = new Map(previousStep?.state.variables.map((variable) => [variable.id, variable]) ?? [])
  for (const change of changes) {
    const variable = currentById.get(change.variableId) ?? previousById.get(change.variableId)
    add({
      kind: 'assignment',
      variableId: change.variableId,
      changeKind: change.kind as 'declare' | 'update' | 'out_of_scope',
      oldValue: change.oldValue,
      newValue: change.newValue,
    }, {
      origin: 'observed',
      location: executedLocation,
      sourceNodeId: executedSource.nodeId,
      variableIds: [change.variableId],
    })
    if (variable && change.kind !== 'out_of_scope') {
      add({
        kind: 'variable_access',
        variableId: variable.id,
        variableName: variable.name,
        access: 'write',
        value: variable.value,
      }, {
        origin: 'observed',
        location: executedLocation,
        sourceNodeId: executedSource.nodeId,
        variableIds: [variable.id],
      })
    }
  }

  for (const relation of relationsFor(executedSource.nodeId, 'writes')) {
    const target = structure?.nodes.find((node) => node.id === relation.to)
    const variable = target?.name ? variables.get(target.name) : undefined
    if (!variable) continue
    add({
      kind: 'variable_access',
      variableId: variable.id,
      variableName: variable.name,
      access: 'write',
      value: variable.value,
    }, {
      origin: 'derived',
      location: executedLocation,
      sourceNodeId: executedSource.nodeId,
      variableIds: [variable.id],
    })
    for (const indices of arrayIndicesInNode(executedSource.node, variable, variables)) {
      add({
        kind: 'array_access',
        variableId: variable.id,
        variableName: variable.name,
        indices,
        access: 'write',
      }, {
        origin: 'derived',
        location: executedLocation,
        sourceNodeId: executedSource.nodeId,
        variableIds: [variable.id],
      })
    }
  }

  if (previousStep) {
    const previousVariables = new Map(previousStep.state.variables.map((variable) => [variable.id, variable]))
    for (const variable of step.state.variables) {
      if (!Array.isArray(variable.value)) continue
      const before = previousVariables.get(variable.id)?.value
      if (!Array.isArray(before) || before.length !== variable.value.length) continue
      const changed = variable.value.flatMap((value, index) => before[index] !== value ? [index] : [])
      if (
        changed.length === 2
        && before[changed[0]] === variable.value[changed[1]]
        && before[changed[1]] === variable.value[changed[0]]
      ) {
        add({
          kind: 'swap',
          variableId: variable.id,
          variableName: variable.name,
          indices: [changed[0], changed[1]],
        } satisfies Omit<SwapFact, keyof SemanticFactMetadata>, {
          origin: 'derived',
          location: executedLocation,
          sourceNodeId: executedSource.nodeId,
          variableIds: [variable.id],
        })
      }
    }
  }

  const activeAccesses = facts.filter((fact) =>
    fact.kind === 'variable_access' || fact.kind === 'array_access' || fact.kind === 'assignment',
  )
  const activeVariableIds = new Set(activeAccesses.flatMap((fact) => fact.activeVariableIds))
  for (const pointer of step.state.pointers ?? []) {
    const currentPointerNode = conditionNode ?? currentSource.node
    const usedByCurrent = pointerUsedByNode(pointer, currentPointerNode)
    const usedByExecuted = pointerUsedByNode(pointer, executedSource.node)
    const pointerWritten = facts.some((fact) =>
      fact.kind === 'variable_access'
      && fact.variableId === pointer.sourceVariableId
      && fact.access === 'write',
    )
    if (!activeVariableIds.has(pointer.sourceVariableId) && !usedByCurrent && !usedByExecuted) continue
    const emitPointer = (
      access: 'read' | 'write' | 'dereference',
      location: SourceLocation,
      sourceNodeId: string | undefined,
      origin: SemanticFactMetadata['origin'],
    ) => add({
      kind: 'pointer_access',
      variableId: pointer.sourceVariableId,
      expression: pointer.sourceExpression ?? pointer.sourceVariableId.split(':').at(-1) ?? pointer.sourceVariableId,
      address: pointer.addressValue ?? undefined,
      targetObjectId: pointer.targetObjectId,
      status: pointer.status,
      access,
      resolved: pointer.status === 'resolved',
    }, {
      origin,
      location,
      sourceNodeId,
      variableIds: [pointer.sourceVariableId],
      objectIds: pointer.targetObjectId ? [pointer.targetObjectId] : [],
    })

    if (usedByCurrent) emitPointer('dereference', step.location, currentPointerNode?.id, 'derived')
    if (usedByExecuted) emitPointer('dereference', executedLocation, executedSource.nodeId, 'derived')
    if (pointerWritten) emitPointer('write', executedLocation, executedSource.nodeId, 'observed')
    if (!usedByCurrent && !usedByExecuted && !pointerWritten) {
      emitPointer('read', step.location, currentSource.nodeId, 'derived')
    }
  }

  if (step.event.type === 'function_enter') {
    const frames = frameRecords(step.event.data.frames)
    const entries = frames.length > 0
      ? frames
      : step.event.data.function
        ? [{ function: step.event.data.function, id: step.event.data.frameId }]
        : []
    for (const frameData of entries) {
      const functionName = String(frameData.function ?? 'unknown')
      const frameId = typeof frameData.id === 'string' ? frameData.id : undefined
      const frame = step.state.callStack.find((candidate) => candidate.id === frameId)
      const depth = step.state.callStack.filter((candidate) => candidate.function === functionName).length
      add({
        kind: 'function_call',
        functionName,
        frameId,
        argumentVariableIds: frame?.arguments ?? [],
        callKind: step.event.data.initial === true ? 'entry' : depth > 1 ? 'recursive' : 'direct',
      }, {
        origin: 'observed',
        location: step.event.data.initial === true ? step.location : executedLocation,
        sourceNodeId: step.event.data.initial === true ? currentSource.nodeId : executedSource.nodeId,
        variableIds: frame?.arguments ?? [],
      })
    }
  }

  const returnFrames = [
    ...(step.event.type === 'function_exit' ? frameRecords(step.event.data.frames) : []),
    ...frameRecords(step.event.data.terminalReturns),
  ]
  if (step.event.type === 'return' && returnFrames.length === 0) {
    returnFrames.push({
      function: step.state.callStack[0]?.function ?? 'unknown',
      returnAvailable: 'value' in step.event.data,
      returnValue: step.event.data.value,
    })
  }
  for (const frameData of returnFrames) {
    const available = frameData.returnAvailable === true
    add({
      kind: 'function_return',
      functionName: String(frameData.function ?? 'unknown'),
      frameId: typeof frameData.id === 'string'
        ? frameData.id
        : typeof frameData.frameId === 'string' ? frameData.frameId : undefined,
      returnAvailable: available,
      returnValue: available ? frameData.returnValue : undefined,
      returnType: typeof frameData.returnType === 'string' ? frameData.returnType : undefined,
    }, {
      origin: 'observed',
      location: executedLocation,
      sourceNodeId: executedSource.nodeId,
    })
  }

  const previousObjects = previousStep?.state.memory ?? []
  for (const allocation of allocationRecords(step.event.data.allocations)) {
    const operation = String(allocation.operation ?? '')
    const address = typeof allocation.address === 'string' ? allocation.address : undefined
    const objectId = typeof allocation.allocationId === 'string' ? allocation.allocationId : undefined
    if (operation === 'free') {
      add({ kind: 'deallocation', operation: 'free', memoryObjectId: objectId, address }, {
        origin: 'observed',
        location: executedLocation,
        sourceNodeId: executedSource.nodeId,
        objectIds: objectId ? [objectId] : [],
      })
      continue
    }
    if (!['malloc', 'calloc', 'realloc'].includes(operation)) continue
    const previousAddress = typeof allocation.previousAddress === 'string'
      ? allocation.previousAddress
      : undefined
    add({
      kind: 'allocation',
      operation: operation as 'malloc' | 'calloc' | 'realloc',
      memoryObjectId: objectId,
      address,
      previousAddress,
      size: typeof allocation.size === 'number' ? allocation.size : undefined,
      success: allocation.success !== false && Boolean(objectId),
    }, {
      origin: 'observed',
      location: executedLocation,
      sourceNodeId: executedSource.nodeId,
      objectIds: objectId ? [objectId] : [],
    })
    if (operation === 'realloc' && previousAddress && previousAddress !== address) {
      const previousObject = previousObjects.find((object) => object.address === previousAddress)
      add({
        kind: 'deallocation',
        operation: 'realloc',
        memoryObjectId: previousObject?.id,
        address: previousAddress,
      }, {
        origin: 'observed',
        location: executedLocation,
        sourceNodeId: executedSource.nodeId,
        objectIds: previousObject ? [previousObject.id] : [],
      })
    }
  }

  const currentFunction = step.state.callStack[0]?.function
  if (currentFunction) {
    const depth = step.state.callStack.filter((frame) => frame.function === currentFunction).length
    if (depth > 1) {
      add({ kind: 'recursion', functionName: currentFunction, depth } satisfies Omit<RecursionFact, keyof SemanticFactMetadata>, {
        origin: 'derived',
        location: step.location,
        sourceNodeId: currentSource.nodeId,
      })
    }
  }

  for (const [channel, field] of [['stdout', 'stdoutDelta'], ['stderr', 'stderrDelta']] as const) {
    const text = step.event.data[field]
    if (typeof text === 'string' && text) {
      add({ kind: 'output', channel, text }, {
        origin: 'observed',
        location: executedLocation,
        sourceNodeId: executedSource.nodeId,
      })
    }
  }
  if (step.event.type === 'output' && typeof step.event.data.text === 'string' && step.event.data.text) {
    add({ kind: 'output', channel: 'stdout', text: step.event.data.text }, {
      origin: 'observed',
      location: executedLocation,
      sourceNodeId: executedSource.nodeId,
    })
  }
  if (step.event.type === 'runtime_signal') {
    const signal = typeof step.event.data.signal === 'string' ? step.event.data.signal : undefined
    add({
      kind: 'runtime_error',
      signal,
      message: signal ? `程序收到运行时信号 ${signal}` : '程序发生运行时错误',
    }, {
      origin: 'observed',
      location: step.location,
      sourceNodeId: currentSource.nodeId,
    })
  }

  const activeMemoryIds = new Set(changes.map((change) => change.variableId))
  for (const fact of facts) {
    fact.activeMemoryObjectIds.forEach((id) => activeMemoryIds.add(id))
  }
  return { facts, changes, activeMemoryIds: [...activeMemoryIds] }
}

export const currentComparison = (facts: readonly SemanticFact[]) =>
  facts.find((fact): fact is ComparisonFact => fact.kind === 'comparison')
