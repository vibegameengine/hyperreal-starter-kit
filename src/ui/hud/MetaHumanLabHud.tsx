import { post } from '../bridge'
import { ControlButton, ControlPanel } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type MetaHumanState = {
  closeUp: boolean
  parts: string[]
}

export function MetaHumanLabHud() {
  const state = useGameState<MetaHumanState>('metahuman/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="metahuman-hud">
      <ControlPanel maxWidth={320} title="MetaHuman">
        <ControlButton active={state.closeUp} data-testid="metahuman-close-up" onClick={() => post({ type: 'metahuman/close-up', value: !state.closeUp })} variant="accent">
          Face close-up
        </ControlButton>
        <p className={styles.about} data-testid="metahuman-parts">
          {state.parts.length ? state.parts.join(' · ') : 'loading the MetaHumans pack'}
        </p>
      </ControlPanel>
    </div>
  )
}
