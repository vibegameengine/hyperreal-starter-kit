import { useEffect, useRef, useState, type RefObject } from 'react'

import { onGameMessage, post } from '../bridge'
import { ControlButton, ControlChoice, ControlDropdown, ControlNumber, ControlPanel, ControlSlider, ControlText } from '../features/ui-kit'
import styles from './EditPropCard.module.css'

type PropPath = (string | number)[]

type CardRow = {
  path: PropPath
  label: string
  depth: number
  kind: 'number' | 'range' | 'boolean' | 'select' | 'text' | 'vector' | 'group'
  value?: unknown
  min?: number
  max?: number
  step?: number
  options?: { id: string; label: string }[]
  writable: boolean
  reason?: string
  description?: string
  live?: boolean
  added?: boolean
  entry?: boolean
  entries?: { key: string; live: boolean; added: boolean }[]
}

type PropCard = {
  title: string
  level: number
  levels: { index: number; tag: string; file: string; line: number }[]
  rows: CardRow[]
}

type CardPlace = { anchor?: [number, number]; span?: [number, number]; viewportWidth?: number }

const CARD_WIDTH = 280
const CARD_GAP = 32
const EDGE = 12
const AXES = 'XYZW'

const send = (path: PropPath, value: unknown, phase: 'preview' | 'commit' | 'cancel') => post({ type: 'edit/prop', path, value, phase })
const testIdOf = (path: PropPath) => `edit-prop-${path.join('-')}`

const rowKey = (row: CardRow) => row.path.join('.')

function keepUnchangedRows(previous: PropCard | null, next: PropCard | null): PropCard | null {
  if (!previous || !next) return next
  const before = new Map(previous.rows.map((row) => [rowKey(row), row]))
  const rows = next.rows.map((row) => {
    const kept = before.get(rowKey(row))
    return kept && sameValue(kept, row) ? kept : row
  })
  return { ...next, rows }
}

function useCard() {
  const [card, setCard] = useState<PropCard | null>(null)
  useEffect(() => {
    const stop = onGameMessage((incoming) => {
      if (incoming.type === 'edit/card') setCard((previous) => keepUnchangedRows(previous, (incoming.card as PropCard | null) ?? null))
    })
    return () => {
      stop()
    }
  }, [])
  return card
}

function usePlacement(element: RefObject<HTMLDivElement | null>, shown: boolean) {
  const place = useRef<CardPlace>({})
  useEffect(() => {
    const apply = () => {
      if (element.current) element.current.style.left = `${leftOf(place.current)}px`
    }
    apply()
    const stop = onGameMessage((incoming) => {
      if (incoming.type !== 'edit/card-place') return
      place.current = incoming as unknown as CardPlace
      apply()
    })
    return () => {
      stop()
    }
  }, [element, shown])
}

