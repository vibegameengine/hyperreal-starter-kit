import { post } from '../bridge'
import { ControlButton, ControlChoice, ControlPanel, ControlSlider } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type SandstormState = { resolution: number; resolutions: number[]; wind: number; density: number }

export function SandstormLabHud() {
  const state = useGameState<SandstormState>('sandstorm/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="sandstorm-hud">
      <ControlPanel maxWidth={340} title="Sandstorm">
        <p className={styles.about}>Niagara Fluids 3D gas from Epic's particle advection template, set up in TypeScript as a wall of sand: sand grains ride the gas velocity and the storm flows around the pillar. Wind, density and grid resolution change live.</p>
        <ControlSlider data-testid="sandstorm-wind" format={(value) => `${(value / 100).toFixed(1)} m/s`} label="Wind" max={2000} min={0} onChange={(speed) => post({ type: 'sandstorm/wind', speed })} step={50} value={state.wind} />
        <ControlSlider data-testid="sandstorm-density" format={(value) => value.toFixed(1)} label="Density" max={10} min={0} onChange={(density) => post({ type: 'sandstorm/density', density })} step={0.1} value={state.density} />
        <ControlChoice activeId={String(state.resolution)} label="Grid cells" onSelect={(cells) => post({ type: 'sandstorm/resolution', cells: Number(cells) })} options={state.resolutions.map((cells) => ({ id: String(cells), label: String(cells) }))} testIdPrefix="sandstorm-resolution" />
        <ControlButton data-testid="sandstorm-restart" onClick={() => post({ type: 'sandstorm/restart' })}>
          Restart the storm
        </ControlButton>
      </ControlPanel>
    </div>
  )
}
