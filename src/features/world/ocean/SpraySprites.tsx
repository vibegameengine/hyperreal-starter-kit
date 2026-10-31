import * as UE from 'ue';
import { useEffect, useRef, useState } from 'react';
import { loadContent, onMaterial } from '../../../shared/engine/content';
import { world } from '../../../shared/engine/world';
import { useContentMesh } from '../../../shared/react';
import { SEA_LEVEL } from '../assets/coastShape';
import { sprayParticles } from '../assets/ocean/sprayParticles';
import { SPRAY_TOTAL } from '../assets/ocean/spraySpec';
import sprite from '../assets/ocean/spray.glb?nanite=off';
import type { SprayTargets } from './sprayTargets';

const SPRITE_SORT_PRIORITY = 1;

function useSprayMaterial(targets: SprayTargets, crest: UE.TextureRenderTarget2D) {
  const [material, setMaterial] = useState<UE.MaterialInstanceDynamic>();
  useEffect(
    () =>
      onMaterial(sprayParticles, (built) => {
        const parent = loadContent<UE.MaterialInterface>(built.path);
        if (!parent) return;
        const mid = UE.KismetMaterialLibrary.CreateDynamicMaterialInstance(world, parent);
        mid.SetTextureParameterValue('SprayPos', targets.pos);
        mid.SetTextureParameterValue('SprayVel', targets.vel);
        mid.SetTextureParameterValue('SprayInfo', targets.info);
        mid.SetTextureParameterValue('BreakerCrest', crest);
        mid.SetTextureParameterValue('SprayPuff', targets.puff);
        mid.SetTextureParameterValue('SprayDots', targets.dots);
        setMaterial(mid);
      }),
    [targets, crest],
  );
  return material;
}

function writeSpriteInstances(component: UE.InstancedStaticMeshComponent) {
  const transforms = UE.NewArray(UE.Transform);
  const data = UE.NewArray(UE.BuiltinFloat);
  const at = UE.KismetMathLibrary.MakeTransform(new UE.Vector(0, 0, SEA_LEVEL), new UE.Rotator(0, 0, 0), new UE.Vector(1, 1, 1));
  for (let i = 0; i < SPRAY_TOTAL; i++) {
    transforms.Add(at);
    data.Add(i);
  }
  UE.VgeScriptLibrary.SetInstances(component, transforms, data);
}

export function SpraySprites({ targets, crest }: { targets: SprayTargets; crest: UE.TextureRenderTarget2D }) {
  const mesh = useContentMesh(sprite);
  const material = useSprayMaterial(targets, crest);
  const instances = useRef<UE.InstancedStaticMeshComponent>(null);

  useEffect(() => {
    if (!instances.current || !mesh) return;
    writeSpriteInstances(instances.current);
    if (material) instances.current.SetMaterial(0, material);
  }, [mesh, material]);

  if (!mesh) return null;
  return (
    <instancedStaticMeshComponent
      ref={instances}
      staticMesh={mesh}
      numCustomDataFloats={1}
      mobility={UE.EComponentMobility.Movable}
      castShadow={false}
      translucencySortPriority={SPRITE_SORT_PRIORITY}
      collisionEnabled={UE.ECollisionEnabled.NoCollision}
    />
  );
}
