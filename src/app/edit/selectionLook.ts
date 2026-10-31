import * as UE from 'ue';
import { loadContent, onMaterial } from '../../shared/engine/content';
import { world } from '../../shared/engine/world';
import { isA } from '../../shared/react/catalog';
import type { HostNode } from '../../shared/react/renderer';
import { overrideProp, propsOf } from './devtools';
import { editState, type Selected } from './editState';
import outline from './outline.material';

const SELECTED_STENCIL = 1;
const ACTIVE_STENCIL = 2;
const MESH_OF_ACTOR = ['staticMeshComponent', 'skeletalMeshComponent', 'mesh'];
const SELECTED_DEPTH = 'selectedDepth';
const ACTIVE_DEPTH = 'activeDepth';
const OFF_IN_DEPTH_CAPTURE = ['AntiAliasing', 'TemporalAA', 'MotionBlur', 'PostProcessing', 'Atmosphere', 'Fog', 'VolumetricFog', 'DynamicShadows', 'GlobalIllumination', 'LumenGlobalIllumination', 'LumenReflections', 'ScreenSpaceReflections', 'AmbientOcclusion', 'Translucency', 'Decals', 'SkyLighting'];

interface StencilProps {
  renderCustomDepth: boolean;
  customDepthStencilValue: number;
}

const stencilOf = (value: number): StencilProps => ({ renderCustomDepth: value > 0, customDepthStencilValue: value });
const UNMARKED = stencilOf(0);

function meshPropOf(node: HostNode): string | undefined {
  if (isA(node.className, 'MeshComponent')) return '';
  if (node.kind !== 'actor') return undefined;
  return MESH_OF_ACTOR.find((prop) => node.object?.[prop.charAt(0).toUpperCase() + prop.slice(1)] !== undefined);
}

function markedOf(fiber: any, meshProp: string): StencilProps {
  const props = meshProp ? propsOf(fiber)[meshProp] ?? {} : propsOf(fiber);
  return { renderCustomDepth: props.renderCustomDepth ?? false, customDepthStencilValue: props.customDepthStencilValue ?? 0 };
}

function mark(fiber: any, meshProp: string, stencil: StencilProps) {
  const current = markedOf(fiber, meshProp);
  if (current.renderCustomDepth === stencil.renderCustomDepth && current.customDepthStencilValue === stencil.customDepthStencilValue) return;
  if (!meshProp) {
    overrideProp(fiber, 'renderCustomDepth', stencil.renderCustomDepth);
    overrideProp(fiber, 'customDepthStencilValue', stencil.customDepthStencilValue);
    return;
  }
  overrideProp(fiber, meshProp, { ...(propsOf(fiber)[meshProp] ?? {}), ...stencil });
}

interface Marked {
  meshProp: string;
  base: StencilProps;
  fiber: any;
}

const marked = new Map<HostNode, Marked>();

function apply(selected: Selected, active: boolean) {
  const fiber = selected.chain[0];
  const meshProp = meshPropOf(selected.node);
  if (meshProp === undefined || !fiber) return;
  let entry = marked.get(selected.node);
  if (!entry) marked.set(selected.node, (entry = { meshProp, base: markedOf(fiber, meshProp), fiber }));
  entry.fiber = fiber;
  mark(fiber, meshProp, stencilOf(active ? ACTIVE_STENCIL : SELECTED_STENCIL));
}

function clear(node: HostNode) {
  const entry = marked.get(node);
  marked.delete(node);
  const fiber = entry?.fiber ?? node.fiber;
  if (!entry || !node.mounted || !fiber) return;
  mark(fiber, entry.meshProp, entry.base.customDepthStencilValue ? entry.base : UNMARKED);
}

interface DepthCapture {
  actor: UE.SceneCapture2D;
  target: UE.TextureRenderTarget2D;
  shown: UE.PrimitiveComponent[];
}

let volume: UE.PostProcessVolume | undefined;
let stopWatching: (() => void) | undefined;
let captures: { selected: DepthCapture; active: DepthCapture } | undefined;

function spawnDeferred<T extends UE.Actor>(actorClass: UE.Class, setUp: (actor: T) => void) {
  const transform = new UE.Transform();
  const actor = UE.GameplayStatics.BeginDeferredActorSpawnFromClass(world, actorClass, transform, UE.ESpawnActorCollisionHandlingMethod.AlwaysSpawn, undefined, UE.ESpawnActorScaleMethod.MultiplyWithRoot) as T;
  setUp(actor);
  UE.GameplayStatics.FinishSpawningActor(actor, transform, UE.ESpawnActorScaleMethod.MultiplyWithRoot);
  return actor;
}

