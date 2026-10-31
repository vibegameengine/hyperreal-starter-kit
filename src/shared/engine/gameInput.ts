let heldByEditor = false;

export const isGameInputHeld = () => heldByEditor;

export function holdGameInput(held: boolean) {
  heldByEditor = held;
}
