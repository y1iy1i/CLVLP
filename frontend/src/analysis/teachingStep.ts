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
      sourceNodeId: comparison.sourceNodeId,
      activeVariableIds: comparison.activeVariableIds,
      activeMemoryObjectIds: comparison.activeMemoryObjectIds,
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
      sourceNodeId: swap.sourceNodeId,
      activeVariableIds: swap.activeVariableIds,
      activeMemoryObjectIds: swap.activeMemoryObjectIds,
    }
  }

  const deallocation = cursor.facts.find((fact) => fact.kind === 'deallocation')
  if (deallocation) {
    return {
      title: '正在释放堆内存',
      description: '该堆对象已被释放，之后不能再安全地解引用指向它的指针。',
      sourceNodeId: deallocation.sourceNodeId,
      activeVariableIds: deallocation.activeVariableIds,
      activeMemoryObjectIds: deallocation.activeMemoryObjectIds,
      warning: '继续使用已释放地址会产生未定义行为。',
    }
  }

  const allocation = cursor.facts.find((fact) => fact.kind === 'allocation')
  if (allocation) {
    return {
      title: '正在申请堆内存',
      description: allocation.success
        ? `程序申请了${allocation.size === undefined ? '' : ` ${allocation.size} 字节`}堆内存。`
        : '本次内存申请失败，没有得到可用的堆对象。',
      sourceNodeId: allocation.sourceNodeId,
      activeVariableIds: allocation.activeVariableIds,
      activeMemoryObjectIds: allocation.activeMemoryObjectIds,
      warning: allocation.success ? undefined : '分配结果为空，不能解引用。',
    }
  }

  const runtimeError = cursor.facts.find((fact) => fact.kind === 'runtime_error')
  if (runtimeError) {
    return {
      title: '程序发生运行时错误',
      description: runtimeError.message,
      sourceNodeId: runtimeError.sourceNodeId,
      activeVariableIds: runtimeError.activeVariableIds,
      activeMemoryObjectIds: runtimeError.activeMemoryObjectIds,
      warning: runtimeError.signal,
    }
  }

  const functionCall = cursor.facts.find((fact) => fact.kind === 'function_call')
  if (functionCall) {
    return {
      title: functionCall.callKind === 'entry' ? '程序进入入口函数' : '正在调用函数',
      description: `${functionCall.functionName}() 创建了新的调用栈帧。`,
      sourceNodeId: functionCall.sourceNodeId,
      activeVariableIds: functionCall.activeVariableIds,
      activeMemoryObjectIds: functionCall.activeMemoryObjectIds,
    }
  }

  const functionReturn = cursor.facts.find((fact) => fact.kind === 'function_return')
  if (functionReturn) {
    return {
      title: '函数执行完成',
      description: functionReturn.returnAvailable
        ? `${functionReturn.functionName}() 返回 ${displayValue(functionReturn.returnValue)}。`
        : `${functionReturn.functionName}() 已返回，返回值不可用。`,
      sourceNodeId: functionReturn.sourceNodeId,
      activeVariableIds: functionReturn.activeVariableIds,
      activeMemoryObjectIds: functionReturn.activeMemoryObjectIds,
    }
  }

  const assignment = cursor.facts.find((fact) => fact.kind === 'assignment')
  if (assignment) {
    const variable = cursor.variables.find((item) => item.id === assignment.variableId)
    return {
      title: assignment.changeKind === 'declare' ? '声明变量' : '变量发生变化',
      description: variable
        ? `${variable.name}：${displayValue(assignment.oldValue)} → ${displayValue(assignment.newValue ?? variable.value)}`
        : `变量 ${assignment.variableId} 的状态发生了变化。`,
      sourceNodeId: assignment.sourceNodeId,
      activeVariableIds: assignment.activeVariableIds,
      activeMemoryObjectIds: assignment.activeMemoryObjectIds,
    }
  }

  const output = cursor.facts.find((fact) => fact.kind === 'output')
  if (output) {
    return {
      title: output.channel === 'stdout' ? '程序产生输出' : '程序产生错误输出',
      description: `${output.channel}：${displayValue(output.text)}`,
      sourceNodeId: output.sourceNodeId,
      activeVariableIds: output.activeVariableIds,
      activeMemoryObjectIds: output.activeMemoryObjectIds,
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
