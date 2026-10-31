import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { isLive, world } from '../../../shared/engine/world';
import { useFrame } from '../../../shared/react';
import { valleyHeight } from '../assets/valleyShape';
import { FLAT_SECONDS, frontRadius, RISE_SECONDS, riseAt } from './field';

export interface GrowthFront {
  x: number;
  y: number;
  radius: number;
  active: boolean;
}

const GrowthContext = createContext<GrowthFront | null>(null);

export const useGrowthFront = () => useContext(GrowthContext);

function landscapes() {
  const found = $ref(UE.NewArray(UE.Actor));
  UE.GameplayStatics.GetAllActorsOfClass(world, UE.LandscapeProxy.StaticClass(), found);
  const list = $unref(found);
  return Array.from({ length: list.Num() }, (_, i) => list.Get(i) as UE.LandscapeProxy);
}

function useGrassMaterials() {
  const fed = useMemo(() => new Map<UE.MaterialInterface, UE.MaterialInstanceDynamic>(), []);
  const ours = useMemo(() => new Set<UE.MaterialInterface>(), []);
  const originals = useMemo(() => new Map<UE.GrassInstancedStaticMeshComponent, UE.MaterialInterface>(), []);
  useEffect(
    () => () => {
      for (const [grass, original] of originals) if (isLive(grass)) grass.SetMaterial(0, original);
    },
    [],
  );
  return (landscape: UE.LandscapeProxy) => {
    const components = landscape.K2_GetComponentsByClass(UE.GrassInstancedStaticMeshComponent.StaticClass());
    for (let i = 0; i < components.Num(); i++) {
      const grass = components.Get(i) as UE.GrassInstancedStaticMeshComponent;
      const current = grass.GetMaterial(0);
      if (!current || ours.has(current)) continue;
      let material = fed.get(current);
      if (!material) {
        material = UE.KismetMaterialLibrary.CreateDynamicMaterialInstance(world, current);
        fed.set(current, material);
        ours.add(material);
      }
      originals.set(grass, current);
      grass.SetMaterial(0, material);
    }
    return fed.values();
  };
}

const exec = (command: string) => UE.KismetSystemLibrary.ExecuteConsoleCommand(world, command, undefined);

function useGrassAfterRise() {
  const state = useMemo(() => ({ held: false }), []);
  useEffect(() => () => exec('grass.Enable 1'), []);
  return (seconds: number) => {
    const rising = seconds < FLAT_SECONDS + RISE_SECONDS;
    if (rising && !state.held) exec('grass.Enable 0');
    if (!rising && state.held) {
      exec('grass.Enable 1');
      exec('grass.FlushCache');
    }
    state.held = rising;
  };
}

export function Growth({ children }: { children?: ReactNode }) {
  const front = useMemo<GrowthFront>(() => ({ x: 0, y: 0, radius: 0, active: false }), []);
  const clock = useMemo(() => ({ seconds: 0, floor: 0 }), []);
  const grassMaterials = useGrassMaterials();
  const grassAfterRise = useGrassAfterRise();

  useFrame((deltaSeconds) => {
    const pawn = UE.GameplayStatics.GetPlayerPawn(world, 0);
    if (!pawn) return;
    if (!front.active) {
      const at = pawn.K2_GetActorLocation();
      Object.assign(front, { x: at.X, y: at.Y, active: true });
      clock.floor = valleyHeight(at.X, at.Y);
    }
    grassAfterRise(clock.seconds);
    front.radius = frontRadius(clock.seconds);
    const wave = new UE.LinearColor(front.x, front.y, front.radius, 0);
    for (const landscape of landscapes()) {
      landscape.SetLandscapeMaterialScalarParameterValue('RiseFloor', clock.floor);
      landscape.SetLandscapeMaterialScalarParameterValue('Rise', riseAt(clock.seconds));
      landscape.SetLandscapeMaterialVectorParameterValue('GrowthFront', wave);
      for (const material of grassMaterials(landscape)) material.SetVectorParameterValue('GrowthFront', wave);
    }
    clock.seconds += deltaSeconds;
  });

  return <GrowthContext.Provider value={front}>{children}</GrowthContext.Provider>;
}
