import { useState, type KeyboardEvent } from 'react'

import styles from './ControlText.module.css'

type ControlTextProps = {
  readonly 'data-testid'?: string
  readonly disabled?: boolean
  readonly label?: string
  readonly onCommit: (value: string) => void
  readonly title?: string
  readonly value: string
}

export function ControlText({ 'data-testid': testId, disabled = false, label, onCommit, title, value }: ControlTextProps) {
  const [typing, setTyping] = useState<string | null>(null)
  const finish = (commit: boolean) => {
    if (typing === null) return
    if (commit && typing !== value) onCommit(typing)
    setTyping(null)
  }
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') finish(true)
    if (event.key === 'Escape') setTyping(null)
  }
  return (
    <label className={styles.field} title={title}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <input
        aria-label={label}
        className={styles.input}
        data-testid={testId}
        disabled={disabled}
        onBlur={() => finish(true)}
        onChange={(event) => setTyping(event.target.value)}
        onKeyDown={keyDown}
        value={typing ?? value}
      />
    </label>
  )
}
