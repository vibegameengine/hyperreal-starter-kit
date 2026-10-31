import { post } from '../bridge'
import { ControlChoice, ControlPanel } from '../features/ui-kit'
import styles from './MainSceneHud.module.css'
import { useGameState } from './useGameState'

type WorldSceneState = { fps: number; frameRateLimit: number }

const FRAME_RATE_LIMITS = [
  { id: '30', label: '30' },
  { id: '60', label: '60' },
  { id: '120', label: '120' },
  { id: '0', label: 'No limit' },
]

export function WorldSceneHud() {
  const state = useGameState<WorldSceneState>('world/state')
  if (!state) return null

  return (
    <div className={styles.rightCorner} data-hit data-testid="world-scene-hud">
      <ControlPanel maxWidth={300} readout={`${state.fps} FPS`} title="World">
        <ControlChoice
          activeId={String(state.frameRateLimit)}
          label="Frame rate limit"
          onSelect={(limit) => post({ type: 'world/frameRateLimit', limit: Number(limit) })}
          options={FRAME_RATE_LIMITS}
          testIdPrefix="world-frame-rate"
        />
      </ControlPanel>
    </div>
  )
}
