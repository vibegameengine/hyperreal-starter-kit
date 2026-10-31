import { post } from '../bridge'
import { ControlButton, ControlChoice, ControlPanel, ControlSlider } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type ClothStats = { cloths: number; dynamic: number; kinematic: number; iterations: number; simulationMs: number } | null
type ClothState = { wind: number; heading: number; fabric: string; fabrics: string[]; walking: boolean; flag: ClothStats; curtain: ClothStats }

export function ClothLabHud() {
  const state = useGameState<ClothState>('cloth/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="cloth-hud">
      <ControlPanel maxWidth={340} title="Cloth">
        <p className={styles.about}>Chaos Cloth built at import from what each model's import line pins; its stiffness, damping, drag and collision are set by the game code. Wind and fabric change live, without a rebuild.</p>
        <ControlSlider data-testid="cloth-wind" format={(value) => `${Math.round(value / 100)} m/s`} label="Wind" max={2500} min={0} onChange={(strength) => post({ type: 'cloth/wind', strength })} step={50} value={state.wind} />
        <ControlSlider data-testid="cloth-heading" format={(value) => `${Math.round(value)}°`} label="Wind direction" max={180} min={-180} onChange={(degrees) => post({ type: 'cloth/heading', degrees })} step={5} value={state.heading} />
        <ControlChoice activeId={state.fabric} label="Fabric" onSelect={(fabric) => post({ type: 'cloth/fabric', fabric })} options={state.fabrics.map((id) => ({ id, label: id }))} testIdPrefix="cloth-fabric" />
        <ControlButton active={state.walking} data-testid="cloth-walker" onClick={() => post({ type: 'cloth/walker', walking: !state.walking })}>
          Walk through the curtain
        </ControlButton>
        <p className={styles.about} data-testid="cloth-stats">
          Flag {state.flag?.dynamic ?? 0} particles, curtain {state.curtain?.dynamic ?? 0}
        </p>
      </ControlPanel>
    </div>
  )
}
