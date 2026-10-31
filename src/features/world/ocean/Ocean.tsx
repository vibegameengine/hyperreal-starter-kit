import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadContent, onMaterial } from '../../../shared/engine/content';
import { world } from '../../../shared/engine/world';
import { useCompute, useContentMesh, useFrame, type ComputeInstance } from '../../../shared/react';
import grid from '../assets/ocean/grid.glb?nanite=off';
import { oceanFoamPattern, oceanLace, oceanShoreSim, oceanWaves } from '../assets/ocean/oceanWaves';
import { oceanWater } from '../assets/ocean/oceanWater';
import { CASCADES, FFT_SIZE, FOAM_PATTERN_SIZE, LACE_SIZE, SHORE_SIM_RES } from '../assets/ocean/oceanSpectrum';
import { DETAIL_RES, detailSampler, lodTable, markFinerNeighbours, NODE_FLOATS, OCEAN_LOD, selectNodes, surfDetailField, type Plane } from './lod';
import { useWake } from './useWake';
import { Breakers } from './Breakers';
import { SHORE_EXTENT, SHORE_ORIGIN } from '../assets/ocean/oceanShore';
import { computeShoreField, type ShoreDomain, type ShoreFieldData } from './shoreField';

const CM = 100;
const FRUSTUM_WIDENING = 1.15;

const target = (size: number) =>
  UE.KismetRenderingLibrary.CreateRenderTarget2D(world, size, size, UE.ETextureRenderTargetFormat.RTF_RGBA16f, new UE.LinearColor(0, 0, 0, 0), true, true);

function useTargets() {
  return useMemo(
    () => ({
      displacement: Array.from({ length: CASCADES }, () => target(FFT_SIZE)),
      derivatives: Array.from({ length: CASCADES }, () => target(FFT_SIZE)),
      foam: target(FOAM_PATTERN_SIZE),
    }),
    [],
  );
}

export interface ShoreTextures {
  ground: UE.TextureRenderTarget2D;
  field: UE.TextureRenderTarget2D;
  lace: UE.TextureRenderTarget2D;
  state: UE.TextureRenderTarget2D;
  deposit: UE.TextureRenderTarget2D;
  data: ShoreFieldData;
  detailField: Float32Array<ArrayBuffer>;
  detail: UE.TextureRenderTarget2D;
}

const floatTarget = (size: number, mips: boolean, format = UE.ETextureRenderTargetFormat.RTF_RGBA32f) =>
  UE.KismetRenderingLibrary.CreateRenderTarget2D(world, size, size, format, new UE.LinearColor(0, 0, 0, 0), mips, true);

function uploadTarget(pixels: Float32Array<ArrayBuffer>, res: number) {
  const source = UE.VgeScriptLibrary.CreateFloatTexture(res, res, pixels.buffer);
  const target = floatTarget(res, false);
  const canvas = $ref<UE.Canvas>(undefined as unknown as UE.Canvas);
  const size = $ref(new UE.Vector2D(0, 0));
  const context = $ref(new UE.DrawToRenderTargetContext());
  UE.KismetRenderingLibrary.BeginDrawCanvasToRenderTarget(world, target, canvas, size, context);
  $unref(canvas).K2_DrawTexture(source, new UE.Vector2D(0, 0), new UE.Vector2D(res, res), new UE.Vector2D(0, 0), new UE.Vector2D(1, 1), new UE.LinearColor(1, 1, 1, 1), UE.EBlendMode.BLEND_Opaque, 0, new UE.Vector2D(0, 0));
  UE.KismetRenderingLibrary.EndDrawCanvasToRenderTarget(world, $unref(context));
  return target;
}

