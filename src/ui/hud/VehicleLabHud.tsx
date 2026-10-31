import { post } from '../bridge'
import { ControlButton, ControlPanel } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type VehicleState = {
  cruise: number
  steer: number
  speedKmh: number
  gear: number
  rpm: number
  suspension: number[]
}

export function VehicleLabHud() {
  const state = useGameState<VehicleState>('vehicle/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="vehicle-hud">
      <ControlPanel maxWidth={300} title="Car">
        <p className={styles.about} data-testid="vehicle-stats">
          {Math.abs(state.speedKmh)} km/h · gear {state.gear === 0 ? 'N' : state.gear < 0 ? 'R' : state.gear} · {state.rpm} rpm
          <br />
          W throttle · S brake · A/D steer · Space handbrake
        </p>
        <ControlButton active={state.cruise > 0} data-testid="vehicle-cruise" onClick={() => post({ type: 'vehicle/cruise', value: state.cruise > 0 ? 0 : 1 })} variant="accent">
          Cruise
        </ControlButton>
        <ControlButton active={state.steer !== 0} data-testid="vehicle-circle" onClick={() => post({ type: 'vehicle/steer', value: state.steer !== 0 ? 0 : 1 })}>
          Circle
        </ControlButton>
        <ControlButton data-testid="vehicle-reset" onClick={() => post({ type: 'vehicle/reset' })}>
          Reset
        </ControlButton>
      </ControlPanel>
    </div>
  )
}
