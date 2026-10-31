import type * as UE from 'ue';
import { useMemo, type RefObject } from 'react';
import { useInertialDrive, type DrivenNode, type Vector3 } from '../secondary-motion/useInertialDrive';
import type { BoneAxes, SoftTissueRig, TissueBone, TissueResponse } from './presets';

function responseOnBoneAxes(axes: BoneAxes, response: TissueResponse): Vector3 {
  const weights: Vector3 = [0, 0, 0];
  for (const direction of ['along', 'up', 'side'] as const) weights[axes[direction][0]] = response[direction];
  return weights;
}

const maxPushFor = (tissue: TissueBone) =>
  tissue.maxSwingDegrees && tissue.centerAlong > 0 ? (tissue.angularSpring * tissue.maxSwingDegrees * Math.PI) / 180 / tissue.centerAlong : undefined;

export const softTissueNodes = (rig: SoftTissueRig): DrivenNode[] =>
  rig.chains.flatMap((chain) =>
    chain.bones.map((tissue) => ({ key: tissue.bone, pointBone: tissue.bone, spaceBone: chain.spaceBone, responseOnBoneAxes: responseOnBoneAxes(chain.axes, tissue.response), gravityScale: rig.gravityScale, maxPush: maxPushFor(tissue) })),
  );

export function useSoftTissueDrive(body: RefObject<UE.SkeletalMeshComponent | null>, rig: SoftTissueRig, response: number) {
  const nodes = useMemo(() => softTissueNodes(rig), [rig]);
  return useInertialDrive(body, nodes, { response: rig.bounce * response, accelerationClamp: rig.accelerationClamp });
}
