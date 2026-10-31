import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import { useDraggedValue } from '../../systems/useDraggedValue'
import styles from './ControlNumber.module.css'

type ControlNumberProps = {
  readonly 'data-testid'?: string
  readonly disabled?: boolean
  readonly label?: string
  readonly max?: number
  readonly min?: number
  readonly onCancel?: () => void
  readonly onChange: (value: number) => void
  readonly onCommit?: (value: number) => void
  readonly step?: number
  readonly title?: string
  readonly value: number
}

const DRAG_THRESHOLD_PX = 3
const PRECISION_FACTOR = 0.1
const DEFAULT_STEP = 0.1

const clamp = (value: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value))
const format = (value: number) => String(Math.round(value * 1000) / 1000)

type Drag = { startX: number; startValue: number; value: number; moved: boolean }

type ScrubOptions = {
  readonly enabled: boolean
  readonly onPress: () => void
  readonly max?: number
  readonly min?: number
  readonly onChange: (value: number) => void
  readonly onClick: () => void
  readonly onCommit?: (value: number) => void
  readonly step: number
  readonly value: number
}

function useScrub({ enabled, max, min, onChange, onClick, onCommit, onPress, step, value }: ScrubOptions) {
  const drag = useRef<Drag | null>(null)
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    onPress()
    drag.current = { startX: event.clientX, startValue: value, value, moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    const distance = event.clientX - current.startX
    if (!current.moved && Math.abs(distance) < DRAG_THRESHOLD_PX) return
    current.moved = true
    const perPixel = step * (event.shiftKey ? PRECISION_FACTOR : 1)
    current.value = clamp(Math.round((current.startValue + distance * perPixel) / perPixel) * perPixel, min, max)
    onChange(current.value)
  }
  const onPointerUp = () => {
    const current = drag.current
    drag.current = null
    if (current?.moved) onCommit?.(current.value)
    else if (current) onClick()
  }
  return { onPointerDown, onPointerMove, onPointerUp }
}

export function ControlNumber({
  'data-testid': testId,
  disabled = false,
  label,
  max,
  min,
  onCancel,
  onChange,
  onCommit,
  step = DEFAULT_STEP,
  title,
  value,
}: ControlNumberProps) {
  const input = useRef<HTMLInputElement>(null)
  const [typing, setTyping] = useState<string | null>(null)
  const dragged = useDraggedValue({ value, onChange, onCommit, onCancel })
  const startTyping = () => {
    setTyping(format(dragged.shown))
    requestAnimationFrame(() => input.current?.select())
  }
  const scrub = useScrub({ enabled: !disabled && typing === null, max, min, onChange: dragged.change, onClick: startTyping, onCommit: dragged.commit, onPress: dragged.press, step, value: dragged.shown })

  const finishTyping = (commit: boolean) => {
    const typed = typing === null ? Number.NaN : Number(typing)
    setTyping(null)
    if (commit && Number.isFinite(typed)) {
      const next = clamp(typed, min, max)
      dragged.change(next)
      dragged.commit(next)
    } else if (!commit) dragged.cancel()
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') finishTyping(true)
    if (event.key === 'Escape') finishTyping(false)
  }

  return (
    <div
      aria-disabled={disabled}
      className={styles.field}
      data-testid={testId}
      {...scrub}
      title={title}
    >
      {label ? <span className={styles.label}>{label}</span> : null}
      {typing === null ? (
        <output className={styles.value}>{format(dragged.shown)}</output>
      ) : (
        <input
          aria-label={label}
          className={styles.input}
          data-testid={testId ? `${testId}-input` : undefined}
          onBlur={() => finishTyping(true)}
          onChange={(event) => setTyping(event.target.value)}
          onKeyDown={keyDown}
          ref={input}
          value={typing}
        />
      )}
    </div>
  )
}