function leftOf({ anchor, span, viewportWidth }: CardPlace) {
  const scale = viewportWidth ? window.innerWidth / viewportWidth : 1
  const [left, right] = span ?? (anchor ? [anchor[0], anchor[0]] : [window.innerWidth, window.innerWidth])
  const besideRight = right * scale + CARD_GAP
  if (besideRight + CARD_WIDTH + EDGE <= window.innerWidth) return besideRight
  const besideLeft = left * scale - CARD_GAP - CARD_WIDTH
  if (besideLeft >= EDGE) return besideLeft
  return window.innerWidth - CARD_WIDTH - EDGE
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function VectorRow({ row }: { readonly row: CardRow }) {
  const values = row.value as number[]
  const changed = (index: number, next: number) => values.map((value, at) => (at === index ? next : value))
  return (
    <div className={styles.vector}>
      {values.map((value, index) => (
        <ControlNumber
          data-testid={`${testIdOf(row.path)}-${index}`}
          disabled={!row.writable}
          key={index}
          label={AXES[index]}
          onCancel={() => send(row.path, values, 'cancel')}
          onChange={(next) => send(row.path, changed(index, next), 'preview')}
          onCommit={(next) => send(row.path, changed(index, next), 'commit')}
          step={row.step ?? 1}
          value={value}
        />
      ))}
    </div>
  )
}

function LeafControl({ row }: { readonly row: CardRow }) {
  const testId = testIdOf(row.path)
  if (row.kind === 'range') {
    return (
      <ControlSlider
        data-testid={testId}
        disabled={!row.writable}
        format={(value) => String(Math.round(value * 1000) / 1000)}
        label=""
        max={row.max}
        min={row.min}
        onChange={(value) => send(row.path, value, 'preview')}
        onCommit={(value) => send(row.path, value, 'commit')}
        step={row.step ?? ((row.max ?? 1) - (row.min ?? 0)) / 100}
        value={row.value as number}
      />
    )
  }
  if (row.kind === 'number') {
    return (
      <ControlNumber
        data-testid={testId}
        disabled={!row.writable}
        max={row.max}
        min={row.min}
        onCancel={() => send(row.path, row.value, 'cancel')}
        onChange={(value) => send(row.path, value, 'preview')}
        onCommit={(value) => send(row.path, value, 'commit')}
        step={row.step}
        value={row.value as number}
      />
    )
  }
  if (row.kind === 'boolean') {
    return (
      <ControlButton active={row.value === true} data-testid={testId} disabled={!row.writable} onClick={() => send(row.path, row.value !== true, 'commit')}>
        {row.value ? 'On' : 'Off'}
      </ControlButton>
    )
  }
  if (row.kind === 'select') {
    return <ControlChoice activeId={String(row.value)} label={row.label} onSelect={(id) => send(row.path, id, 'commit')} options={row.options ?? []} testIdPrefix={testId} />
  }
  if (row.kind === 'text') return <ControlText data-testid={testId} disabled={!row.writable} onCommit={(value) => send(row.path, value, 'commit')} value={String(row.value)} />
  return <VectorRow row={row} />
}

type Chosen = Readonly<Record<string, string>>

const chosenEntryOf = (row: CardRow, chosen: Chosen) => {
  const entries = row.entries ?? []
  const picked = chosen[rowKey(row)]
  return entries.some((entry) => entry.key === picked) ? picked : (entries.find((entry) => entry.live) ?? entries[0])?.key
}

function visibleRows(rows: readonly CardRow[], chosen: Chosen) {
  const shownEntries = rows.flatMap((row) => (row.entries ? [{ path: row.path, key: chosenEntryOf(row, chosen) }] : []))
  return rows.filter((row) =>
    shownEntries.every(({ path, key }) => {
      const inside = row.path.length > path.length && path.every((part, index) => row.path[index] === part)
      return !inside || (row.path[path.length] === key && !row.entry)
    }),
  )
}

function DictionaryRow({ row, chosen, choose }: { readonly row: CardRow; readonly chosen: Chosen; readonly choose: (row: CardRow, key: string) => void }) {
  const options = (row.entries ?? []).map((entry) => ({ id: entry.key, label: entry.key, accent: entry.live, note: entry.live ? 'playing now' : entry.added ? 'default' : undefined }))
  return (
    <div className={styles.row} style={{ paddingLeft: `${row.depth * 10}px` }} title={row.description}>
      <span className={styles.label}>{row.label}</span>
      <div className={styles.control}>
        <ControlDropdown data-testid={`${testIdOf(row.path)}-entry`} label={row.label} onSelect={(key) => choose(row, key)} options={options} selectedId={chosenEntryOf(row, chosen)} />
      </div>
    </div>
  )
}

function Row({ row }: { readonly row: CardRow }) {
  const indent = { paddingLeft: `${row.depth * 10}px` }
  if (row.kind === 'group') {
    return (
      <div className={row.live ? styles.liveGroup : styles.group} data-testid={`${testIdOf(row.path)}-group`} style={indent} title={row.description}>
        <span>{row.label}</span>
        {row.live || row.added ? <output>{[row.live ? 'playing now' : '', row.added ? 'uses the value above' : ''].filter(Boolean).join(', ')}</output> : null}
      </div>
    )
  }
  return (
    <div className={styles.row} style={indent} title={row.writable ? row.description : row.reason}>
      <span className={styles.label}>{row.label}</span>
      <div className={styles.control}>
        <LeafControl row={row} />
      </div>
    </div>
  )
}

export function EditPropCard() {
  const card = useCard()
  const [chosen, setChosen] = useState<Chosen>({})
  const choose = (row: CardRow, key: string) => setChosen((current) => ({ ...current, [rowKey(row)]: key }))
  const element = useRef<HTMLDivElement>(null)
  usePlacement(element, card !== null)
  if (!card) return null
  const levels = card.levels.map((level) => ({ id: String(level.index), label: level.tag }))
  return (
    <div className={styles.card} data-hit data-testid="edit-prop-card" ref={element} style={{ width: CARD_WIDTH }}>
      <ControlPanel title={card.title}>
        {levels.length > 1 ? (
          <ControlChoice activeId={String(card.level)} label="Component" onSelect={(id) => post({ type: 'edit/level', level: Number(id) })} options={levels} testIdPrefix="edit-prop-level" />
        ) : null}
        <div className={styles.rows}>
          {card.rows.length ? visibleRows(card.rows, chosen).map((row) => (row.entries ? <DictionaryRow choose={choose} chosen={chosen} key={rowKey(row)} row={row} /> : <Row key={rowKey(row)} row={row} />)) : <p className={styles.empty}>No editable props</p>}
        </div>
      </ControlPanel>
    </div>
  )
}
