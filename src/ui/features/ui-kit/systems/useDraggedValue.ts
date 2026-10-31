import { useEffect, useRef, useState } from 'react'

const SETTLE_AFTER_RELEASE_MS = 500

type DraggedValueOptions<T> = {
  readonly value: T
  readonly onChange: (value: T) => void
  readonly onCommit?: (value: T) => void
  readonly onCancel?: () => void
}

function useOncePerFrame<T>(send: (value: T) => void) {
  const latest = useRef(send)
  latest.current = send
  const pending = useRef<{ value: T } | null>(null)
  const frame = useRef(0)
  const flush = () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const next = pending.current
    pending.current = null
    if (next) latest.current(next.value)
  }
  const schedule = (value: T) => {
    pending.current = { value }
    if (!frame.current) frame.current = requestAnimationFrame(flush)
  }
  const drop = () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    pending.current = null
  }
  return { schedule, flush, drop }
}

export function useDraggedValue<T>({ value, onChange, onCommit, onCancel }: DraggedValueOptions<T>) {
  const [held, setHeld] = useState<{ value: T } | null>(null)
  const pressed = useRef(false)
  const send = useOncePerFrame(onChange)
  useEffect(() => {
    if (!pressed.current) setHeld(null)
  }, [value])
  const settle = () => {
    pressed.current = false
    setTimeout(() => {
      if (!pressed.current) setHeld(null)
    }, SETTLE_AFTER_RELEASE_MS)
  }
  return {
    shown: held ? held.value : value,
    press: () => {
      pressed.current = true
    },
    change: (next: T) => {
      setHeld({ value: next })
      send.schedule(next)
    },
    commit: (next: T) => {
      send.flush()
      settle()
      onCommit?.(next)
    },
    cancel: () => {
      send.drop()
      pressed.current = false
      setHeld(null)
      onCancel?.()
    },
  }
}
