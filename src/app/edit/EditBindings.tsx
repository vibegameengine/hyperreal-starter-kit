import { InputLayer, KeyBinding } from '../../shared/input';
import { dragGizmo, redo, selectUnderCursor, setTool, toggleUnderCursor, undo } from './editActions';
import { toggleEditPause } from './editPause';

export type Navigation = 'orbit' | 'pan' | 'fly';

const NAVIGATION_BUTTON: Record<Navigation, string> = { orbit: 'LMB', pan: 'MMB', fly: 'RMB' };

export interface EditBindingsProps {
  navigation: Navigation | undefined;
  gizmoHovered: boolean;
  navigate(navigation: Navigation | undefined): void;
}

export function EditBindings({ navigation, gizmoHovered, navigate }: EditBindingsProps) {
  if (navigation) {
    return (
      <InputLayer name="Navigate" exclusive>
        <KeyBinding keys={NAVIGATION_BUTTON[navigation]} on="RELEASE" anyModifiers label="Stop navigating" run={() => navigate(undefined)} />
      </InputLayer>
    );
  }
  return (
    <InputLayer name="Edit">
      <KeyBinding keys="G" label="Move tool" run={() => setTool('move')} />
      <KeyBinding keys="R" label="Rotate tool" run={() => setTool('rotate')} />
      <KeyBinding keys="S" label="Scale tool" run={() => setTool('scale')} />
      <KeyBinding keys="Pause" label="Pause / resume the world" run={toggleEditPause} />
      <KeyBinding keys="Ctrl+Z" repeat label="Undo" run={undo} />
      <KeyBinding keys="Ctrl+Shift+Z" repeat label="Redo" run={redo} />
      <KeyBinding keys="LMB" on="CLICK" label="Select" run={selectUnderCursor} />
      <KeyBinding keys="Shift+LMB" on="CLICK" label="Add to selection" run={toggleUnderCursor} />
      <KeyBinding keys="Alt+LMB" label="Orbit" run={() => navigate('orbit')} />
      <KeyBinding keys="MMB" anyModifiers label="Pan" run={() => navigate('pan')} />
      <KeyBinding keys="RMB" anyModifiers label="Fly" run={() => navigate('fly')} />
      {gizmoHovered && (
        <InputLayer name="Gizmo">
          <KeyBinding keys="LMB" label="Drag the gizmo" run={dragGizmo} />
        </InputLayer>
      )}
    </InputLayer>
  );
}
