import * as UE from 'ue';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGIT_NAMES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const UE_DIGIT_NAMES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

const NAMED_KEYS: Record<string, { engine: string; label: string }> = {
  LEFTMOUSE: { engine: 'LeftMouseButton', label: 'LMB' },
  MIDDLEMOUSE: { engine: 'MiddleMouseButton', label: 'MMB' },
  RIGHTMOUSE: { engine: 'RightMouseButton', label: 'RMB' },
  WHEELUPMOUSE: { engine: 'MouseScrollUp', label: 'Wheel Up' },
  WHEELDOWNMOUSE: { engine: 'MouseScrollDown', label: 'Wheel Down' },
  ESC: { engine: 'Escape', label: 'Esc' },
  RET: { engine: 'Enter', label: 'Enter' },
  SPACE: { engine: 'SpaceBar', label: 'Space' },
  TAB: { engine: 'Tab', label: 'Tab' },
  BACK_SPACE: { engine: 'BackSpace', label: 'Backspace' },
  DEL: { engine: 'Delete', label: 'Delete' },
  HOME: { engine: 'Home', label: 'Home' },
  PAUSE: { engine: 'Pause', label: 'Pause' },
  ACCENT_GRAVE: { engine: 'Tilde', label: '`' },
  MINUS: { engine: 'Hyphen', label: '-' },
  PERIOD: { engine: 'Period', label: '.' },
  COMMA: { engine: 'Comma', label: ',' },
  UP_ARROW: { engine: 'Up', label: 'Up' },
  DOWN_ARROW: { engine: 'Down', label: 'Down' },
  LEFT_ARROW: { engine: 'Left', label: 'Left' },
  RIGHT_ARROW: { engine: 'Right', label: 'Right' },
  LEFT_SHIFT: { engine: 'LeftShift', label: 'Shift' },
  RIGHT_SHIFT: { engine: 'RightShift', label: 'Shift' },
  LEFT_CTRL: { engine: 'LeftControl', label: 'Ctrl' },
  RIGHT_CTRL: { engine: 'RightControl', label: 'Ctrl' },
  LEFT_ALT: { engine: 'LeftAlt', label: 'Alt' },
  RIGHT_ALT: { engine: 'RightAlt', label: 'Alt' },
  NUMPAD_PERIOD: { engine: 'Decimal', label: 'Numpad .' },
  NUMPAD_PLUS: { engine: 'Add', label: 'Numpad +' },
  NUMPAD_MINUS: { engine: 'Subtract', label: 'Numpad -' },
  NUMPAD_SLASH: { engine: 'Divide', label: 'Numpad /' },
};

for (const letter of LETTERS) NAMED_KEYS[letter] = { engine: letter, label: letter };
DIGIT_NAMES.forEach((name, digit) => {
  NAMED_KEYS[name] = { engine: UE_DIGIT_NAMES[digit], label: String(digit) };
  NAMED_KEYS[`NUMPAD_${digit}`] = { engine: `NumPad${UE_DIGIT_NAMES[digit]}`, label: `Numpad ${digit}` };
});
for (let index = 1; index <= 12; index++) NAMED_KEYS[`F${index}`] = { engine: `F${index}`, label: `F${index}` };

export type EventType = keyof typeof NAMED_KEYS | 'MOUSEMOVE';

export const MOUSE_BUTTONS = ['LEFTMOUSE', 'MIDDLEMOUSE', 'RIGHTMOUSE'] as const;
export const WHEEL_KEYS = ['WHEELUPMOUSE', 'WHEELDOWNMOUSE'] as const;
export const MODIFIER_KEYS = { shift: ['LEFT_SHIFT', 'RIGHT_SHIFT'], ctrl: ['LEFT_CTRL', 'RIGHT_CTRL'], alt: ['LEFT_ALT', 'RIGHT_ALT'] } as const;

export const isKnownKey = (type: string) => type in NAMED_KEYS;
export const keyLabel = (type: string) => NAMED_KEYS[type]?.label ?? type;
export const digitOf = (type: string) => {
  const plain = DIGIT_NAMES.indexOf(type);
  if (plain >= 0) return plain;
  const numpad = /^NUMPAD_(\d)$/.exec(type);
  return numpad ? Number(numpad[1]) : undefined;
};

const engineKeys = new Map<string, UE.Key>();
export function engineKeyOf(type: string) {
  let key = engineKeys.get(type);
  if (!key) engineKeys.set(type, (key = new UE.Key(NAMED_KEYS[type].engine)));
  return key;
}

export const ALL_KEY_TYPES = Object.keys(NAMED_KEYS);