export function useShoreTextures(domain: ShoreDomain): ShoreTextures {
  return useMemo(() => {
    const data = computeShoreField(domain);
    const detailField = surfDetailField(data.ground, data.res);
    return {
      detailField,
      detail: uploadTarget(detailField, DETAIL_RES),
      ground: uploadTarget(data.ground, data.res),
      field: uploadTarget(data.field, data.fieldRes),
      lace: floatTarget(LACE_SIZE, true, UE.ETextureRenderTargetFormat.RTF_RGBA16f),
      state: floatTarget(SHORE_SIM_RES, false, UE.ETextureRenderTargetFormat.RTF_RGBA16f),
      deposit: floatTarget(SHORE_SIM_RES, false, UE.ETextureRenderTargetFormat.RTF_RGBA16f),
      data,
    };
  }, [domain]);
}

function useShoreSim(shore: ShoreTextures | undefined) {
  const lace = useCompute(shore ? oceanLace : undefined);
  const sim = useCompute(shore ? oceanShoreSim : undefined);
  const state = useRef({ time: 0, frame: 0, started: undefined as ComputeInstance | undefined });

  useEffect(() => {
    if (!lace || !shore) return;
    lace.component.SetTexture('Lace', shore.lace);
    lace.component.Execute();
  }, [lace, shore]);

  useEffect(() => {
    if (!sim || !shore) return;
    sim.component.SetTexture('Ground', shore.ground);
    sim.component.SetTexture('Field', shore.field);
    sim.component.SetTexture('Lace', shore.lace);
    sim.component.SetTexture('State', shore.state);
    sim.component.SetTexture('Deposit', shore.deposit);
  }, [sim, shore]);

  useFrame((dt) => {
    if (!sim) return;
    const current = state.current;
    current.time = UE.GameplayStatics.GetTimeSeconds(world);
    current.frame++;
    const reset = current.started === sim ? 0 : 1;
    current.started = sim;
    sim.component.SetParam('Step', new UE.LinearColor(Math.min(dt, 0.1), current.time, current.frame % 2, reset));
    sim.component.Execute();
  });

  return state;
}

function useSurface(targets: ReturnType<typeof useTargets>, shore: ShoreTextures | undefined) {
  const [surface, setSurface] = useState<UE.MaterialInstanceDynamic>();
  useEffect(
    () =>
      onMaterial(oceanWater, (built) => {
        const parent = loadContent<UE.MaterialInterface>(built.path);
        if (!parent) return;
        const mid = UE.KismetMaterialLibrary.CreateDynamicMaterialInstance(world, parent);
        targets.displacement.forEach((texture, c) => mid.SetTextureParameterValue(`OceanDisplacement${c}`, texture));
        targets.derivatives.forEach((texture, c) => mid.SetTextureParameterValue(`OceanDerivatives${c}`, texture));
        mid.SetTextureParameterValue('OceanFoamPattern', targets.foam);
        if (shore) {
          mid.SetTextureParameterValue('OceanGround', shore.ground);
          mid.SetTextureParameterValue('OceanShore', shore.field);
          mid.SetTextureParameterValue('OceanLace', shore.lace);
          mid.SetTextureParameterValue('OceanShoreState', shore.state);
          mid.SetTextureParameterValue('OceanDetail', shore.detail);
          mid.SetScalarParameterValue('OceanShoreEnabled', 1);
        }
        setSurface(mid);
      }),
    [targets, shore],
  );
  return surface;
}

function viewPlanes(manager: UE.PlayerCameraManager): { camera: [number, number, number]; planes: Plane[] } {
  const location = manager.GetCameraLocation();
  const rotation = manager.GetCameraRotation();
  const forward = UE.KismetMathLibrary.GetForwardVector(rotation);
  const right = UE.KismetMathLibrary.GetRightVector(rotation);
  const up = UE.KismetMathLibrary.GetUpVector(rotation);
  const size = UE.WidgetLayoutLibrary.GetViewportSize(world);
  const tanH = Math.tan((manager.GetFOVAngle() * Math.PI) / 360) * FRUSTUM_WIDENING;
  const tanV = (tanH * Math.max(size.Y, 1)) / Math.max(size.X, 1);
  const camera: [number, number, number] = [location.X / CM, location.Y / CM, location.Z / CM];
  const plane = (axis: UE.Vector, tan: number, sign: number): Plane => {
    const n = [forward.X * tan + sign * axis.X, forward.Y * tan + sign * axis.Y, forward.Z * tan + sign * axis.Z];
    const length = Math.hypot(n[0], n[1], n[2]);
    const normal = [n[0] / length, n[1] / length, n[2] / length] as const;
    return { normal, distance: -(normal[0] * camera[0] + normal[1] * camera[1] + normal[2] * camera[2]) };
  };
  return { camera, planes: [plane(right, tanH, -1), plane(right, tanH, 1), plane(up, tanV, -1), plane(up, tanV, 1)] };
}

