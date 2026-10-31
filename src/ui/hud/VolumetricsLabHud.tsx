import { post } from '../bridge'
import { ControlChoice, ControlPanel, ControlSlider } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type VolumetricsState = {
  cover: number
  bottom: number
  height: number
  fog: number
  smoke: number
  sunPitch: number
  quality: string
  volumetricFog: number
  heterogeneousVolumes: number
  gpuMs: number
  gameMs: number
}
const QUALITY = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'epic', label: 'Epic' },
  { id: 'cinematic', label: 'Cine' },
]
const send = (type: string) => (value: number | string) => post({ type: `volumetrics/${type}`, value })
const ms = (value: number) => `${value.toFixed(1)} ms`

export function VolumetricsLabHud() {
  const state = useGameState<VolumetricsState>('volumetrics/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="volumetrics-hud">
      <ControlPanel maxWidth={340} title="Clouds">
        <ControlSlider data-testid="volumetrics-cover" format={(v) => `${Math.round((v + 0.6) * 100)}%`} label="Cover" max={0.4} min={-0.6} onChange={send('cover')} step={0.01} value={state.cover} />
        <ControlSlider data-testid="volumetrics-bottom" format={(v) => `${v.toFixed(1)} km`} label="Base altitude" max={6} min={0.2} onChange={send('bottom')} step={0.1} value={state.bottom} />
        <ControlSlider data-testid="volumetrics-height" format={(v) => `${v.toFixed(1)} km`} label="Layer height" max={12} min={0.5} onChange={send('height')} step={0.1} value={state.height} />
        <ControlSlider data-testid="volumetrics-sun" format={(v) => `${Math.round(-v)}°`} label="Sun height" max={-3} min={-80} onChange={send('sun')} step={1} value={state.sunPitch} />
      </ControlPanel>
      <ControlPanel maxWidth={340} title="Volumes">
        <ControlSlider data-testid="volumetrics-fog" format={(v) => v.toFixed(2)} label="Clearing fog" max={2} min={0} onChange={send('fog')} step={0.01} value={state.fog} />
        <ControlSlider data-testid="volumetrics-smoke" format={(v) => v.toFixed(3)} label="Smoke density" max={0.2} min={0} onChange={send('smoke')} step={0.002} value={state.smoke} />
      </ControlPanel>
      <ControlPanel maxWidth={340} title="Quality">
        <ControlChoice activeId={state.quality} label="Scalability" onSelect={send('quality')} options={QUALITY} testIdPrefix="volumetrics-quality" />
        <p className={styles.about} data-testid="volumetrics-cost">
          GPU {ms(state.gpuMs)} · game {ms(state.gameMs)}
          <br />
          Volumetric fog {state.volumetricFog ? 'on' : 'off'} · smoke volumes {state.heterogeneousVolumes ? 'on' : 'off'}
        </p>
      </ControlPanel>
    </div>
  )
}
