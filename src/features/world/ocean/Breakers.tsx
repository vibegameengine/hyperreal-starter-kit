import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadContent, onMaterial } from '../../../shared/engine/content';
import { world } from '../../../shared/engine/world';
import { useCompute, useContentMesh, useFrame } from '../../../shared/react';
import { SEA_LEVEL } from '../assets/coastShape';
import { BREAKER_CAPACITY, CREST_COLUMNS, CREST_ROWS, CREST_TEXELS, STATION_RES } from '../assets/ocean/breakerSpec';
import { oceanBreakerCrests, oceanBreakerFade } from '../assets/ocean/breakers.compute';
import { breakerLip } from '../assets/ocean/breakers.material';
import lip from '../assets/ocean/lip.glb';
import { SPRAY_EMIT_RANGE } from '../assets/ocean/spraySpec';
import { buildBreakerStations, type BreakerStations } from './breakerStations';
import type { ShoreTextures } from './Ocean';
import { SpraySprites } from './SpraySprites';
import { useBreakerSpray } from './useBreakerSpray';
import type { WakeSurface } from './useWake';

const CM = 100;
const SPRAY_GAIN = 0.5;
const CREST_PASS_PRIORITY = 20;
const SLOTS = 2;
const INSTANCE_FLOATS = 2;

const floatTarget = (width: number, height: number) =>
  UE.KismetRenderingLibrary.CreateRenderTarget2D(world, width, height, UE.ETextureRenderTargetFormat.RTF_RGBA32f, new UE.LinearColor(0, 0, 0, 0), false, true);

function uploadStations(stations: BreakerStations) {
  const pixels = new Float32Array(STATION_RES * STATION_RES * 4);
  pixels.set(stations.data.subarray(0, Math.min(stations.data.length, pixels.length)));
  const source = UE.VgeScriptLibrary.CreateFloatTexture(STATION_RES, STATION_RES, pixels.buffer);
  const target = floatTarget(STATION_RES, STATION_RES);
  const canvas = $ref<UE.Canvas>(undefined as unknown as UE.Canvas);
  const size = $ref(new UE.Vector2D(0, 0));
  const context = $ref(new UE.DrawToRenderTargetContext());
  UE.KismetRenderingLibrary.BeginDrawCanvasToRenderTarget(world, target, canvas, size, context);
  $unref(canvas).K2_DrawTexture(source, new UE.Vector2D(0, 0), new UE.Vector2D(STATION_RES, STATION_RES), new UE.Vector2D(0, 0), new UE.Vector2D(1, 1), new UE.LinearColor(1, 1, 1, 1), UE.EBlendMode.BLEND_Opaque, 0, new UE.Vector2D(0, 0));
  UE.KismetRenderingLibrary.EndDrawCanvasToRenderTarget(world, $unref(context));
  return target;
}

function useBreakerTargets(shore: ShoreTextures) {
  return useMemo(() => {
    const stations = buildBreakerStations(shore.data, BREAKER_CAPACITY);
    return {
      stations,
      stationTexture: uploadStations(stations),
      crest: floatTarget(CREST_COLUMNS * CREST_TEXELS, CREST_ROWS),
      fade: floatTarget(STATION_RES, STATION_RES),
    };
  }, [shore]);
}

function useLipMaterial(crest: UE.TextureRenderTarget2D, fade: UE.TextureRenderTarget2D, lace: UE.TextureRenderTarget2D) {
  const [material, setMaterial] = useState<UE.MaterialInstanceDynamic>();
  useEffect(
    () =>
      onMaterial(breakerLip, (built) => {
        const parent = loadContent<UE.MaterialInterface>(built.path);
        if (!parent) return;
        const mid = UE.KismetMaterialLibrary.CreateDynamicMaterialInstance(world, parent);
        mid.SetTextureParameterValue('BreakerCrest', crest);
        mid.SetTextureParameterValue('BreakerFade', fade);
        mid.SetTextureParameterValue('BreakerLace', lace);
        setMaterial(mid);
      }),
    [crest, fade, lace],
  );
  return material;
}

