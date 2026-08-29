import type { TraceStep, TraceVariable } from '../../types/trace'

interface ArrayVisualizerProps {
  step: TraceStep
  previousStep?: TraceStep
}

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every((item) => typeof item === 'number' && Number.isFinite(item))

const findArray = (step?: TraceStep, name?: string): TraceVariable | undefined =>
  step?.state.variables.find(
    (variable) =>
      isNumberArray(variable.value) && (name === undefined || variable.name === name),
  )

export function ArrayVisualizer({ step, previousStep }: ArrayVisualizerProps) {
  const isWaitingForInitialization =
    step.event.type === 'function_enter' && step.event.data.initial === true
  if (isWaitingForInitialization) return null

  const variable = findArray(step)
  if (!variable || !isNumberArray(variable.value)) return null

  const values = variable.value
  const previousVariable = findArray(previousStep, variable.name)
  const previousValues = isNumberArray(previousVariable?.value)
    ? previousVariable.value
    : undefined
  const changedIndices = new Set(
    values.flatMap((value, index) =>
      previousValues && previousValues[index] !== value ? [index] : [],
    ),
  )
  const largestMagnitude = Math.max(...values.map((value) => Math.abs(value)), 1)

  return (
    <section
      className="visual-section array-visualizer"
      aria-label={`${variable.name} 数组柱状图`}
    >
      <div className="array-heading">
        <div>
          <div className="section-label">数组柱状图</div>
          <strong>{variable.name}</strong>
        </div>
        <span>{values.length} 个元素</span>
      </div>

      <div
        className="array-chart"
        role="img"
        aria-label={`${variable.name}: ${values.join(', ')}`}
      >
        {values.map((value, index) => {
          const height = 24 + (Math.abs(value) / largestMagnitude) * 100
          const changed = changedIndices.has(index)
          return (
            <div className="array-column" key={index}>
              <span className={`array-value${changed ? ' changed' : ''}`}>
                {value}
              </span>
              <div
                className={`array-bar${changed ? ' changed' : ''}`}
                style={{ height: `${height}px` }}
                title={`${variable.name}[${index}] = ${value}`}
              />
              <span className="array-index">[{index}]</span>
            </div>
          )
        })}
      </div>

      <div className="array-legend">
        <span><i className="legend-current" />当前值</span>
        <span><i className="legend-changed" />本步发生变化</span>
      </div>
    </section>
  )
}
