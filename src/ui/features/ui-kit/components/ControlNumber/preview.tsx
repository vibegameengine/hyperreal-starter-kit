import { useState } from 'react'

import { ControlPanel } from '../ControlPanel/ControlPanel'
import { ControlNumber } from './ControlNumber'
import type { UiKitPreview } from '../../systems/uiKitPreview'

function ControlNumberPreview() {
  const [speed, setSpeed] = useState(90)
  const [offset, setOffset] = useState([10, -2.5, 0])
  const [count, setCount] = useState(5)

  return (
    <ControlPanel maxWidth={300} title="Number field">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <ControlNumber data-testid="preview-number-speed" label="Speed" onChange={setSpeed} step={1} value={speed} />
        <ControlNumber data-testid="preview-number-count" label="Count" max={10} min={1} onChange={setCount} step={1} value={count} />
        <div style={{ display: 'flex', gap: 4 }}>
          {offset.map((axis, index) => (
            <ControlNumber
              data-testid={`preview-number-axis-${index}`}
              key={index}
              label={'XYZ'[index]}
              onChange={(next) => setOffset(offset.map((value, at) => (at === index ? next : value)))}
              value={axis}
            />
          ))}
        </div>
        <ControlNumber data-testid="preview-number-disabled" disabled label="Locked" onChange={() => {}} value={1} />
      </div>
    </ControlPanel>
  )
}

export const uiKitPreview: UiKitPreview = {
  description: 'Blender-style number field: drag sideways to change the value (Shift for precision), click to type it, Enter to confirm, Escape to cancel; one field, a vector of three, a clamped count and disabled.',
  id: 'control-number',
  render: () => <ControlNumberPreview />,
  title: 'Control number',
}