function viewportSize(): [number, number] {
  const size = UE.WidgetLayoutLibrary.GetViewportSize(world);
  return [Math.max(1, Math.round(size.X)), Math.max(1, Math.round(size.Y))];
}

function depthOnlyShowFlags() {
  const settings = UE.NewArray(UE.EngineShowFlagsSetting);
  for (const flag of OFF_IN_DEPTH_CAPTURE) settings.Add(new UE.EngineShowFlagsSetting(flag, false));
  return settings;
}

function spawnDepthCapture(): DepthCapture {
  const [width, height] = viewportSize();
  const target = UE.KismetRenderingLibrary.CreateRenderTarget2D(world, width, height, UE.ETextureRenderTargetFormat.RTF_R32f, new UE.LinearColor(0, 0, 0, 0));
  const actor = spawnDeferred<UE.SceneCapture2D>(UE.SceneCapture2D.StaticClass(), (spawned) => {
    const capture = spawned.CaptureComponent2D;
    capture.CaptureSource = UE.ESceneCaptureSource.SCS_SceneDepth;
    capture.PrimitiveRenderMode = UE.ESceneCapturePrimitiveRenderMode.PRM_UseShowOnlyList;
    capture.bCaptureOnMovement = false;
    capture.bCaptureEveryFrame = true;
    capture.TextureTarget = target;
  });
  actor.CaptureComponent2D.SetShowFlagSettings(depthOnlyShowFlags());
  actor.CaptureComponent2D.SetTickableWhenPaused(true);
  return { actor, target, shown: [] };
}

function destroyDepthCapture(capture: DepthCapture) {
  if (UE.KismetSystemLibrary.IsValid(capture.actor)) capture.actor.K2_DestroyActor();
  UE.KismetRenderingLibrary.ReleaseRenderTarget2D(capture.target);
}

const instancePool = () => UE.SubsystemBlueprintLibrary.GetWorldSubsystem(world, UE.VgeInstancePool.StaticClass()) as UE.VgeInstancePool;

function primitivesAmong(components: UE.TArray<UE.ActorComponent>, keep: (component: UE.PrimitiveComponent) => boolean) {
  const found: UE.PrimitiveComponent[] = [];
  for (let index = 0; index < components.Num(); index++) {
    const component = components.Get(index);
    if (component instanceof UE.PrimitiveComponent && keep(component)) found.push(component);
  }
  return found;
}

function primitivesOf(node: HostNode, stencil: number): UE.PrimitiveComponent[] {
  if (!node.mounted) return [];
  if (node.kind === 'packed') {
    const owner = instancePool().Owner;
    if (!owner) return [];
    return primitivesAmong(owner.K2_GetComponentsByClass(UE.InstancedStaticMeshComponent.StaticClass()), (component) => component.bRenderCustomDepth && component.CustomDepthStencilValue === stencil);
  }
  if (node.object instanceof UE.Actor) return primitivesAmong(node.object.K2_GetComponentsByClass(UE.PrimitiveComponent.StaticClass()), () => true);
  if (node.object instanceof UE.PrimitiveComponent) return [node.object];
  return [];
}

function showOnly(capture: DepthCapture, primitives: UE.PrimitiveComponent[]) {
  if (primitives.length === capture.shown.length && primitives.every((primitive, index) => primitive === capture.shown[index])) return;
  const component = capture.actor.CaptureComponent2D;
  component.ClearShowOnlyComponents();
  for (const primitive of primitives) component.ShowOnlyComponent(primitive);
  capture.shown = primitives;
}

function fitToViewport(capture: DepthCapture) {
  const [width, height] = viewportSize();
  if (capture.target.SizeX !== width || capture.target.SizeY !== height) UE.KismetRenderingLibrary.ResizeRenderTarget2D(capture.target, width, height);
}

const degrees = (radians: number) => (radians * 180) / Math.PI;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

function axisConstraintOf(controller: UE.PlayerController, camera: UE.CameraComponent) {
  if (camera.bOverrideAspectRatioAxisConstraint) return camera.AspectRatioAxisConstraint;
  const player = controller.Player;
  return player instanceof UE.LocalPlayer ? player.AspectRatioAxisConstraint : UE.EAspectRatioAxisConstraint.AspectRatio_MaintainXFOV;
}

