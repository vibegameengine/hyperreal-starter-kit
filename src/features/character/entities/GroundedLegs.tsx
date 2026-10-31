import type { ReactNode } from 'react';
import { param } from '../../../shared/react/anim';

const STRIDE_WARPING = '/Script/AnimationWarpingRuntime.AnimNode_StrideWarping';
const FOOT_PLACEMENT = '/Script/AnimationWarpingRuntime.AnimNode_FootPlacement';
const LEG_IK = '/Script/AnimGraphRuntime.AnimNode_LegIK';
const SIDES = ['l', 'r'] as const;

const bone = (BoneName: string) => ({ BoneName });
const pelvis = bone('pelvis');
const ikFootRoot = bone('ik_foot_root');

export interface GroundedLegsProps {
  children: ReactNode;
  speed?: string;
}

export function GroundedLegs({ children, speed = 'speed' }: GroundedLegsProps) {
  return (
    <control node={LEG_IK} LegsDefinition={SIDES.map((side) => ({ IKFootBone: bone(`ik_foot_${side}`), FKFootBone: bone(`foot_${side}`), NumBonesInLimb: 2 }))}>
      <control
        node={FOOT_PLACEMENT}
        PlantSpeedMode="Graph"
        PelvisBone={pelvis}
        IKFootRootBone={ikFootRoot}
        LegDefinitions={SIDES.map((side) => ({ FKFootBone: bone(`foot_${side}`), IKFootBone: bone(`ik_foot_${side}`), BallBone: bone(`ball_${side}`), NumBonesInLimb: 2 }))}
      >
        <control
          node={STRIDE_WARPING}
          Mode="Graph"
          LocomotionSpeed={param(speed)}
          PelvisBone={pelvis}
          IKFootRootBone={ikFootRoot}
          FootDefinitions={SIDES.map((side) => ({ IKFootBone: bone(`ik_foot_${side}`), FKFootBone: bone(`foot_${side}`), ThighBone: bone(`thigh_${side}`) }))}
        >
          {children}
        </control>
      </control>
    </control>
  );
}
