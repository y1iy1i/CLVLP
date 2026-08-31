import type { VariableChange } from '../../types/executionCursor'
import type { TraceVariable } from '../../types/trace'
import type { VisualizationContext } from '../../types/visualization'
import { buildInitializedVariableIds } from '../../analysis/initializedVariables'

export type VariableActivity = 'declare' | 'read' | 'write' | 'out_of_scope' | 'unavailable' | 'idle'

export interface VariableHistoryPoint {
  step: number
  value?: number
}

export interface VariableInspectorItem {
  variable: TraceVariable
  previousValue?: unknown
  change?: VariableChange
  activity: VariableActivity
  history: VariableHistoryPoint[]
  recentValues: unknown[]
}

export interface VariableInspectorGroup {
  id: string
  title: string
  frameId?: string
  current: boolean
  defaultExpanded: boolean
  items: VariableInspectorItem[]
}

const serialized = (value: unknown) => {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

const activityFor = (
  variable: TraceVariable,
  context: VisualizationContext,
  change?: VariableChange,
  firstInitialization = false,
): VariableActivity => {
  if (variable.available === false) return 'unavailable'
  if (change?.kind === 'out_of_scope') return 'out_of_scope'
  if (firstInitialization || change?.kind === 'declare') return 'declare'
  const facts = context.execution.current?.facts ?? []
  if (facts.some((fact) =>
    (fact.kind === 'variable_access' || fact.kind === 'array_access')
    && fact.variableId === variable.id
    && fact.access === 'write',
  ) || change?.kind === 'update') return 'write'
  if (facts.some((fact) =>
    (fact.kind === 'variable_access' || fact.kind === 'array_access')
    && fact.variableId === variable.id
    && fact.access === 'read',
  )) return 'read'
  return 'idle'
}

const historyFor = (
  variableId: string,
  context: VisualizationContext,
): { history: VariableHistoryPoint[]; recentValues: unknown[] } => {
  const end = Math.min(context.execution.currentIndex, context.execution.history.length - 1)
  if (end < 0) return { history: [], recentValues: [] }
  const initialized = new Set<string>()
  const records = context.execution.history.slice(0, end + 1).map((cursor) => {
    cursor.variables.forEach((variable) => {
      if (variable.role === 'parameter' || variable.role === 'global') initialized.add(variable.id)
    })
    cursor.changes.forEach((change) => {
      if (change.kind !== 'out_of_scope') initialized.add(change.variableId)
    })
    cursor.facts.forEach((fact) => {
      if (fact.kind === 'assignment' && fact.changeKind !== 'out_of_scope') initialized.add(fact.variableId)
    })
    return { cursor, initialized: new Set(initialized) }
  })
  const visibleRecords = records.slice(-20)
  const history = visibleRecords.map(({ cursor, initialized: initializedAtStep }) => {
    if (!initializedAtStep.has(variableId)) return { step: cursor.step, value: undefined }
    const value = cursor.variables.find((variable) => variable.id === variableId)?.value
    return { step: cursor.step, value: typeof value === 'number' ? value : undefined }
  })
  const recentValues: unknown[] = []
  let previousKey: string | undefined
  for (const { cursor, initialized: initializedAtStep } of visibleRecords) {
    if (!initializedAtStep.has(variableId)) continue
    const variable = cursor.variables.find((candidate) => candidate.id === variableId)
    if (!variable) continue
    const key = serialized(variable.value)
    if (key === previousKey) continue
    previousKey = key
    recentValues.push(variable.value)
  }
  return { history, recentValues: recentValues.slice(-4) }
}

const itemFor = (
  variable: TraceVariable,
  context: VisualizationContext,
  change?: VariableChange,
  firstInitialization = false,
): VariableInspectorItem => {
  const previous = context.execution.previous?.variables.find((candidate) => candidate.id === variable.id)
  const history = historyFor(variable.id, context)
  return {
    variable,
    previousValue: firstInitialization ? undefined : change?.oldValue ?? previous?.value,
    change,
    activity: activityFor(variable, context, change, firstInitialization),
    ...history,
  }
}

export function buildVariableInspectorGroups(
  context: VisualizationContext,
): VariableInspectorGroup[] {
  const cursor = context.execution.current
  if (!cursor) return []
  const byId = new Map(cursor.variables.map((variable) => [variable.id, variable]))
  const changes = new Map(cursor.changes.map((change) => [change.variableId, change]))
  const initialized = buildInitializedVariableIds(context)
  const previousContext = {
    ...context,
    execution: {
      ...context.execution,
      currentIndex: context.execution.currentIndex - 1,
    },
  }
  const previouslyInitialized = context.execution.currentIndex > 0
    ? buildInitializedVariableIds(previousContext)
    : new Set<string>()
  const claimed = new Set<string>()
  const groups: VariableInspectorGroup[] = []

  cursor.callStack.forEach((frame, index) => {
    const variables = frame.variables.flatMap((id) => {
      const variable = byId.get(id)
      if (!variable || variable.role === 'global') return []
      if (!initialized.has(variable.id)) return []
      claimed.add(variable.id)
      return [itemFor(
        variable,
        context,
        changes.get(variable.id),
        !previouslyInitialized.has(variable.id),
      )]
    })
    if (variables.length > 0 || index === 0) {
      groups.push({
        id: `frame:${frame.id}`,
        title: `${frame.function}()${index === 0 ? ' · 当前函数' : ''}`,
        frameId: frame.id,
        current: index === 0,
        defaultExpanded: index === 0,
        items: variables,
      })
    }
  })

  const globals = cursor.variables.filter((variable) => variable.role === 'global')
  globals.forEach((variable) => claimed.add(variable.id))
  if (globals.length > 0) {
    groups.push({
      id: 'globals',
      title: '全局变量',
      current: false,
      defaultExpanded: true,
      items: globals.map((variable) => itemFor(variable, context, changes.get(variable.id))),
    })
  }

  const ungrouped = cursor.variables.filter((variable) =>
    !claimed.has(variable.id) && initialized.has(variable.id),
  )
  if (ungrouped.length > 0) {
    groups.push({
      id: 'other',
      title: '其他可见变量',
      current: false,
      defaultExpanded: true,
      items: ungrouped.map((variable) => itemFor(variable, context, changes.get(variable.id))),
    })
  }

  const previousById = new Map(context.execution.previous?.variables.map((variable) => [variable.id, variable]) ?? [])
  const outOfScope = cursor.changes.flatMap((change) => {
    if (change.kind !== 'out_of_scope') return []
    const variable = previousById.get(change.variableId)
    return variable ? [itemFor(variable, context, change)] : []
  })
  if (outOfScope.length > 0) {
    groups.push({
      id: 'out-of-scope',
      title: '本步离开作用域',
      current: false,
      defaultExpanded: true,
      items: outOfScope,
    })
  }

  return groups
}
