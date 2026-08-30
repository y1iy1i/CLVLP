import type { Node as SyntaxNode } from 'web-tree-sitter'
import type {
  AnyCodeStructureNode,
  CodeRelation,
  CodeStructure,
  CodeStructureNode,
  NodeDetailsByKind,
  NodeKind,
  SourceRange,
  StructureDiagnostic,
} from '../types/codeStructure'

const MAX_STRUCTURE_NODES = 1000

interface PendingReference {
  from: string
  names: string[]
  type: 'reads' | 'writes'
  range: SourceRange
}

interface MappingContext {
  entryFile: string
  source: string
  nodes: AnyCodeStructureNode[]
  relations: CodeRelation[]
  diagnostics: StructureDiagnostic[]
  stableCounts: Map<string, number>
  relationCount: number
  pendingReferences: PendingReference[]
  truncated: boolean
}

const compact = (value: string, max = 72) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized
}

const rangeFor = (node: SyntaxNode, file: string): SourceRange => ({
  file,
  start: {
    line: node.startPosition.row + 1,
    column: node.startPosition.column + 1,
  },
  end: {
    line: node.endPosition.row + 1,
    column: node.endPosition.column + 1,
  },
})

const field = (node: SyntaxNode, name: string) => node.childForFieldName(name)

const identifiers = (node: SyntaxNode | null): string[] => {
  if (!node) return []
  if (node.type === 'identifier' || node.type === 'field_identifier') return [node.text]
  return node.namedChildren.flatMap(identifiers)
}

const declaratorName = (node: SyntaxNode | null): string | undefined => {
  if (!node) return undefined
  if (node.type === 'identifier' || node.type === 'field_identifier') return node.text
  const named = field(node, 'declarator')
  if (named) return declaratorName(named)
  for (const child of node.namedChildren) {
    const found = declaratorName(child)
    if (found) return found
  }
  return undefined
}

const dimensionsOf = (node: SyntaxNode | null): number[] => {
  if (!node) return []
  const values: number[] = []
  const visit = (candidate: SyntaxNode) => {
    if (candidate.type === 'array_declarator') {
      const size = field(candidate, 'size')
      values.push(size && /^\d+$/.test(size.text.trim()) ? Number(size.text) : -1)
    }
    candidate.namedChildren.forEach(visit)
  }
  visit(node)
  return values
}

const declarationType = (node: SyntaxNode) => {
  const typeNode = field(node, 'type') ?? node.namedChildren.find((child) =>
    /(?:type|specifier|primitive_type)$/.test(child.type),
  )
  return typeNode ? compact(typeNode.text, 50) : undefined
}

const storageClass = (node: SyntaxNode) =>
  node.namedChildren.find((child) => child.type === 'storage_class_specifier')?.text

const topIdentifiers = (node: SyntaxNode | null) => {
  if (!node) return []
  const result: string[] = []
  const visit = (candidate: SyntaxNode) => {
    if (candidate.type === 'identifier') {
      result.push(candidate.text)
      return
    }
    if (
      candidate.type === 'type_identifier' ||
      candidate.type === 'field_identifier' ||
      candidate.type === 'string_literal' ||
      candidate.type === 'char_literal'
    ) return
    candidate.namedChildren.forEach(visit)
  }
  visit(node)
  return result
}

function addNode<K extends NodeKind>(
  context: MappingContext,
  node: SyntaxNode,
  parentId: string | null,
  kind: K,
  label: string,
  details: NodeDetailsByKind[K],
  name?: string,
  stableHint?: string,
): string | null {
  if (context.nodes.length >= MAX_STRUCTURE_NODES) {
    if (!context.truncated) {
      context.truncated = true
      context.diagnostics.push({
        severity: 'warning',
        code: 'STRUCTURE_TRUNCATED',
        message: `代码结构节点超过 ${MAX_STRUCTURE_NODES} 个，已停止继续收集。`,
        range: rangeFor(node, context.entryFile),
      })
    }
    return null
  }

  const parent = parentId ? context.nodes.find((item) => item.id === parentId) : undefined
  const semantic = compact(stableHint ?? name ?? label, 60).replace(/\s+/g, '_') || kind
  const stableBase = `${parent?.stableKey ?? context.entryFile}/${kind}:${semantic}`
  const occurrence = (context.stableCounts.get(stableBase) ?? 0) + 1
  context.stableCounts.set(stableBase, occurrence)
  const stableKey = occurrence === 1 ? stableBase : `${stableBase}:${occurrence}`
  const position = `${node.startPosition.row + 1}:${node.startPosition.column + 1}`
  const id = `${context.entryFile}:${kind}:${position}:${context.nodes.length}`
  const item = {
    id,
    stableKey,
    kind,
    name,
    label: compact(label),
    rawKind: node.type,
    range: rangeFor(node, context.entryFile),
    parentId,
    children: [],
    details,
  } as AnyCodeStructureNode
  context.nodes.push(item)

  if (parent) {
    parent.children.push(id)
    context.relations.push({
      id: `relation:${context.relationCount++}`,
      type: 'contains',
      from: parent.id,
      to: id,
      resolved: true,
      location: item.range,
    })
  }
  return id
}

