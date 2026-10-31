import { useEffect, useRef, useState } from 'react'

import styles from './ControlDropdown.module.css'

export type ControlDropdownOption = Readonly<{
  id: string
  label: string
  note?: string
  accent?: boolean
}>

type ControlDropdownProps = {
  readonly 'data-testid'?: string
  readonly disabled?: boolean
  readonly label: string
  readonly onSelect: (id: string) => void
  readonly options: readonly ControlDropdownOption[]
  readonly selectedId: string | undefined
}

function useCloseOnOutsidePointer(open: boolean, close: () => void) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return undefined
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close()
    }
    window.addEventListener('pointerdown', onPointer, true)
    return () => window.removeEventListener('pointerdown', onPointer, true)
  }, [open, close])
  return root
}

export function ControlDropdown({ 'data-testid': testId = 'dropdown', disabled = false, label, onSelect, options, selectedId }: ControlDropdownProps) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)
  const root = useCloseOnOutsidePointer(open, close)
  const selected = options.find((option) => option.id === selectedId)
  return (
    <div className={styles.root} ref={root}>
      <button aria-expanded={open} aria-haspopup="listbox" aria-label={label} className={styles.button} data-testid={testId} disabled={disabled} onClick={() => setOpen(!open)} type="button">
        <span className={selected?.accent ? styles.accent : undefined}>{selected?.label ?? '—'}</span>
        {selected?.note ? <span className={styles.note}>{selected.note}</span> : null}
        <span className={styles.chevron}>{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <ul className={styles.list} role="listbox" aria-label={label}>
          {options.map((option) => (
            <li key={option.id}>
              <button
                aria-selected={option.id === selectedId}
                className={styles.option}
                data-testid={`${testId}-${option.id}`}
                onClick={() => {
                  onSelect(option.id)
                  close()
                }}
                role="option"
                type="button"
              >
                <span className={option.accent ? styles.accent : undefined}>{option.label}</span>
                {option.note ? <span className={styles.note}>{option.note}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
