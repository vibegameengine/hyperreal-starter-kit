import { post } from '../bridge'
import { ControlButton, ControlChoice, ControlPanel, ControlSlider } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { Readout } from './Readout'
import { useGameState } from './useGameState'

type Foot = { heel: number; ball: number; slide: number; planted: boolean }
type Violation = { kind: string; from: number; to: number; clip: string; clipTime: number; detail: string }
type MotionMatchingLabState = {
  mode: 'scenario' | 'drive' | 'clip'
  view: string
  paused: boolean
  timeScale: number
  timeScales: number[]
  t: number
  scenario: boolean
  step: string
  speed: number
  clip: string
  clipTime: number
  cost: number
  continuing: boolean
  playRate: number
  pelvis: number
  feet: Foot[]
  clips: string[]
  viewer: { clip: string; time: number; length: number; playing: boolean }
  segments: { clip: string; from: number; to: number }[]
  violations: Violation[]
}

const MODES = [
  { id: 'scenario', label: 'Scenario' },
  { id: 'drive', label: 'Drive' },
  { id: 'clip', label: 'One clip' },
]
const VIEWS = [
  { id: 'side', label: 'Side' },
  { id: 'front', label: 'Front' },
  { id: 'behind', label: 'Behind' },
  { id: 'top', label: 'Top' },
  { id: 'player', label: 'Player' },
]
const send = (type: string, fields: Record<string, unknown> = {}) => post({ type: `motionMatchingLab/${type}`, ...fields })
const seconds = (value: number) => `${value.toFixed(2)} s`
const footText = (foot: Foot | undefined) => (foot ? `${foot.planted ? 'down' : 'up'} · heel ${foot.heel} · ball ${foot.ball} · ${foot.slide} cm/s` : '—')

function Transport({ state }: { state: MotionMatchingLabState }) {
  return (
    <>
      <ControlChoice activeId={state.mode} label="Mode" onSelect={(mode) => send('mode', { mode })} options={MODES} testIdPrefix="motion-matching-mode" />
      <div className={styles.buttons}>
        <ControlButton data-testid="motion-matching-run" onClick={() => send('run')} variant="accent">
          Run scenario
        </ControlButton>
        <ControlButton active={state.paused} data-testid="motion-matching-pause" onClick={() => send('pause')}>
          {state.paused ? 'Resume' : 'Pause'}
        </ControlButton>
        <ControlButton data-testid="motion-matching-step" onClick={() => send('step')}>
          Step frame
        </ControlButton>
      </div>
      <ControlChoice
        activeId={String(state.timeScale)}
        label="Speed"
        onSelect={(timeScale) => send('timeScale', { timeScale: Number(timeScale) })}
        options={state.timeScales.map((scale) => ({ id: String(scale), label: `×${scale}` }))}
        testIdPrefix="motion-matching-speed"
      />
      <ControlChoice activeId={state.view} label="Camera" onSelect={(view) => send('view', { view })} options={VIEWS} testIdPrefix="motion-matching-view" />
    </>
  )
}

function Now({ state }: { state: MotionMatchingLabState }) {
  const motion: [string, string | number][] =
    state.mode === 'clip'
      ? [['Clip', state.viewer.clip || '—']]
      : [
          ['Time', seconds(state.t)],
          ['Step', state.step || '—'],
          ['Capsule speed', `${state.speed} cm/s`],
          ['Selected clip', state.clip || '—'],
          ['Clip time', seconds(state.clipTime)],
          ['Cost', state.cost],
          ['Continuing', state.continuing ? 'yes' : 'no, jumped'],
          ['Play rate', state.playRate],
        ]
  return <Readout rows={[...motion, ['Pelvis', `${state.pelvis} cm`], ['Left foot', footText(state.feet[0])], ['Right foot', footText(state.feet[1])]]} testId="motion-matching-readout" />
}

function ClipViewer({ state }: { state: MotionMatchingLabState }) {
  return (
    <ControlPanel maxWidth={380} title="One clip" readout={`${seconds(state.viewer.time)} / ${seconds(state.viewer.length)}`}>
      <ControlChoice activeId={state.viewer.clip} label="Database clip" onSelect={(clip) => send('clip', { clip })} options={state.clips.map((clip) => ({ id: clip, label: clip.replace(/^MF_Unarmed_/, '') }))} testIdPrefix="motion-matching-clip" />
      <div className={styles.buttons}>
        <ControlButton active={state.viewer.playing} data-testid="motion-matching-clip-play" onClick={() => send('clipPlaying', { playing: !state.viewer.playing })}>
          {state.viewer.playing ? 'Stop' : 'Play'}
        </ControlButton>
      </div>
      <ControlSlider data-testid="motion-matching-clip-time" format={seconds} label="Clip time" max={state.viewer.length || 1} min={0} onChange={(time) => send('clipTime', { time })} step={1 / 60} value={state.viewer.time} />
    </ControlPanel>
  )
}

function History({ state }: { state: MotionMatchingLabState }) {
  return (
    <ControlPanel maxWidth={380} title={state.mode === 'clip' ? 'Clip faults' : 'Run'} readout={`${state.violations.length} faults`}>
      {state.mode !== 'clip' && (
        <Readout rows={state.segments.slice(-12).map((segment): [string, string] => [`${segment.from.toFixed(2)}–${segment.to.toFixed(2)}`, segment.clip])} testId="motion-matching-segments" />
      )}
      <div className={styles.weights} data-testid="motion-matching-violations">
        {state.violations.map((violation, index) => (
          <ControlButton key={`${index}:${violation.kind}:${violation.from}`}onClick={() => send('inspect', { clip: violation.clip, time: violation.clipTime })}>
            {`${violation.from.toFixed(2)}–${violation.to.toFixed(2)} ${violation.kind}: ${violation.detail} (${violation.clip} @ ${violation.clipTime.toFixed(2)})`}
          </ControlButton>
        ))}
      </div>
    </ControlPanel>
  )
}

export function MotionMatchingLabHud() {
  const state = useGameState<MotionMatchingLabState>('motionMatchingLab/state')
  if (!state) return null
  return (
    <>
      <div className={styles.corner} data-hit data-testid="motion-matching-hud">
        <ControlPanel maxWidth={380} title="Motion matching" readout={state.paused ? 'paused' : state.scenario ? 'scenario running' : state.mode}>
          <p className={styles.about}>Green spheres: planted heel and ball. Yellow: lifted. Red: a planted foot sliding. Blue line: the capsule path. A fault button opens that clip at that time.</p>
          <Transport state={state} />
          <Now state={state} />
        </ControlPanel>
      </div>
      <div className={styles.rightCorner} data-hit data-testid="motion-matching-history">
        {state.mode === 'clip' && <ClipViewer state={state} />}
        <History state={state} />
      </div>
    </>
  )
}
