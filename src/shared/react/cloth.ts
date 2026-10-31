import * as UE from 'ue';
import { useRef } from 'react';
import { useFrame } from './hooks';

export interface ClothBehaviour {
  edgeStiffness: number;
  bendingStiffness: number;
  areaStiffness?: number;
  damping: number;
  drag: number;
  lift: number;
  collisionThickness: number;
  friction?: number;
}

const pair = (value: number) => new UE.Vector2D(value, value);

export function clothInteractor(component: UE.SkeletalMeshComponent | null | undefined, clothAsset: string) {
  return component?.GetClothingSimulationInteractor()?.GetClothingInteractor(clothAsset) as UE.ChaosClothingInteractor | undefined;
}

export function applyClothBehaviour(cloth: UE.ChaosClothingInteractor, behaviour: ClothBehaviour) {
  cloth.SetMaterial(pair(behaviour.edgeStiffness), pair(behaviour.bendingStiffness), pair(behaviour.areaStiffness ?? 1));
  cloth.SetDamping(behaviour.damping, 0);
  cloth.SetAerodynamics(behaviour.drag, behaviour.lift, new UE.Vector(0, 0, 0));
  cloth.SetCollision(behaviour.collisionThickness, behaviour.friction ?? 0.8, false, 2);
}

export function useClothBehaviour(component: () => UE.SkeletalMeshComponent | null | undefined, clothAsset: string, behaviour: ClothBehaviour) {
  const applied = useRef<{ cloth: UE.ChaosClothingInteractor; key: string } | null>(null);
  const key = JSON.stringify(behaviour);
  useFrame(() => {
    const cloth = clothInteractor(component(), clothAsset);
    if (!cloth || (applied.current?.cloth === cloth && applied.current.key === key)) return;
    applyClothBehaviour(cloth, behaviour);
    applied.current = { cloth, key };
  });
}
