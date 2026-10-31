import * as UE from 'ue';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadContent, onMaterial } from '../../../shared/engine/content';
import { world } from '../../../shared/engine/world';
import { useCompute, useContentMesh, useFrame } from '../../../shared/react';
import grid from '../assets/ocean/grid.glb';
import { oceanFoamPattern, oceanWaves } from '../assets/ocean/ocean.compute';
import { oceanWater } from '../assets/ocean/ocean.material';
import { CASCADES, FFT_SIZE, FOAM_PATTERN_SIZE } from '../assets/ocean/oceanSpectrum';
import { lodTable, NODE_FLOATS, OCEAN_LOD, selectNodes, type Plane } from './lod';

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

function useSurface(targets: ReturnType<typeof useTargets>) {
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
        setSurface(mid);
      }),
    [targets],
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

export function Ocean({ seaLevel = 0 }: { seaLevel?: number }) {
  const mesh = useContentMesh(grid);
  const targets = useTargets();
  const surface = useSurface(targets);
  const waves = useCompute(oceanWaves);
  const foam = useCompute(oceanFoamPattern);
  const instances = useRef<UE.InstancedStaticMeshComponent>(null);
  const table = useMemo(() => lodTable(OCEAN_LOD), []);
  const state = useRef({ time: 0, initialised: undefined as UE.VgeComputeComponent | undefined, previous: '' });

  useEffect(() => {
    if (!waves) return;
    targets.displacement.forEach((texture, c) => waves.SetTexture(`Displacement${c}`, texture));
    targets.derivatives.forEach((texture, c) => waves.SetTexture(`Derivatives${c}`, texture));
    state.current.initialised = undefined;
  }, [waves, targets]);

  useEffect(() => {
    if (!foam) return;
    foam.SetTexture('Pattern', targets.foam);
    foam.Execute();
  }, [foam, targets]);

  useEffect(() => {
    if (surface && instances.current) instances.current.SetMaterial(0, surface);
  }, [surface, mesh]);

  useFrame((dt) => {
    const current = state.current;
    current.time += dt;
    if (waves) {
      waves.SetParam('Control', new UE.LinearColor(current.initialised === waves ? 0 : 1, dt, current.time, 0));
      waves.Execute();
      current.initialised = waves;
    }
    const manager = UE.GameplayStatics.GetPlayerCameraManager(world, 0);
    if (!manager || !instances.current || !mesh) return;
    const view = viewPlanes(manager);
    const nodes = selectNodes(OCEAN_LOD, table, { ...view, seaLevel: seaLevel / CM });
    const key = nodes.join(',');
    if (key === current.previous) return;
    current.previous = key;
    writeInstances(instances.current, nodes, seaLevel);
  });

  if (!mesh) return null;
  return <instancedStaticMeshComponent ref={instances} staticMesh={mesh} numCustomDataFloats={NODE_FLOATS} mobility={UE.EComponentMobility.Movable} castShadow={false} collisionEnabled={UE.ECollisionEnabled.NoCollision} />;
}
