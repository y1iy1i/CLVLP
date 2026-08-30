import type { ExecutionCursor } from '../types/executionCursor'
import type { TeachingStep } from '../types/visualization'

const displayValue = (value: unknown) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function buildTeachingStep(
  cursor: ExecutionCursor | null,
): TeachingStep | undefined {
  if (!cursor) return undefined

  const comparison = cursor.facts.find((fact) => fact.kind === 'comparison')
  if (comparison) {
    const [left, right] = comparison.operands
    const hasValues = left.value !== undefined && right.value !== undefined
    return {
      title: '正在比较两个值',
      description: hasValues
        ? `${left.expression} = ${displayValue(left.value)}，${right.expression} = ${displayValue(right.value)}`
        : `正在计算条件：${comparison.expression}`,
      sourceNodeId: cursor.currentNodeId,
      activeVariableIds: comparison.operands.flatMap((operand) => operand.variableId ? [operand.variableId] : []),
      activeMemoryObjectIds: cursor.activeMemoryIds,
      result: comparison.result === undefined
        ? undefined
        : `条件结果：${comparison.result ? '成立' : '不成立'}`,
    }
  }

  const swap = cursor.facts.find((fact) => fact.kind === 'swap')
  if (swap) {
    return {
      title: '正在交换数组元素',
      description: `${swap.variableName}[${swap.indices[0]}] 与 ${swap.variableName}[${swap.indices[1]}] 已交换`,
      sourceNodeId: cursor.currentNodeId,
      activeVariableIds: [swap.variableId],
      activeMemoryObjectIds: cursor.activeMemoryIds,
    }
  }

  const allocation = cursor.traceStep.event.data.allocations
  if (Array.isArray(allocation) && allocation.length > 0) {
    const latest = allocation.at(-1)
    if (latest && typeof latest === 'object') {
      const operation = String('operation' in latest ? latest.operation : '')
      const size = 'size' in latest ? Number(latest.size) : undefined
      const isFree = operation === 'free'
      return {
        title: isFree ? '正在释放堆内存' : '正在申请堆内存',
        description: isFree
          ? '该堆对象已被释放，之后不能再安全地解引用指向它的指针。'
          : `程序申请了${Number.isFinite(size) ? ` ${size} 字节` : ''}堆内存。`,
        sourceNodeId: cursor.currentNodeId,
        activeVariableIds: [],
        activeMemoryObjectIds: cursor.activeMemoryIds,
        warning: isFree ? '继续使用已释放地址会产生未定义行为。' : undefined,
      }
    }
  }

  if (cursor.changes.length > 0) {
    const change = cursor.changes[0]
    const variable = cursor.variables.find((item) => item.id === change.variableId)
    return {
      title: change.kind === 'declare' ? '声明变量' : '变量发生变化',
      description: variable
        ? `${variable.name}：${displayValue(change.oldValue)} → ${displayValue(change.newValue ?? variable.value)}`
        : `变量 ${change.variableId} 的状态发生了变化。`,
      sourceNodeId: cursor.currentNodeId,
      activeVariableIds: [change.variableId],
      activeMemoryObjectIds: cursor.activeMemoryIds,
    }
  }

  const currentFunction = cursor.callStack[0]?.function
  return {
    title: '程序执行到当前代码行',
    description: currentFunction
      ? `当前位于 ${currentFunction}()，第 ${cursor.currentLocation.line} 行。`
      : `当前停在第 ${cursor.currentLocation.line} 行。`,
    sourceNodeId: cursor.currentNodeId,
    activeVariableIds: [],
    activeMemoryObjectIds: cursor.activeMemoryIds,
  }
}
