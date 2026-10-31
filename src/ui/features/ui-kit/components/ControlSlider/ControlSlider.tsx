import { useDraggedValue } from '../../systems/useDraggedValue'
import styles from './ControlSlider.module.css'

type ControlSliderProps = {
  readonly 'data-testid'?: string
  readonly disabled?: boolean
  readonly label: string
  readonly max?: number
  readonly min?: number
  readonly onChange: (value: number) => void
  readonly onCommit?: (value: number) => void
  readonly step?: number
  readonly value: number
  readonly format?: (value: number) => string
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function ControlSlider({
  'data-testid': testId,
  disabled = false,
  format = percent,
  label,
  max = 1,
  min = 0,
  onChange,
  onCommit,
  step = 0.05,
  value,
}: ControlSliderProps) {
  const dragged = useDraggedValue({ value, onChange, onCommit })
  const shown = dragged.shown
  const span = max - min
  const fill = span > 0 ? ((shown - min) / span) * 100 : 0

  return (
    <label className={styles.row}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <input
        aria-label={label}
        className={styles.input}
        data-testid={testId}
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => dragged.change(Number(event.target.value))}
        onKeyUp={(event) => dragged.commit(Number(event.currentTarget.value))}
        onPointerDown={dragged.press}
        onPointerUp={(event) => dragged.commit(Number(event.currentTarget.value))}
        step={step}
        style={{ '--fill': `${fill}%` } as React.CSSProperties}
        type="range"
        value={shown}
      />
      <output className={styles.value}>{format(shown)}</output>
    </label>
  )
}
