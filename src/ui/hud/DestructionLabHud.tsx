import { post } from '../bridge'
import { ControlButton, ControlPanel, ControlSlider } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type DestructionState = {
  shotStrain: number
  breaks: number
  fps: number
}
const send = (type: string, value?: number) => () => post({ type: `destruction/${type}`, value })

export function DestructionLabHud() {
  const state = useGameState<DestructionState>('destruction/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="destruction-hud">
      <ControlPanel maxWidth={340} title="Break it">
        <ControlButton data-testid="destruction-shoot" onClick={send('shoot')} variant="accent">
          Shoot
        </ControlButton>
        <ControlButton data-testid="destruction-ball" onClick={send('ball')}>
          Throw ball
        </ControlButton>
        <ControlButton data-testid="destruction-explode" onClick={send('explode')}>
          Explode
        </ControlButton>
        <ControlButton data-testid="destruction-reset" onClick={send('reset')}>
          Reset
        </ControlButton>
        <ControlSlider data-testid="destruction-strain" format={(v) => `${Math.round(v / 1000)}k`} label="Shot strain" max={2000000} min={10000} onChange={(value) => post({ type: 'destruction/strain', value })} step={10000} value={state.shotStrain} />
      </ControlPanel>
      <ControlPanel maxWidth={340} title="Simulated">
        <p className={styles.about} data-testid="destruction-stats">
          {state.breaks} breaks · {state.fps} fps
        </p>
      </ControlPanel>
    </div>
  )
}