const addAccess = (
  context: MappingContext,
  from: string | null,
  node: SyntaxNode | null,
  type: PendingReference['type'],
  excluded: string[] = [],
) => {
  if (!from || !node) return
  const names = topIdentifiers(node).filter((name) => !excluded.includes(name))
  if (names.length) {
    context.pendingReferences.push({
      from,
      names: [...new Set(names)],
      type,
      range: rangeFor(node, context.entryFile),
    })
  }
}

const mapCalls = (context: MappingContext, node: SyntaxNode, parentId: string | null) => {
  const calls = node.descendantsOfType('call_expression')
  if (node.type === 'call_expression') calls.unshift(node)
  const seen = new Set<number>()
  for (const call of calls) {
    if (seen.has(call.id)) continue
    seen.add(call.id)
    const callee = field(call, 'function')
    const args = field(call, 'arguments')
    const functionName = callee?.type === 'identifier' ? callee.text : compact(callee?.text ?? '间接调用')
    const callId = addNode(
      context,
      call,
      parentId,
      'call',
      compact(call.text),
      {
        functionName,
        arguments: args?.namedChildren.map((argument) => compact(argument.text)) ?? [],
      },
      functionName,
      functionName,
    )
    addAccess(context, callId, args, 'reads')
    if (callee?.type !== 'identifier') addAccess(context, callId, callee, 'reads')
  }
}

function mapDeclaration(context: MappingContext, node: SyntaxNode, parentId: string | null) {
  const dataType = declarationType(node)
  const declarators = node.namedChildren.filter((child) =>
    child.type === 'init_declarator' || /declarator$/.test(child.type),
  )
  const targets = declarators.length ? declarators : [node]

  for (const target of targets) {
    const declarator = field(target, 'declarator') ?? target
    const functionDeclarator = target.type === 'function_declarator'
      ? target
      : target.descendantsOfType('function_declarator')[0] ?? (
          declarator.type === 'function_declarator' ? declarator : undefined
        )
    if (functionDeclarator && field(functionDeclarator, 'declarator')?.type === 'identifier') {
      const name = declaratorName(functionDeclarator) ?? 'anonymous'
      const functionId = addNode(
        context,
        target,
        parentId,
        'function',
        `${name}()（声明）`,
        { returnType: dataType, isDefinition: false, storageClass: storageClass(node) },
        name,
        name,
      )
      const parameters = field(functionDeclarator, 'parameters')
      parameters?.namedChildren
        .filter((child) => child.type === 'parameter_declaration')
        .forEach((parameter, index) => mapParameter(context, parameter, functionId!, index))
      continue
    }
    const name = declaratorName(declarator)
    if (!name) continue
    const dimensions = dimensionsOf(declarator)
    const value = field(target, 'value')
    const variableId = addNode(
      context,
      target,
      parentId,
      'variable',
      compact(`${dataType ?? ''} ${target.text}`),
      {
        dataType,
        isArray: dimensions.length > 0,
        dimensions,
        initialValue: value ? compact(value.text) : undefined,
        storageClass: storageClass(node),
      },
      name,
      name,
    )
    addAccess(context, variableId, value, 'reads')
    if (value) mapCalls(context, value, variableId)
  }
}

function mapParameter(context: MappingContext, node: SyntaxNode, parentId: string, position: number) {
  const declarator = field(node, 'declarator')
  const name = declaratorName(declarator)
  if (!name) return
  addNode(
    context,
    node,
    parentId,
    'parameter',
    compact(node.text),
    { dataType: declarationType(node), position },
    name,
    name,
  )
}