function writeInstances(component: UE.InstancedStaticMeshComponent, nodes: number[], seaLevel: number) {
  const transforms = UE.NewArray(UE.Transform);
  const data = UE.NewArray(UE.BuiltinFloat);
  for (let i = 0; i < nodes.length; i += NODE_FLOATS) {
    const size = nodes[i + 2];
    transforms.Add(UE.KismetMathLibrary.MakeTransform(new UE.Vector(nodes[i] * CM, nodes[i + 1] * CM, seaLevel), new UE.Rotator(0, 0, 0), new UE.Vector(size, size, 1)));
  }
  for (const value of nodes) data.Add(value);
  UE.VgeScriptLibrary.SetInstances(component, transforms, data);
}

export function Ocean({ seaLevel = 0, shore }: { seaLevel?: number; shore?: ShoreTextures }) {
  const mesh = useContentMesh(grid);
  const targets = useTargets();
  const surface = useSurface(targets, shore);
  const wake = useWake(shore, surface);
  useShoreSim(shore);
  const waves = useCompute(oceanWaves);
  const foam = useCompute(oceanFoamPattern);
  const instances = useRef<UE.InstancedStaticMeshComponent>(null);
  const table = useMemo(() => lodTable(OCEAN_LOD), []);
  const detail = useMemo(() => (shore ? detailSampler(shore.detailField, SHORE_ORIGIN, SHORE_EXTENT) : undefined), [shore]);
  const state = useRef({ time: 0, initialised: undefined as ComputeInstance | undefined, previous: '' });

  useEffect(() => {
    if (!waves) return;
    targets.displacement.forEach((texture, c) => waves.component.SetTexture(`Displacement${c}`, texture));
    targets.derivatives.forEach((texture, c) => waves.component.SetTexture(`Derivatives${c}`, texture));
  }, [waves, targets]);

  useEffect(() => {
    if (!foam) return;
    foam.component.SetTexture('Pattern', targets.foam);
    foam.component.Execute();
  }, [foam, targets]);

  useEffect(() => {
    if (surface && instances.current) instances.current.SetMaterial(0, surface);
  }, [surface, mesh]);

  useFrame((dt) => {
    const current = state.current;
    current.time = UE.GameplayStatics.GetTimeSeconds(world);
    if (waves) {
      waves.component.SetParam('Control', new UE.LinearColor(current.initialised === waves ? 0 : 1, dt, current.time, 0));
      waves.component.Execute();
      current.initialised = waves;
    }
    const manager = UE.GameplayStatics.GetPlayerCameraManager(world, 0);
    if (!manager || !instances.current || !mesh) return;
    const view = viewPlanes(manager);
    const nodes = selectNodes(OCEAN_LOD, table, { ...view, seaLevel: seaLevel / CM, scaledDistance: detail });
    const key = nodes.join(',');
    if (key === current.previous) return;
    current.previous = key;
    markFinerNeighbours(nodes);
    writeInstances(instances.current, nodes, seaLevel);
  });

  if (!mesh) return null;
  return (
    <>
      <instancedStaticMeshComponent ref={instances} staticMesh={mesh} numCustomDataFloats={NODE_FLOATS} mobility={UE.EComponentMobility.Movable} castShadow={false} collisionEnabled={UE.ECollisionEnabled.NoCollision} />
      {shore && <Breakers shore={shore} displacement={targets.displacement} wake={wake} />}
    </>
  );
}
