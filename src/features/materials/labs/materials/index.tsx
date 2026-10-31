import * as UE from 'ue';
import { useEffect, useRef, useState } from 'react';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { world } from '../../../../shared/engine/world';
import { useHudMessages, useHudState } from '../../../../shared/react';
import { instance, type MaterialTuple } from '../../../../shared/material';
import lava, { cooled } from '../../assets/lava';


const CUBE = '/Engine/BasicShapes/Cube.Cube';
const SPHERE = '/Engine/BasicShapes/Sphere.Sphere';

function describeMaterial(material: UE.MaterialInterface | null | undefined) {
  if (!material) return null;
  const parent = material instanceof UE.MaterialInstance ? material.Parent : undefined;
  const base = material.GetBaseMaterial();
  const scalar = (name: string) =>
    material instanceof UE.MaterialInstanceDynamic || material instanceof UE.MaterialInstanceConstant ? material.K2_GetScalarParameterValue(name) : undefined;
  return {
    class: material.GetClass().GetName(),
    path: UE.KismetSystemLibrary.GetPathName(material),
    parent: parent ? UE.KismetSystemLibrary.GetPathName(parent) : null,
    base: base ? UE.KismetSystemLibrary.GetPathName(base) : null,
    glowStrength: scalar('glowStrength'),
  };
}

function packedGroups() {
  const pool = UE.SubsystemBlueprintLibrary.GetWorldSubsystem(world, UE.VgeInstancePool.StaticClass()) as UE.VgeInstancePool;
  const groups: { mesh: string; instances: number; material: ReturnType<typeof describeMaterial> }[] = [];
  const components = pool.Owner ? pool.Owner.K2_GetComponentsByClass(UE.InstancedStaticMeshComponent.StaticClass()) : undefined;
  for (let j = 0; j < (components?.Num() ?? 0); j++) {
    const ism = components!.Get(j) as UE.InstancedStaticMeshComponent;
    const material = ism.GetMaterial(0);
    if (!material || !UE.KismetSystemLibrary.GetPathName(material).includes('/VgeLive/') || ism.GetInstanceCount() === 0) continue;
    groups.push({ mesh: ism.StaticMesh ? ism.StaticMesh.GetName() : '', instances: ism.GetInstanceCount(), material: describeMaterial(material) });
  }
  return groups;
}

export function Scene() {
  const [glow, setGlow] = useState(30);
  const [tint, setTint] = useState<MaterialTuple>([0.15, 0.55, 1]);
  const sphere = useRef<UE.StaticMeshComponent>(null);

  useHudMessages((message) => {
    if (message.type === 'materials/glow') setGlow(Number(message.strength));
    if (message.type === 'materials/tint' && Array.isArray(message.color)) setTint(message.color as MaterialTuple);
  });
  useHudState('materials/state', () => ({ glow, tint, sphere: describeMaterial(sphere.current?.GetMaterial(0)), packed: packedGroups() }));

  useEffect(() => {
    const lab = {
      setGlow,
      setTint,
      sphere: () => sphere.current,
      report: () => ({
        sphere: describeMaterial(sphere.current?.GetMaterial(0)),
        packed: packedGroups(),
      }),
    };
    (globalThis as any).materialsLab = lab;
    return () => {
      if ((globalThis as any).materialsLab === lab) delete (globalThis as any).materialsLab;
    };
  }, []);

  return (
    <>
      <LabStage groundSize={10} camera={{ location: [-430, 0, 170], rotation: [-14, 0, 0] }} />
      <staticMeshComponent location={[0, -170, 60]} staticMesh={CUBE} overrideMaterials={[lava]} />
      <staticMeshComponent ref={sphere} location={[0, 0, 60]} staticMesh={SPHERE} overrideMaterials={[instance(lava, { glowStrength: glow, glowColor: tint })]} />
      <staticMeshComponent location={[0, 170, 60]} staticMesh={CUBE} overrideMaterials={[cooled]} />
    </>
  );
}
