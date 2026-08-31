# Unified visualization interface

The frontend visualization layer consumes one in-memory contract instead of
reading raw Tree-sitter or GDB output independently in every component.

```text
CodeStructure + FlowGraph + ProgramMap
                    |
Trace v1.2 -> ExecutionCursor history
                    |
                    v
          VisualizationContext
             |           |
      VisualizationScope  VisualizationActions
             |           |
             +----- visualization registry -----+
```

## Five visualization categories

| Category | Responsibility |
|---|---|
| `architecture` | Program map, functions, modules and call relationships |
| `data-flow` | Control flow, reads, writes, calls and parameter movement |
| `runtime-state` | Live variables, changes and pointer state |
| `memory` | Stack, globals, heap objects, lifetimes and pointer edges |
| `algorithm` | Event-driven array, matrix, graph and other focused views |

The category is descriptive. A module decides whether it can render the
current data through its `supports(context, scope)` function.

## Context

`VisualizationContext` is a read-only snapshot of the current UI state:

- `source` contains the current editor code and entry filename.
- `static` contains Tree-sitter structure, the teaching program map and flow
  graphs.
- `execution` contains the current and previous cursor, cursor history and run
  status.
- `selection` contains the objects explicitly selected by the learner.
- `teaching` contains beginner/advanced mode and a deterministic explanation
  of the current step.
- `presentation` contains display behavior such as following execution.

It is assembled by `buildVisualizationContext`. Visualization components must
not mutate it or parse GDB output themselves.

## Scope

Every window receives a `VisualizationScope`: program, function, teaching
module, variable or memory object. This permits several nested algorithms or
several arrays to be inspected in separate windows without creating a separate
component type for every case.

## Actions

Components communicate through `VisualizationActions`. Selecting a source
node, variable or memory object updates shared selection state so Monaco,
memory, runtime and algorithm views can respond together. Components never
reach into another component directly.

The floating workspace is shared by runtime and structure views. Its registry
currently includes call graphs, function flow graphs and a singleton variable
inspector. The variable inspector groups values by stack frame and derives
read/write/declaration state and a 20-step history exclusively from
`ExecutionCursor`; it never parses raw event payloads.

## Teaching facts

`ExecutionCursor.facts` is the deterministic bridge between raw state and
teaching visuals. Its interface covers comparisons, variable/array/pointer
access, assignments, swaps, calls, returns, branches, allocations,
deallocations and recursion. Facts may be observed from Trace or derived from
Trace plus CodeStructure. No Agent is required to create runtime facts.

`buildSemanticFacts()` owns this conversion. Current-line operations use
`location`; effects that have just happened use `executedLocation`. Every Fact
has a stable ID, source location, origin, related variables and related memory
objects. The teaching-step adapter consumes these standard Facts rather than
reading raw event payloads. More teaching templates can therefore be added
without changing Trace producers or visualization modules.
