import { post } from '../bridge'
import { ControlPanel, ControlSlider } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type PcgState = {
  treeDensity: number
  rockDensity: number
  flatness: number
  seed: number
  ms: number
  instances: Record<string, number>
}
const send = (type: string) => (value: number) => post({ type: `pcg/${type}`, value })
const slopeOf = (flatness: number) => `${Math.round((Math.acos(flatness) * 180) / Math.PI)}°`

export function PcgLabHud() {
  const state = useGameState<PcgState>('pcg/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="pcg-hud">
      <ControlPanel maxWidth={340} title="Forest rules">
        <ControlSlider data-testid="pcg-trees" format={(v) => `${(v * 100).toFixed(1)} / 100 m²`} label="Tree density" max={0.1} min={0.002} onChange={send('trees')} step={0.002} value={state.treeDensity} />
        <ControlSlider data-testid="pcg-rocks" format={(v) => `${(v * 100).toFixed(1)} / 100 m²`} label="Rock density" max={0.05} min={0} onChange={send('rocks')} step={0.001} value={state.rockDensity} />
        <ControlSlider data-testid="pcg-slope" format={slopeOf} label="Steepest slope for trees" max={0.99} min={0.5} onChange={send('flatness')} step={0.01} value={state.flatness} />
        <ControlSlider data-testid="pcg-seed" format={(v) => String(v)} label="Seed" max={100} min={1} onChange={send('seed')} step={1} value={state.seed} />
      </ControlPanel>
      <ControlPanel maxWidth={340} title="Generated">
        <p className={styles.about} data-testid="pcg-generated">
          {state.ms} ms
          <br />
          {Object.entries(state.instances).map(([mesh, count]) => `${mesh} ${count}`).join(' · ') || 'nothing yet'}
        </p>
      </ControlPanel>
    </div>
  )
}
