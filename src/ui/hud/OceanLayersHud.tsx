import { post } from '../bridge'
import { ControlButton, ControlPanel } from '../features/ui-kit'
import styles from './LabHud.module.css'
import { useGameState } from './useGameState'

type OceanLayersState = { off: number }
const LAYERS = [
  { bit: 1, id: 'sheet', label: 'Water sheet' },
  { bit: 2, id: 'sim-foam', label: 'Carried foam' },
  { bit: 4, id: 'fresh-foam', label: 'Breaking foam (mesh)' },
  { bit: 32, id: 'edge-foam', label: 'Swash edge foam' },
  { bit: 8, id: 'wet-sand', label: 'Wet sand' },
  { bit: 16, id: 'residue', label: 'Foam on sand' },
]

export function OceanLayersHud() {
  const state = useGameState<OceanLayersState>('ocean-layers/state')
  if (!state) return null
  return (
    <div className={styles.corner} data-hit data-testid="ocean-layers-hud">
      <ControlPanel maxWidth={300} title="Shore layers">
        {LAYERS.map((layer) => (
          <ControlButton
            active={(state.off & layer.bit) === 0}
            data-testid={`ocean-layer-${layer.id}`}
            key={layer.id}
            onClick={() => post({ type: 'ocean-layers/toggle', bit: layer.bit })}
            variant={(state.off & layer.bit) === 0 ? 'accent' : 'default'}
          >
            {`${layer.label}: ${(state.off & layer.bit) === 0 ? 'on' : 'off'}`}
          </ControlButton>
        ))}
      </ControlPanel>
    </div>
  )
}
