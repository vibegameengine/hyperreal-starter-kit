import { post } from '../bridge'
import { ControlButton, ControlPanel, ControlSlider } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type HairState = {
  wind: number
  simulate: boolean
}

export function HairLabHud() {
  const state = useGameState<HairState>('hair/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="hair-hud">
      <ControlPanel maxWidth={320} title="Hair">
        <ControlSlider data-testid="hair-wind" format={(v) => `${(v / 100).toFixed(1)} m/s`} label="Wind" max={1500} min={0} onChange={(value) => post({ type: 'hair/wind', value })} step={50} value={state.wind} />
        <ControlButton active={state.simulate} data-testid="hair-simulate" onClick={() => post({ type: 'hair/simulate', value: !state.simulate })} variant="accent">
          Simulation
        </ControlButton>
      </ControlPanel>
    </div>
  )
}
