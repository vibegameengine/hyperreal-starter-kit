import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { onHudMessage, sendToHud, type HudMessage } from '../../shared/react/hud';
import { requestEdit } from './channel';
import { creationStackOf, overridePath, propsOf } from './devtools';
import { editState, report, type Selected } from './editState';
import { toVector } from './gizmoView';
import { propCardOf, type PropCard, type PropPath } from './propCard';
import { worldLocationOf } from './propPlan';

interface Shown {
  selected: Selected;
  card: PropCard;
}

const wantedLevels = new WeakMap<Selected, number>();
const originals = new Map<string, unknown>();
let shown: Shown | undefined;
const PLACE_STEP_PX = 4;
const RESEND_AFTER_MS = 1000;
const lastSent = new Map<string, { text: string; at: number }>();

function withValueAt(container: unknown, keys: PropPath, value: unknown): unknown {
  if (!keys.length) return value;
  const [key, ...rest] = keys;
  const copy: any = Array.isArray(container) ? [...container] : { ...(container && typeof container === 'object' ? container : {}) };
  copy[key] = withValueAt(copy[key], rest, value);
  return copy;
}

const CORNERS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])));

function worldBoundsOf(selected: Selected): { origin: UE.Vector; extent: UE.Vector } | undefined {
  const object = selected.node.object;
  const origin = $ref(new UE.Vector());
  const extent = $ref(new UE.Vector());
  if (object instanceof UE.Actor) UE.KismetSystemLibrary.GetActorBounds(object, origin, extent);
  else if (object instanceof UE.SceneComponent) UE.KismetSystemLibrary.GetComponentBounds(object, origin, extent, $ref(0));
  else return undefined;
  return { origin: $unref(origin), extent: $unref(extent) };
}

function screenPointOf(controller: UE.PlayerController, point: UE.Vector): [number, number] | undefined {
  const screen = $ref(new UE.Vector2D());
  if (!controller.ProjectWorldLocationToScreen(point, screen, false)) return undefined;
  const at = $unref(screen);
  return [at.X, at.Y];
}

function screenSpanOf(controller: UE.PlayerController, selected: Selected): [number, number] | undefined {
  const bounds = worldBoundsOf(selected);
  if (!bounds) return undefined;
  const { origin, extent } = bounds;
  const xs = CORNERS.flatMap(([x, y, z]) => screenPointOf(controller, new UE.Vector(origin.X + x * extent.X, origin.Y + y * extent.Y, origin.Z + z * extent.Z))?.[0] ?? []);
  return xs.length ? [Math.round(Math.min(...xs)), Math.round(Math.max(...xs))] : undefined;
}

const snapped = (pair: [number, number] | undefined) => pair?.map((value) => Math.round(value / PLACE_STEP_PX) * PLACE_STEP_PX) as [number, number] | undefined;

function anchorOf(controller: UE.PlayerController, selected: Selected): [number, number] | undefined {
  const location = worldLocationOf(selected.node);
  const at = location && screenPointOf(controller, toVector(location));
  return at ? [Math.round(at[0]), Math.round(at[1])] : undefined;
}

function send(message: HudMessage) {
  const text = JSON.stringify(message);
  const now = Date.now();
  const last = lastSent.get(message.type);
  if (last?.text === text && now - last.at < RESEND_AFTER_MS) return;
  lastSent.set(message.type, { text, at: now });
  sendToHud(message);
}

interface CardPlace {
  key: string;
  place: { anchor?: [number, number]; span?: [number, number]; viewportWidth: number };
}

let lastPlace: CardPlace | undefined;

function viewKeyOf(controller: UE.PlayerController, selected: Selected) {
  const manager = controller.PlayerCameraManager;
  const location = manager.GetCameraLocation();
  const rotation = manager.GetCameraRotation();
  const viewport = UE.WidgetLayoutLibrary.GetViewportSize(controller);
  const view = [location.X, location.Y, location.Z, rotation.Pitch * 10, rotation.Yaw * 10, rotation.Roll * 10, manager.GetFOVAngle() * 10, viewport.X, viewport.Y].map(Math.round);
  return `${editState.selection.indexOf(selected)}:${selected.chain.length}:${view.join(',')}`;
}

function placeFor(controller: UE.PlayerController, selected: Selected) {
  const key = viewKeyOf(controller, selected);
  if (lastPlace?.key === key) return lastPlace.place;
  const viewport = UE.WidgetLayoutLibrary.GetViewportSize(controller);
  const place = { anchor: snapped(anchorOf(controller, selected)), span: snapped(screenSpanOf(controller, selected)), viewportWidth: viewport.X };
  lastPlace = { key, place };
  return place;
}

function forgetOriginals() {
  originals.clear();
}

export function publishPropCard(controller: UE.PlayerController, hidden: boolean) {
  const selected = editState.selection.length === 1 ? editState.selection[0] : undefined;
  const card = selected && !hidden ? propCardOf(selected, wantedLevels.get(selected)) : undefined;
  if (!selected || !card) {
    if (shown) forgetOriginals();
    shown = undefined;
    send({ type: 'edit/card', card: null });
    return;
  }
  if (shown?.selected !== selected || shown.card.level !== card.level) {
    forgetOriginals();
    lastPlace = undefined;
  }
  shown = { selected, card };
  send({ type: 'edit/card', card });
  send({ type: 'edit/card-place', ...placeFor(controller, selected) });
}

export function hidePropCard() {
  forgetOriginals();
  shown = undefined;
  send({ type: 'edit/card', card: null });
}

const levelFiber = () => (shown ? shown.selected.chain[shown.card.level] : undefined);
const propKey = (path: PropPath) => String(path[0]);

function preview(path: PropPath, value: unknown) {
  const fiber = levelFiber();
  if (!fiber) return;
  const [prop, ...keys] = path;
  const current = propsOf(fiber)[prop];
  if (!originals.has(propKey(path))) originals.set(propKey(path), current);
  overridePath(fiber, [prop], withValueAt(current, keys, value));
}

function cancel(path: PropPath) {
  const fiber = levelFiber();
  if (!fiber || !originals.has(propKey(path))) return;
  overridePath(fiber, [path[0]], originals.get(propKey(path)));
  originals.delete(propKey(path));
}

function commit(path: PropPath, value: unknown) {
  const fiber = levelFiber();
  if (!fiber) return;
  preview(path, value);
  void requestEdit<{ files: string[] }>('commit', { edits: [{ stack: creationStackOf(fiber), path, value }] })
    .then(({ files }) => {
      originals.delete(propKey(path));
      report(files.length ? `wrote ${path.join('.')} in ${files.join(', ')}` : 'nothing to write');
    })
    .catch((err) => {
      cancel(path);
      report(`not written: ${err.message}`);
    });
}

function handle(message: HudMessage) {
  if (message.type === 'edit/level' && shown) {
    wantedLevels.set(shown.selected, Number(message.level));
    return;
  }
  if (message.type !== 'edit/prop' || !Array.isArray(message.path)) return;
  const path = message.path as PropPath;
  if (message.phase === 'preview') preview(path, message.value);
  else if (message.phase === 'commit') commit(path, message.value);
  else if (message.phase === 'cancel') cancel(path);
}

export const listenToPropCard = () => onHudMessage(handle);
