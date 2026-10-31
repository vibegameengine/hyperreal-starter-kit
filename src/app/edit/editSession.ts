import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { createElement } from 'react';
import { releaseMouse } from '../../shared/engine/mouse';
import { holdGameInput } from '../../shared/engine/gameInput';
import { everyFrame, own, world } from '../../shared/engine/world';
import { cancelModals, processInput, runningModal } from '../../shared/input';
import { createSceneRoot, type SceneRoot } from '../../shared/react';
import { describeSelection, editOverlay, reinspectSelection } from './editActions';
import { KitBindings } from './KitBindings';
import { EditOverlay, type OverlayRefs, type OverlayStore } from './EditOverlay';
import { editState, report } from './editState';
import { dot, normalize, sub, type Vec3 } from './gizmoMath';
import { gizmoPartsOf } from './gizmoParts';
import { fadeOf, gizmoUnitCentimetres, partUnderCursor, toVec3, toVector, viewAxisAlignment, viewFrameOf } from './gizmoView';
import { onEditPauseChange, setEditPaused } from './editPause';
import { hidePropCard, listenToPropCard, publishPropCard } from './propCardSession';
import { hideSelection, showSelection } from './selectionLook';
import { defineTransformModalKeymap, selectionPivot } from './transform';

const store: OverlayStore = { look: { parts: [], partLook: { fades: {} } }, camera: { location: [0, 0, 0], rotation: [0, 0, 0] } };
const refs: OverlayRefs = { gizmo: { root: null, viewAligned: null, clippedSegments: new Map() } };
const DIAL_CLIP_BIAS = 0.02;
const segmentShown = new WeakMap<UE.StaticMeshComponent, boolean>();
let root: SceneRoot | undefined;
let previousViewTarget: UE.Actor | undefined;
let lastLookKey = '';
const ignoredHit = $ref(new UE.HitResult());

const playerController = () => UE.GameplayStatics.GetPlayerController(world, 0) as UE.PlayerController | undefined;

function enterEditMode() {
  const controller = playerController();
  if (root || !controller) return;
  previousViewTarget = controller.GetViewTarget();
  const rotator = controller.PlayerCameraManager.GetCameraRotation();
  store.camera = { location: toVec3(controller.PlayerCameraManager.GetCameraLocation()), rotation: [rotator.Pitch, rotator.Yaw, 0] };
  releaseMouse();
  holdGameInput(true);
  root = createSceneRoot(world);
  editOverlay.owns = (node) => root?.owns(node) ?? false;
  root.render(createElement(EditOverlay, { store, refs }));
  editState.active = true;
  report('edit mode: the world runs, the player is left alone');
}

function exitEditMode() {
  const controller = playerController();
  if (!root || !controller) return;
  cancelModals();
  editState.selection = [];
  hideSelection();
  hidePropCard();
  root.unmount();
  root = undefined;
  editState.active = false;
  editState.selection = [];
  editState.hoveredPart = undefined;
  setEditPaused(false);
  holdGameInput(false);
  if (previousViewTarget) controller.SetViewTargetWithBlend(previousViewTarget, 0, UE.EViewTargetBlendFunction.VTBlend_Linear, 0, false);
  report('play mode');
}

declare const __vge: { app?: { scene?: string } };
const currentScene = () => __vge.app?.scene;
const announceMode = () => import.meta.hot?.send('vge:edit-mode-state', { scene: currentScene(), active: editState.active, paused: editState.paused });
const toggleEditMode = () => {
  if (editState.active) exitEditMode();
  else enterEditMode();
  announceMode();
};

function updateGizmo(controller: UE.PlayerController) {
  const view = viewFrameOf(controller);
  const pivot = editState.selection.length && editState.tool !== 'select' && !runningModal() ? selectionPivot() : undefined;
  const parts = pivot ? gizmoPartsOf(editState.tool) : [];
  const alignment = viewAxisAlignment(view);
  if (pivot && refs.gizmo.root && refs.gizmo.viewAligned) {
    const unit = gizmoUnitCentimetres(view, pivot);
    refs.gizmo.root.K2_SetWorldLocation(toVector(pivot), false, ignoredHit, true);
    refs.gizmo.root.SetWorldScale3D(new UE.Vector(unit / 100, unit / 100, unit / 100));
    refs.gizmo.viewAligned.K2_SetWorldRotation(UE.KismetMathLibrary.MakeRotFromZ(toVector(sub(view.camera, pivot))), false, ignoredHit, true);
    clipBackHalf(normalize(sub(view.camera, pivot)));
    const cursor = cursorOf(controller);
    editState.hoveredPart = cursor ? partUnderCursor(parts, { view, pivot, unit, cursor }, alignment) : undefined;
  } else {
    editState.hoveredPart = undefined;
  }
  const fades = Object.fromEntries(parts.map((part) => [part.id, Math.round(fadeOf(part, alignment) * 10) / 10]));
  const key = JSON.stringify([parts.map((part) => part.id), editState.hoveredPart?.id, fades]);
  if (key !== lastLookKey) {
    lastLookKey = key;
    store.look = { parts, partLook: { hovered: editState.hoveredPart?.id, fades } };
    store.listener?.(store.look);
  }
}

function clipBackHalf(toCamera: Vec3) {
  for (const { component, centre } of refs.gizmo.clippedSegments.values()) {
    const shown = dot(normalize(centre as unknown as Vec3), toCamera) >= -DIAL_CLIP_BIAS;
    if (segmentShown.get(component) === shown) continue;
    segmentShown.set(component, shown);
    component.SetVisibility(shown, false);
  }
}

function cursorOf(controller: UE.PlayerController): [number, number] | undefined {
  const x = $ref(0);
  const y = $ref(0);
  return controller.GetMousePosition(x, y) ? [$unref(x), $unref(y)] : undefined;
}

function editFrame() {
  const controller = playerController();
  if (!controller) return;
  if (editState.active) {
    showSelection();
    updateGizmo(controller);
    publishPropCard(controller, Boolean(runningModal()));
  }
  processInput(controller);
}

export function mountEditSession() {
  defineTransformModalKeymap();
  const kitRoot = createSceneRoot(world);
  kitRoot.render(createElement(KitBindings, { toggleEditMode }));
  own(() => kitRoot.unmount(), 'app');
  everyFrame(editFrame, 'app', { tickEvenWhenPaused: true });
  own(listenToPropCard(), 'app');
  onEditPauseChange(announceMode);
  import.meta.hot?.on('vge:edit-mode', ({ scene, active, paused }: { scene: string; active?: boolean; paused?: boolean }) => {
    if (scene !== currentScene()) return;
    if (active !== undefined && active !== editState.active) {
      toggleEditMode();
      UE.WidgetBlueprintLibrary.SetFocusToGameViewport();
    }
    if (paused !== undefined && editState.active) setEditPaused(paused);
    announceMode();
  });
  own(() => exitEditMode(), 'app');
  import.meta.hot?.on('vite:afterUpdate', reinspectSelection);
  (globalThis as any).vgeEdit = {
    state: () => ({
      editing: editState.active,
      paused: UE.GameplayStatics.IsGamePaused(world),
      tool: editState.tool,
      hovered: editState.hoveredPart?.id,
      modal: runningModal()?.status?.(),
      selection: editState.selection.map((selected) => ({ type: selected.node.type, where: describeSelection(selected) })),
      message: editState.message,
    }),
  };
}
