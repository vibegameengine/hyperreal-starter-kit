import { useState } from 'react'

import { ControlPanel } from '../ControlPanel/ControlPanel'
import { ControlDropdown } from './ControlDropdown'
import type { UiKitPreview } from '../../systems/uiKitPreview'

const CLIPS = [
  { id: 'walk_idle_loop', label: 'walk_idle_loop', note: 'playing now', accent: true },
  { id: 'walk_loop', label: 'walk_loop' },
  { id: 'walk_start_a', label: 'walk_start_a', note: 'default' },
  { id: 'walk_stop_b', label: 'walk_stop_b', note: 'default' },
  { id: 'walk_pivot_90_left', label: 'walk_pivot_90_left' },
  { id: 'walk_turn_180_right', label: 'walk_turn_180_right', note: 'default' },
]

function ControlDropdownPreview() {
  const [clip, setClip] = useState('walk_idle_loop')
  return (
    <ControlPanel maxWidth={280} title="Dropdown">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 260 }}>
        <ControlDropdown data-testid="preview-dropdown-clip" label="Clip" onSelect={setClip} options={CLIPS} selectedId={clip} />
        <ControlDropdown data-testid="preview-dropdown-disabled" disabled label="Locked" onSelect={() => {}} options={CLIPS} selectedId="walk_loop" />
      </div>
    </ControlPanel>
  )
}

export const uiKitPreview: UiKitPreview = {
  description: 'A choice among many named items: a button showing the chosen one, a scrolling list with notes and an accented item; closes on choosing or on a click outside. Editable and disabled.',
  id: 'control-dropdown',
  render: () => <ControlDropdownPreview />,
  title: 'Control dropdown',
}
