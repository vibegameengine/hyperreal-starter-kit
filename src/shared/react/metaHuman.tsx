import * as UE from 'ue';
import { useEffect, useState } from 'react';
import { onPack } from '../engine/content';
import { world } from '../engine/world';

export interface MetaHumanProps {
  pack: string;
  blueprint: string;
  retarget: string;
  target: () => UE.SkeletalMeshComponent | null | undefined;
  faceAnimation?: string;
  onReady?: (parts: Record<string, UE.SkeletalMeshComponent>) => void;
}

function partsOf(actor: UE.Actor) {
  const found = actor.K2_GetComponentsByClass(UE.SkeletalMeshComponent.StaticClass());
  const parts: Record<string, UE.SkeletalMeshComponent> = {};
  for (let index = 0; index < found.Num(); index++) {
    const part = found.Get(index) as UE.SkeletalMeshComponent;
    parts[part.GetName()] = part;
  }
  return parts;
}

export function MetaHuman({ pack, blueprint, retarget, target, faceAnimation, onReady }: MetaHumanProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => onPack(pack, () => setMounted(true)), [pack]);

  useEffect(() => {
    const driver = target();
    if (!mounted || !driver) return;
    const transform = driver.K2_GetComponentToWorld();
    const actor = UE.GameplayStatics.BeginDeferredActorSpawnFromClass(world, UE.Class.Load(blueprint), transform, UE.ESpawnActorCollisionHandlingMethod.AlwaysSpawn, undefined, UE.ESpawnActorScaleMethod.MultiplyWithRoot);
    UE.GameplayStatics.FinishSpawningActor(actor, transform, UE.ESpawnActorScaleMethod.MultiplyWithRoot);
    const parts = partsOf(actor);
    const body = parts.Body;
    if (!body) {
      console.error(`[metahuman] ${blueprint} has no Body component (parts: ${Object.keys(parts).join(', ')})`);
      return () => {
        if (UE.KismetSystemLibrary.IsValid(actor)) actor.K2_DestroyActor();
      };
    }
    body.K2_AttachToComponent(driver, 'None', UE.EAttachmentRule.SnapToTarget, UE.EAttachmentRule.SnapToTarget, UE.EAttachmentRule.KeepWorld, true);
    body.SetAnimInstanceClass(UE.Class.Load(retarget));
    driver.VisibilityBasedAnimTickOption = UE.EVisibilityBasedAnimTickOption.AlwaysTickPoseAndRefreshBones;
    driver.SetVisibility(false, false);
    if (faceAnimation && parts.Face) parts.Face.PlayAnimation(UE.Object.Load(faceAnimation) as UE.AnimationAsset, true);
    onReady?.(parts);
    return () => {
      if (UE.KismetSystemLibrary.IsValid(driver)) driver.SetVisibility(true, false);
      if (UE.KismetSystemLibrary.IsValid(actor)) actor.K2_DestroyActor();
    };
  }, [mounted]);

  return null;
}
