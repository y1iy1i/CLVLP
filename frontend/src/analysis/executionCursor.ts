import type { CodeStructure } from '../types/codeStructure'
import type { ComparisonFact, ExecutionCursor } from '../types/executionCursor'
import type { ProgramMap } from '../types/programMap'
import type { TraceStep } from '../types/trace'
import { matchTraceLocation } from './flowGraphBuilder'
import { buildSemanticFacts } from './semanticFacts'

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
  const semantic = buildSemanticFacts(structure, step, previousStep)

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
      pointers: step.state.pointers ?? [],
    },
    changes: semantic.changes,
    facts: semantic.facts,
    activeMemoryIds: semantic.activeMemoryIds,
    traceStep: step,
  }
}

export const currentComparison = (cursor?: ExecutionCursor | null) =>
  cursor?.facts.find((fact): fact is ComparisonFact => fact.kind === 'comparison')
