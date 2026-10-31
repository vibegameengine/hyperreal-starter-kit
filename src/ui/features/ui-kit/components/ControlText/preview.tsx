import { useState } from 'react'

import { ControlPanel } from '../ControlPanel/ControlPanel'
import { ControlText } from './ControlText'
import type { UiKitPreview } from '../../systems/uiKitPreview'

function ControlTextPreview() {
  const [name, setName] = useState('walk_loop')

  return (
    <ControlPanel maxWidth={280} title="Text field">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ControlText data-testid="preview-text-name" label="Clip" onCommit={setName} value={name} />
        <ControlText data-testid="preview-text-disabled" disabled label="Locked" onCommit={() => {}} value="read only" />
      </div>
    </ControlPanel>
  )
}

export const uiKitPreview: UiKitPreview = {
  description: 'Labelled text field that writes its value on Enter or when it loses focus, Escape restores it; editable and disabled.',
  id: 'control-text',
  render: () => <ControlTextPreview />,
  title: 'Control text',
}