function mapAssignment(context: MappingContext, node: SyntaxNode, parentId: string | null) {
  const target = field(node, 'left') ?? field(node, 'argument') ?? node.namedChildren[0] ?? null
  const value = field(node, 'right') ?? field(node, 'value') ?? null
  const operatorNode = node.children.find((child) =>
    ['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=', '++', '--'].includes(child.type),
  )
  const operator = operatorNode?.type ?? (node.type === 'update_expression' ? '++/--' : '=')
  const assignmentId = addNode(
    context,
    node,
    parentId,
    'assignment',
    compact(node.text),
    { operator, target: compact(target?.text ?? ''), expression: value ? compact(value.text) : undefined },
    undefined,
    `${target?.text ?? 'value'}:${operator}`,
  )
  addAccess(context, assignmentId, target, 'writes')
  if (operator !== '=') addAccess(context, assignmentId, target, 'reads')
  addAccess(context, assignmentId, value, 'reads')
  mapCalls(context, node, assignmentId)
}

function mapStatement(context: MappingContext, node: SyntaxNode, parentId: string | null): void {
  if (context.truncated) return
  switch (node.type) {
    case 'function_definition': {
      const declarator = field(node, 'declarator')
      const name = declaratorName(declarator) ?? 'anonymous'
      const body = field(node, 'body')
      const functionId = addNode(
        context,
        node,
        parentId,
        'function',
        `${name}()`,
        { returnType: declarationType(node), isDefinition: Boolean(body), storageClass: storageClass(node) },
        name,
        name,
      )
      if (!functionId) return
      const parameterList = declarator?.descendantsOfType('parameter_list')[0]
      parameterList?.namedChildren
        .filter((child) => child.type === 'parameter_declaration')
        .forEach((parameter, index) => mapParameter(context, parameter, functionId, index))
      if (body) mapStatement(context, body, functionId)
      return
    }
    case 'declaration':
      mapDeclaration(context, node, parentId)
      return
    case 'compound_statement': {
      const parent = parentId ? context.nodes.find((item) => item.id === parentId) : undefined
      const blockType = parent?.kind === 'function'
        ? 'function'
        : parent?.kind === 'loop'
          ? 'loop'
          : parent?.kind === 'condition' || parent?.kind === 'branch'
            ? 'condition'
            : 'standalone'
      const blockId = addNode(context, node, parentId, 'block', '代码块', { blockType }, undefined, blockType)
      node.namedChildren.forEach((child) => mapStatement(context, child, blockId))
      return
    }
    case 'for_statement':
    case 'while_statement':
    case 'do_statement': {
      const loopType = node.type === 'for_statement' ? 'for' : node.type === 'while_statement' ? 'while' : 'do_while'
      const condition = field(node, 'condition')
      const loopId = addNode(
        context,
        node,
        parentId,
        'loop',
        `${loopType === 'do_while' ? 'do…while' : loopType} (${compact(condition?.text ?? '', 45)})`,
        { loopType, condition: condition ? compact(condition.text) : undefined },
        undefined,
        `${loopType}:${compact(condition?.text ?? '', 35)}`,
      )
      addAccess(context, loopId, condition, 'reads')
      if (condition) mapCalls(context, condition, loopId)
      const loopNode = (loopId
        ? context.nodes.find((item) => item.id === loopId && item.kind === 'loop')
        : undefined) as CodeStructureNode<'loop'> | undefined
      const initializer = field(node, 'initializer')
      const beforeInitializer = loopNode?.children.length ?? 0
      if (initializer) mapStatement(context, initializer, loopId)
      if (loopNode) loopNode.details.initializerNodeIds = loopNode.children.slice(beforeInitializer)
      const update = field(node, 'update')
      const body = field(node, 'body')
      const beforeBody = loopNode?.children.length ?? 0
      if (body) mapStatement(context, body, loopId)
      if (loopNode) loopNode.details.bodyNodeIds = loopNode.children.slice(beforeBody)
      const beforeUpdate = loopNode?.children.length ?? 0
      if (update) mapStatement(context, update, loopId)
      if (loopNode) loopNode.details.updateNodeIds = loopNode.children.slice(beforeUpdate)
      return
    }
    case 'if_statement':
    case 'switch_statement': {
      const condition = field(node, 'condition')
      const conditionType: NodeDetailsByKind['condition']['conditionType'] =
        node.type.includes('switch') ? 'switch' : 'if'
      const conditionId = addNode(
        context,
        node,
        parentId,
        'condition',
        `${conditionType} (${compact(condition?.text ?? '', 48)})`,
        { conditionType, expression: condition ? compact(condition.text) : undefined },
        undefined,
        `${conditionType}:${compact(condition?.text ?? '', 35)}`,
      )
      addAccess(context, conditionId, condition, 'reads')
      if (condition) mapCalls(context, condition, conditionId)
      const consequence = field(node, 'consequence') ?? field(node, 'body')
      if (consequence) {
        if (conditionType === 'switch') {
          const statements = consequence.type === 'compound_statement'
            ? consequence.namedChildren
            : [consequence]
          statements.forEach((statement) => mapStatement(context, statement, conditionId))
        } else {
          const branchId = addNode(
            context,
            consequence,
            conditionId,
            'branch',
            '条件成立',
            { branchType: 'then' },
            undefined,
            'then',
          )
          mapStatement(context, consequence, branchId)
        }
      }
      const alternative = field(node, 'alternative')
      if (alternative) {
        const branchId = addNode(
          context,
          alternative,
          conditionId,
          'branch',
          alternative.type === 'if_statement' ? '否则继续判断' : '条件不成立',
          { branchType: 'else' },
          undefined,
          'else',
        )
        mapStatement(context, alternative, branchId)
      }
      return
    }
    case 'case_statement': {
      const value = field(node, 'value')
      const branchType = value ? 'case' : 'default'
      const branchId = addNode(
        context,
        node,
        parentId,
        'branch',
        value ? `case ${compact(value.text)}` : 'default',
        { branchType, caseValue: value?.text },
        undefined,
        value ? `case:${value.text}` : 'default',
      )
      node.namedChildren.filter((child) => child !== value).forEach((child) => mapStatement(context, child, branchId))
      return
    }
    case 'expression_statement': {
      node.namedChildren.forEach((child) => mapStatement(context, child, parentId))
      return
    }
    case 'assignment_expression':
    case 'update_expression':
      mapAssignment(context, node, parentId)
      return
    case 'call_expression':
      mapCalls(context, node, parentId)
      return
    case 'return_statement': {
      const expression = node.namedChildren[0] ?? null
      const returnId = addNode(
        context,
        node,
        parentId,
        'return',
        compact(node.text),
        { expression: expression ? compact(expression.text) : undefined },
        undefined,
        compact(expression?.text ?? 'void'),
      )
      addAccess(context, returnId, expression, 'reads')
      mapCalls(context, node, returnId)
      return
    }
    case 'break_statement':
    case 'continue_statement':
    case 'goto_statement': {
      const jumpType = node.type.replace('_statement', '') as 'break' | 'continue' | 'goto'
      const targetLabel = jumpType === 'goto' ? identifiers(node)[0] : undefined
      addNode(
        context,
        node,
        parentId,
        'jump',
        compact(node.text),
        { jumpType, targetLabel },
        targetLabel,
        `${jumpType}:${targetLabel ?? ''}`,
      )
      return
    }
    case 'labeled_statement': {
      const labelName = field(node, 'label')?.text ?? node.namedChildren[0]?.text ?? 'label'
      const labelId = addNode(
        context,
        node,
        parentId,
        'label',
        `${labelName}:`,
        { targetLabel: labelName },
        labelName,
        labelName,
      )
      const statement = field(node, 'statement') ?? node.namedChildren.at(-1)
      if (statement && statement.text !== labelName) mapStatement(context, statement, labelId)
      return
    }
    case 'type_definition':
    case 'struct_specifier':
    case 'union_specifier':
    case 'enum_specifier': {
      const kind = node.type === 'type_definition'
        ? 'typedef'
        : node.type.replace('_specifier', '') as 'struct' | 'union' | 'enum'
      const nameNode = field(node, 'name')
      const name = nameNode?.text ?? declaratorName(field(node, 'declarator')) ?? `anonymous_${kind}`
      const typeId = addNode(
        context,
        node,
        parentId,
        'type',
        `${kind} ${name}`,
        { typeKind: kind, aliasedType: node.type === 'type_definition' ? declarationType(node) : undefined },
        name,
        name,
      )
      const fields = node.descendantsOfType('field_declaration')
      for (const member of fields) {
        const declarator = field(member, 'declarator') ?? member.namedChildren.at(-1) ?? null
        const memberName = declaratorName(declarator)
        if (!memberName) continue
        const dimensions = dimensionsOf(declarator)
        addNode(
          context,
          member,
          typeId,
          'member',
          compact(member.text),
          { dataType: declarationType(member), isArray: dimensions.length > 0, dimensions },
          memberName,
          memberName,
        )
      }
      for (const enumerator of node.descendantsOfType('enumerator')) {
        const memberName = field(enumerator, 'name')?.text ?? enumerator.namedChildren[0]?.text
        if (!memberName) continue
        addNode(
          context,
          enumerator,
          typeId,
          'member',
          compact(enumerator.text),
          { dataType: 'enum value', isArray: false, dimensions: [] },
          memberName,
          memberName,
        )
      }
      return
    }
    case 'ERROR': {
      const recoveredDeclarator = node.descendantsOfType('function_declarator')[0]
      if (recoveredDeclarator && !parentId?.includes(':function:')) {
        const name = declaratorName(recoveredDeclarator) ?? 'incomplete_function'
        const functionId = addNode(
          context,
          node,
          parentId,
          'function',
          `${name}()（未完成）`,
          { returnType: declarationType(node), isDefinition: true },
          name,
          name,
        )
        const parameters = field(recoveredDeclarator, 'parameters')
        parameters?.namedChildren
          .filter((child) => child.type === 'parameter_declaration')
          .forEach((parameter, index) => mapParameter(context, parameter, functionId!, index))
        node.namedChildren
          .filter((child) => child !== recoveredDeclarator && child.type !== 'primitive_type')
          .forEach((child) => mapStatement(context, child, functionId))
        return
      }
      node.namedChildren.forEach((child) => mapStatement(context, child, parentId))
      return
    }
    default:
      if (node.type.startsWith('preproc_')) {
        const rawDirective = node.type.replace('preproc_', '')
        const textDirective = node.text.match(/^\s*#\s*([A-Za-z_]+)/)?.[1]
        const directive = rawDirective === 'def' || rawDirective === 'function_def'
          ? 'define'
          : textDirective ?? rawDirective
        const directiveType = (
          ['include', 'define', 'undef', 'if', 'ifdef', 'ifndef', 'elif', 'else', 'endif', 'pragma'].includes(directive)
            ? directive
            : 'other'
        ) as NodeDetailsByKind['preprocessor']['directiveType']
        const preprocessorId = addNode(
          context,
          node,
          parentId,
          'preprocessor',
          compact(node.text),
          { directiveType, value: compact(node.text) },
          undefined,
          compact(node.text, 50),
        )
        if (directiveType === 'include' && preprocessorId) {
          const target = compact(node.namedChildren.at(-1)?.text ?? node.text.replace(/^\s*#\s*include\s*/, ''))
          context.relations.push({
            id: `relation:${context.relationCount++}`,
            type: 'includes',
            from: preprocessorId,
            to: null,
            targetName: target,
            resolved: false,
            location: rangeFor(node, context.entryFile),
          })
        }
        if (preprocessorId) {
          node.namedChildren
            .filter((child) =>
              child.type === 'declaration' ||
              child.type === 'function_definition' ||
              child.type.startsWith('preproc_'),
            )
            .forEach((child) => mapStatement(context, child, preprocessorId))
        }
        return
      }
      node.namedChildren.forEach((child) => mapStatement(context, child, parentId))
  }
}

const ancestorsOf = (nodesById: Map<string, AnyCodeStructureNode>, id: string) => {
  const result: string[] = []
  let current = nodesById.get(id)
  while (current?.parentId) {
    result.push(current.parentId)
    current = nodesById.get(current.parentId)
  }
  return result
}

function resolveRelations(context: MappingContext) {
  const nodesById = new Map(context.nodes.map((node) => [node.id, node]))
  const functionsByName = new Map<string, string>()
  const functionNodes = context.nodes.filter(
    (item) => item.kind === 'function' && item.name,
  ) as CodeStructureNode<'function'>[]
  for (const node of functionNodes) {
    const existing = functionsByName.get(node.name!)
    const existingNode = existing ? nodesById.get(existing) : undefined
    if (
      !existingNode ||
      (node.details.isDefinition && existingNode.kind === 'function' && !existingNode.details.isDefinition)
    ) {
      functionsByName.set(node.name!, node.id)
    }
  }
  const variables = context.nodes.filter((node) =>
    (node.kind === 'variable' || node.kind === 'parameter') && node.name,
  )

  for (const call of context.nodes.filter((node) => node.kind === 'call')) {
    const targetName = call.details.functionName
    const target = functionsByName.get(targetName)
    context.relations.push({
      id: `relation:${context.relationCount++}`,
      type: 'calls',
      from: call.id,
      to: target ?? null,
      targetName,
      resolved: Boolean(target),
      location: call.range,
    } as CodeRelation)
  }

  for (const pending of context.pendingReferences) {
    const from = nodesById.get(pending.from)
    if (!from) continue
    const ancestors = new Set([from.id, ...ancestorsOf(nodesById, from.id)])
    for (const name of pending.names) {
      const candidates = variables.filter((candidate) => {
        if (candidate.name !== name) return false
        if ((candidate.range.start.line > pending.range.start.line) && candidate.kind !== 'parameter') return false
        return candidate.parentId ? ancestors.has(candidate.parentId) : true
      })
      const target = candidates.sort((a, b) => {
        const aDepth = ancestorsOf(nodesById, a.id).length
        const bDepth = ancestorsOf(nodesById, b.id).length
        return bDepth - aDepth || b.range.start.line - a.range.start.line
      })[0]
      if (!target) continue
      context.relations.push({
        id: `relation:${context.relationCount++}`,
        type: pending.type,
        from: pending.from,
        to: target.id,
        targetName: name,
        resolved: true,
        location: pending.range,
      })
    }
  }

  const knownTypes = context.nodes.filter((node) => node.kind === 'type' && node.name)
  for (const node of context.nodes.filter((item) => item.kind === 'variable' || item.kind === 'parameter' || item.kind === 'member' || item.kind === 'function')) {
    const dataType = 'dataType' in node.details
      ? node.details.dataType
      : node.kind === 'function'
        ? node.details.returnType
        : undefined
    if (!dataType) continue
    const target = knownTypes.find((type) => type.name && dataType.includes(type.name))
    if (!target) continue
    context.relations.push({
      id: `relation:${context.relationCount++}`,
      type: 'uses_type',
      from: node.id,
      to: target.id,
      targetName: target.name,
      resolved: true,
      location: node.range,
    })
  }
}

function collectSyntaxDiagnostics(root: SyntaxNode, entryFile: string) {
  const diagnostics: StructureDiagnostic[] = []
  const visit = (node: SyntaxNode) => {
    if (node.isError || node.isMissing) {
      diagnostics.push({
        severity: 'warning',
        code: node.isMissing ? 'MISSING_SYNTAX' : 'SYNTAX_ERROR',
        message: node.isMissing ? `缺少 ${node.type}` : '代码包含尚未完成或无法识别的语法。',
        range: rangeFor(node, entryFile),
      })
    }
    node.namedChildren.forEach(visit)
  }
  visit(root)
  return diagnostics
}

export function mapCCodeStructure(root: SyntaxNode, source: string, entryFile = 'main.c'): CodeStructure {
  const context: MappingContext = {
    entryFile,
    source,
    nodes: [],
    relations: [],
    diagnostics: collectSyntaxDiagnostics(root, entryFile),
    stableCounts: new Map(),
    relationCount: 0,
    pendingReferences: [],
    truncated: false,
  }
  const fileId = addNode(
    context,
    root,
    null,
    'file',
    entryFile,
    { path: entryFile },
    entryFile,
    entryFile,
  )
  root.namedChildren.forEach((child) => mapStatement(context, child, fileId))
  resolveRelations(context)

  const nodeCounts: CodeStructure['summary']['nodeCounts'] = {}
  context.nodes.forEach((node) => {
    nodeCounts[node.kind] = (nodeCounts[node.kind] ?? 0) + 1
  })
  return {
    schemaVersion: '1.0',
    analysisId: `tree-sitter:${entryFile}:${Date.now()}`,
    status: context.diagnostics.some((diagnostic) => diagnostic.code === 'SYNTAX_ERROR' || diagnostic.code === 'MISSING_SYNTAX')
      ? 'partial'
      : 'completed',
    provider: 'tree-sitter',
    providerVersion: '0.26.13/c-0.24.1',
    source: { entryFile, files: [entryFile], language: 'c' },
    nodes: context.nodes,
    relations: context.relations,
    diagnostics: context.diagnostics,
    summary: {
      totalNodes: context.nodes.length,
      totalRelations: context.relations.length,
      nodeCounts,
    },
  }
}
