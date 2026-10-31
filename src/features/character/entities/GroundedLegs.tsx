import type { ReactNode } from 'react';

const GROUNDED_LEGS = '/Script/VibeGameEngine.VgeAnimNode_GroundedLegs';
const STRIDE_LEGS = '/Script/VibeGameEngine.VgeAnimNode_StrideLegs';

export interface LegBones {
  foot: string;
  ball: string;
}

export interface GroundedSkeleton {
  pelvis: string;
  root: string;
  legs: readonly LegBones[];
}

export const MANNY_LEGS: GroundedSkeleton = {
  pelvis: 'pelvis',
  root: 'root',
  legs: [
    { foot: 'foot_l', ball: 'ball_l' },
    { foot: 'foot_r', ball: 'ball_r' },
  ],
};

const bone = (BoneName: string) => ({ BoneName });

export interface GroundedLegsProps {
  skeleton?: GroundedSkeleton;
  children: ReactNode;
}

export function GroundedLegs({ skeleton = MANNY_LEGS, children }: GroundedLegsProps) {
  return (
    <control
      node={GROUNDED_LEGS}
      PlantSpeedMode="Graph"
      PelvisSettings={{ MaxOffset: 250, LinearStiffness: 100, LinearDamping: 1, HorizontalRebalancingWeight: 0.3, MaxOffsetHorizontal: 10, HeelLiftRatio: 0.5, PelvisHeightMode: 'AllLegs', ActorMovementCompensationMode: 'SuddenMotionOnly', bEnableInterpolation: true, bDisablePelvisOffsetInAir: true }}
      PlantSettings={{ SpeedThreshold: 60, DistanceToGround: 10, LockType: 'PivotAroundBall', UnplantRadius: 20, ReplantRadiusRatio: 0.2, UnplantAngle: 60, ReplantAngleRatio: 0.2, MaxExtensionRatio: 0.5, MinExtensionRatio: 0.2, SeparatingDistance: 0, UnalignmentSpeedThreshold: 200, AnkleTwistReduction: 0.75 }}
      InterpolationSettings={{ UnplantLinearStiffness: 200, UnplantLinearDamping: 1, UnplantAngularStiffness: 179, UnplantAngularDamping: 1, SeparationStiffness: 1000, SeparationDamping: 1, FloorLinearStiffness: 1000, FloorLinearDamping: 1, FloorAngularStiffness: 450, FloorAngularDamping: 1, bEnableFloorInterpolation: true }}
      TraceSettings={{ StartOffset: -75, EndOffset: 100, SweepRadius: 5, MaxGroundPenetration: 20 }}
      PelvisBone={bone(skeleton.pelvis)}
      IKFootRootBone={bone(skeleton.root)}
      LegDefinitions={skeleton.legs.map((leg) => ({ FKFootBone: bone(leg.foot), IKFootBone: bone(leg.foot), BallBone: bone(leg.ball), NumBonesInLimb: 2 }))}
    >
      <control
        node={STRIDE_LEGS}
        Mode="Graph"
        MinRootMotionSpeedThreshold={50}
        StrideScaleModifier={{ bClampResult: true, ClampMin: 0.5, ClampMax: 1.5, bInterpResult: true, InterpSpeedIncreasing: 10, InterpSpeedDecreasing: 10 }}
        PelvisBone={bone(skeleton.pelvis)} IKFootRootBone={bone(skeleton.root)} FootDefinitions={skeleton.legs.map((leg) => ({ IKFootBone: bone(leg.foot), FKFootBone: bone(leg.foot) }))}>
        {children}
      </control>
    </control>
  );
}
