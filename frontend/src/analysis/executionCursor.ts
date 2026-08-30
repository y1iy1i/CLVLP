import { matchTraceLocation } from './flowGraphBuilder'
import type { AnyCodeStructureNode, CodeStructure } from '../types/codeStructure'
import type {
  ArrayAccessFact,
  ComparisonFact,
  ComparisonOperand,
  ExecutionCursor,
  RecursionFact,
  SemanticFact,
  SwapFact,
  VariableChange,
} from '../types/executionCursor'
import type { ProgramMap } from '../types/programMap'
import type { TraceStep, TraceVariable } from '../types/trace'

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

  constructor(tokens: string[], variables: Map<string, number>) {
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

const evaluateIntegerExpression = (
  expression: string,
  variables: Map<string, number>,
) => {
  const tokens = expression.match(/[A-Za-z_]\w*|\d+|[()+\-*/%]/g) ?? []
  if (tokens.join('').replace(/\s/g, '') !== expression.replace(/\s/g, '')) return undefined
  return new ArithmeticParser(tokens, variables).parse()
}

const variableByName = (variables: TraceVariable[]) =>
  new Map(variables.map((variable) => [variable.name, variable]))

const scalarNumbers = (variables: TraceVariable[]) =>
  new Map(
    variables
      .filter((variable): variable is TraceVariable & { value: number } => typeof variable.value === 'number')
      .map((variable) => [variable.name, variable.value]),
  )

const resolveOperand = (
  role: ComparisonOperand['role'],
  expression: string,
  variables: TraceVariable[],
): ComparisonOperand => {
  const value = stripOuterParentheses(expression)
  const byName = variableByName(variables)
  const numbers = scalarNumbers(variables)
  const arrayMatch = value.match(/^([A-Za-z_]\w*)\s*\[(.+)]$/)
  if (arrayMatch) {
    const variable = byName.get(arrayMatch[1])
    const index = evaluateIntegerExpression(arrayMatch[2], numbers)
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
  if (value.startsWith('*')) {
    const name = value.slice(1).trim()
    const variable = byName.get(name)
    return {
      role,
      expression: value,
      kind: 'pointer_dereference',
      variableId: variable?.id,
      variableName: name,
      address: typeof variable?.value === 'string' ? variable.value : undefined,
      resolved: false,
    }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return { role, expression: value, kind: 'literal', value: Number(value), resolved: true }
  }
  const variable = byName.get(value)
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

const conditionExpression = (node?: AnyCodeStructureNode) => {
  if (node?.kind === 'condition') return node.details.expression
  if (node?.kind === 'loop') return node.details.condition
  return undefined
}

const comparisonFact = (
  node: AnyCodeStructureNode | undefined,
  variables: TraceVariable[],
): ComparisonFact | undefined => {
  const expression = conditionExpression(node)
  if (!expression) return undefined
  const parts = comparisonParts(expression)
  if (!parts) return undefined
  const left = resolveOperand('left', parts.left, variables)
  const right = resolveOperand('right', parts.right, variables)
  return {
    kind: 'comparison',
    expression: stripOuterParentheses(expression),
    operator: parts.operator,
    operands: [left, right],
    result: left.resolved && right.resolved
      ? compare(parts.operator, left.value, right.value)
      : undefined,
  }
}

const swapFacts = (step: TraceStep, previousStep?: TraceStep): SwapFact[] => {
  if (!previousStep) return []
  const previousByName = variableByName(previousStep.state.variables)
  return step.state.variables.flatMap((variable) => {
    if (!Array.isArray(variable.value)) return []
    const before = previousByName.get(variable.name)?.value
    if (!Array.isArray(before) || before.length !== variable.value.length) return []
    const changed = variable.value.flatMap((value, index) => before[index] !== value ? [index] : [])
    if (
      changed.length === 2 &&
      before[changed[0]] === variable.value[changed[1]] &&
      before[changed[1]] === variable.value[changed[0]]
    ) {
      return [{
        kind: 'swap' as const,
        variableId: variable.id,
        variableName: variable.name,
        indices: [changed[0], changed[1]] as [number, number],
      }]
    }
    return []
  })
}

const recursionFact = (step: TraceStep): RecursionFact | undefined => {
  const currentFunction = step.state.callStack[0]?.function
  if (!currentFunction) return undefined
  const depth = step.state.callStack.filter((frame) => frame.function === currentFunction).length
  return depth > 1 ? { kind: 'recursion', functionName: currentFunction, depth } : undefined
}

const modulePathFor = (
  map: ProgramMap | null,
  currentNodeId?: string,
) => {
  if (!map || !currentNodeId) return []
  const modulesById = new Map(map.modules.map((module) => [module.id, module]))
  const candidates = map.modules.filter((module) => module.sourceNodeIds.includes(currentNodeId))
  let current = candidates.at(-1)
  if (!current) return []
  const path: string[] = []
  while (current) {
    path.unshift(current.id)
    current = current.parentId ? modulesById.get(current.parentId) : undefined
  }
  return path
}

export function buildExecutionCursor(
  structure: CodeStructure | null,
  step: TraceStep | undefined,
  previousStep?: TraceStep,
  programMap: ProgramMap | null = null,
): ExecutionCursor | null {
  if (!step) return null
  const match = matchTraceLocation(structure, step.location.file, step.location.line)
  const currentNode = structure?.nodes.find((node) => node.id === match.currentNodeId)
  const conditionNode = conditionExpression(currentNode)
    ? currentNode
    : match.ancestorIds
        .map((id) => structure?.nodes.find((node) => node.id === id))
        .find((node) => node?.range.start.line === step.location.line && conditionExpression(node))
  const comparison = comparisonFact(conditionNode, step.state.variables)
  const facts: SemanticFact[] = []
  if (comparison) {
    facts.push(comparison)
    comparison.operands.forEach((operand) => {
      if (operand.kind === 'array_element' && operand.variableId && operand.variableName && operand.indices) {
        facts.push({
          kind: 'array_access',
          variableId: operand.variableId,
          variableName: operand.variableName,
          indices: operand.indices,
          access: 'read',
        } satisfies ArrayAccessFact)
      }
    })
  }
  facts.push(...swapFacts(step, previousStep))
  const recursion = recursionFact(step)
  if (recursion) facts.push(recursion)

  const rawChanges = Array.isArray(step.event.data.changes) ? step.event.data.changes : []
  const changes = rawChanges.filter(
    (change): change is VariableChange => Boolean(
      change && typeof change === 'object' && 'variableId' in change && 'kind' in change,
    ),
  )
  const activeMemoryIds = new Set(changes.map((change) => String(change.variableId)))
  facts.forEach((fact) => {
    if ('variableId' in fact) activeMemoryIds.add(fact.variableId)
    if (fact.kind === 'comparison') {
      fact.operands.forEach((operand) => {
        if (operand.variableId) activeMemoryIds.add(operand.variableId)
      })
    }
  })

  return {
    step: step.step,
    currentLocation: step.location,
    executedLocation: step.executedLocation,
    currentNodeId: match.currentNodeId ?? undefined,
    functionId: match.functionId ?? undefined,
    ancestorNodeIds: match.ancestorIds,
    activeModulePath: modulePathFor(programMap, match.currentNodeId ?? undefined),
    variables: step.state.variables,
    callStack: step.state.callStack,
    memory: {
      variables: step.state.variables,
      callStack: step.state.callStack,
      objects: step.state.memory,
    },
    changes,
    facts,
    activeMemoryIds: [...activeMemoryIds],
    traceStep: step,
  }
}

export const currentComparison = (cursor?: ExecutionCursor | null) =>
  cursor?.facts.find((fact): fact is ComparisonFact => fact.kind === 'comparison')