function writeLipInstances(component: UE.InstancedStaticMeshComponent, stations: BreakerStations) {
  const transforms = UE.NewArray(UE.Transform);
  const data = UE.NewArray(UE.BuiltinFloat);
  for (const segment of stations.segments) {
    const at = new UE.Vector(stations.data[segment * 4] * CM, stations.data[segment * 4 + 1] * CM, SEA_LEVEL);
    for (let slot = 0; slot < SLOTS; slot++) {
      transforms.Add(UE.KismetMathLibrary.MakeTransform(at, new UE.Rotator(0, 0, 0), new UE.Vector(1, 1, 1)));
      data.Add(segment);
      data.Add(slot);
    }
  }
  UE.VgeScriptLibrary.SetInstances(component, transforms, data);
}

function sprayEmitterParam(dt: number) {
  const manager = UE.GameplayStatics.GetPlayerCameraManager(world, 0);
  const eye = manager ? manager.GetCameraLocation() : new UE.Vector(0, 0, 0);
  return new UE.LinearColor(eye.X / CM, eye.Z / CM, eye.Y / CM, dt);
}

export function Breakers({ shore, displacement, wake }: { shore: ShoreTextures; displacement: UE.TextureRenderTarget2D[]; wake: WakeSurface }) {
  const mesh = useContentMesh(lip);
  const targets = useBreakerTargets(shore);
  const material = useLipMaterial(targets.crest, targets.fade, shore.lace);
  const crests = useCompute(oceanBreakerCrests);
  const fades = useCompute(oceanBreakerFade);
  const spray = useBreakerSpray(shore, displacement, wake);
  const instances = useRef<UE.InstancedStaticMeshComponent>(null);
  const frame = useRef(0);

  useEffect(() => {
    if (!crests) return;
    crests.component.SetTexture('Ground', shore.ground);
    crests.component.SetTexture('Field', shore.field);
    crests.component.SetTexture('Stations', targets.stationTexture);
    crests.component.SetTexture('Crest', targets.crest);
    crests.component.SetTexture('Head', spray.targets.head);
    crests.component.SetTexture('Emit', spray.targets.emit);
    displacement.forEach((texture, c) => crests.component.SetTexture(`Displacement${c}`, texture));
    crests.component.SetSortPriority(CREST_PASS_PRIORITY);
  }, [crests, shore, targets, displacement, spray.targets]);

  useEffect(() => {
    if (!fades) return;
    fades.component.SetTexture('Crest', targets.crest);
    fades.component.SetTexture('Fade', targets.fade);
    fades.component.SetSortPriority(CREST_PASS_PRIORITY + 1);
  }, [fades, targets]);

  useEffect(() => {
    if (!instances.current || !mesh) return;
    writeLipInstances(instances.current, targets.stations);
    if (material) instances.current.SetMaterial(0, material);
  }, [mesh, material, targets]);

  useFrame((dt) => {
    if (!crests) return;
    const time = UE.GameplayStatics.GetTimeSeconds(world);
    const seed = ++frame.current;
    const control = new UE.LinearColor(time, targets.stations.count, 0, 0);
    crests.component.SetParam('Control', control);
    crests.component.SetParam('SprayEmitter', sprayEmitterParam(dt));
    crests.component.SetParam('SprayGain', new UE.LinearColor(SPRAY_GAIN, SPRAY_EMIT_RANGE, seed, 0));
    crests.component.Execute();
    spray.step({ time, dt, seed, stations: targets.stations.count });
    if (!fades) return;
    fades.component.SetParam('Control', control);
    fades.component.Execute();
  });

  return (
    <>
      {mesh && <instancedStaticMeshComponent ref={instances} staticMesh={mesh} numCustomDataFloats={INSTANCE_FLOATS} mobility={UE.EComponentMobility.Movable} castShadow={false} collisionEnabled={UE.ECollisionEnabled.NoCollision} />}
      <SpraySprites targets={spray.targets} crest={targets.crest} />
    </>
  );
}