function horizontalFovOfView(controller: UE.PlayerController, camera: UE.CameraComponent, fieldOfView: number) {
  const [width, height] = viewportSize();
  const constraint = axisConstraintOf(controller, camera);
  const keepsHorizontal = constraint === UE.EAspectRatioAxisConstraint.AspectRatio_MaintainXFOV || (constraint === UE.EAspectRatioAxisConstraint.AspectRatio_MajorAxisFOV && width > height);
  if (keepsHorizontal || camera.bConstrainAspectRatio) return fieldOfView;
  const legacy = UE.KismetSystemLibrary.GetConsoleVariableBoolValue('r.UseLegacyMaintainYFOVViewMatrix');
  const halfVertical = !legacy && camera.AspectRatio !== 0 ? Math.atan(Math.tan(radians(fieldOfView) / 2) / camera.AspectRatio) : radians(fieldOfView) / 2;
  return degrees(2 * Math.atan((Math.tan(halfVertical) * width) / height));
}

function viewCamera(): { camera: UE.SceneComponent; fieldOfView: number } | undefined {
  const controller = UE.GameplayStatics.GetPlayerController(world, 0);
  const target = controller?.GetViewTarget();
  const camera = target instanceof UE.CameraActor ? target.CameraComponent : (target?.K2_GetComponentsByClass(UE.CameraComponent.StaticClass()).Get(0) as UE.CameraComponent | undefined);
  if (!camera || !controller) return undefined;
  return { camera, fieldOfView: horizontalFovOfView(controller, camera, controller.PlayerCameraManager.GetFOVAngle()) };
}

function followView(capture: DepthCapture, view: { camera: UE.SceneComponent; fieldOfView: number }) {
  const component = capture.actor.CaptureComponent2D;
  if (component.GetAttachParent() !== view.camera) component.K2_AttachToComponent(view.camera, '', UE.EAttachmentRule.SnapToTarget, UE.EAttachmentRule.SnapToTarget, UE.EAttachmentRule.KeepWorld, false);
  if (component.FOVAngle !== view.fieldOfView) component.FOVAngle = view.fieldOfView;
}

function updateCaptures() {
  if (!captures) return;
  const view = viewCamera();
  const last = editState.selection.length - 1;
  const selected = editState.selection.slice(0, Math.max(0, last)).flatMap((each) => primitivesOf(each.node, SELECTED_STENCIL));
  const active = last >= 0 ? primitivesOf(editState.selection[last].node, ACTIVE_STENCIL) : [];
  for (const [capture, primitives] of [[captures.selected, selected], [captures.active, active]] as const) {
    fitToViewport(capture);
    showOnly(capture, primitives);
    if (view) followView(capture, view);
  }
}

function blendOnly(target: UE.PostProcessVolume, material: UE.MaterialInterface) {
  const settings = target.Settings;
  const blendables = UE.NewArray(UE.WeightedBlendable);
  blendables.Add(new UE.WeightedBlendable(1, material));
  settings.WeightedBlendables = new UE.WeightedBlendables(blendables);
  target.Settings = settings;
}

function useOutlineMaterial(parent: UE.MaterialInterface) {
  if (!volume || !captures) return;
  const material = UE.KismetMaterialLibrary.CreateDynamicMaterialInstance(world, parent, 'None', UE.EMIDCreationFlags.None);
  material.SetTextureParameterValue(SELECTED_DEPTH, captures.selected.target);
  material.SetTextureParameterValue(ACTIVE_DEPTH, captures.active.target);
  blendOnly(volume, material);
}

function showOutline() {
  if (volume) return;
  captures = { selected: spawnDepthCapture(), active: spawnDepthCapture() };
  volume = spawnDeferred<UE.PostProcessVolume>(UE.PostProcessVolume.StaticClass(), (spawned) => {
    spawned.bUnbound = true;
  });
  stopWatching = onMaterial(outline, (material) => {
    const loaded = loadContent<UE.MaterialInterface>(material.path);
    if (loaded) useOutlineMaterial(loaded);
  });
}

function hideOutline() {
  stopWatching?.();
  stopWatching = undefined;
  if (volume && UE.KismetSystemLibrary.IsValid(volume)) volume.K2_DestroyActor();
  volume = undefined;
  if (captures) {
    destroyDepthCapture(captures.selected);
    destroyDepthCapture(captures.active);
  }
  captures = undefined;
}

export function showSelection() {
  showOutline();
  const selectedNodes = new Set(editState.selection.map((selected) => selected.node));
  for (const node of [...marked.keys()]) if (!selectedNodes.has(node)) clear(node);
  editState.selection.forEach((selected, index) => apply(selected, index === editState.selection.length - 1));
  updateCaptures();
}

export function hideSelection() {
  for (const node of [...marked.keys()]) clear(node);
  hideOutline();
}
