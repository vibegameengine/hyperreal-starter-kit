import * as UE from 'ue';
import { clothInteractor, type ClothBehaviour } from '../../../../shared/react';

export const CLOTH_ASSET = 'Cloth_Cloth';

export const FABRICS = {
  silk: { edgeStiffness: 0.6, bendingStiffness: 0.01, areaStiffness: 0.6 },
  cotton: { edgeStiffness: 1, bendingStiffness: 0.1, areaStiffness: 1 },
  canvas: { edgeStiffness: 1, bendingStiffness: 0.8, areaStiffness: 1 },
} as const;

export type Fabric = keyof typeof FABRICS;

export const FLAG_CLOTH: ClothBehaviour = { edgeStiffness: 0.8, bendingStiffness: 0.05, damping: 0.02, drag: 0.1, lift: 0.08, collisionThickness: 1.5 };
export const CURTAIN_CLOTH: ClothBehaviour = { edgeStiffness: 1, bendingStiffness: 0.3, damping: 0.04, drag: 0.06, lift: 0.03, collisionThickness: 2, friction: 0.6 };
export const CAPE_CLOTH: ClothBehaviour = { edgeStiffness: 1, bendingStiffness: 0.2, damping: 0.05, drag: 0.08, lift: 0.04, collisionThickness: 2.5, friction: 0.4 };

export const woven = (behaviour: ClothBehaviour, fabric: Fabric): ClothBehaviour => ({ ...behaviour, ...FABRICS[fabric] });

export function blowWind(component: UE.SkeletalMeshComponent | undefined, velocity: UE.Vector) {
  clothInteractor(component, CLOTH_ASSET)?.SetWind(new UE.Vector2D(0.1, 0.1), new UE.Vector2D(0.08, 0.08), 1.225e-6, velocity);
}

export function clothStats(component: UE.SkeletalMeshComponent | undefined) {
  const simulation = component?.GetClothingSimulationInteractor();
  if (!simulation || !clothInteractor(component, CLOTH_ASSET)) return undefined;
  return { cloths: simulation.GetNumCloths(), dynamic: simulation.GetNumDynamicParticles(), kinematic: simulation.GetNumKinematicParticles(), iterations: simulation.GetNumIterations(), simulationMs: simulation.GetSimulationTime() };
}
