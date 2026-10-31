import type { ReactNode } from 'react';
import type { AnimPhysBodyDefinition, AnimPhysSphericalLimit } from '../../../shared/react/anim';
import { forceOf, gravityOf } from '../secondary-motion/useInertialDrive';
import type { BoneAxes, SoftTissueRig, TissueBone, TissueChain, TissueCollider, TissueRange, Triple } from './presets';

type Direction = keyof BoneAxes;
const DIRECTIONS: readonly Direction[] = ['along', 'up', 'side'];
const AXIS_NAMES = ['AxisX', 'AxisY', 'AxisZ'] as const;

function onAxes(axes: BoneAxes, values: Record<Direction, number>): Triple {
  const vector: [number, number, number] = [0, 0, 0];
  for (const direction of DIRECTIONS) vector[axes[direction][0]] = axes[direction][1] * values[direction];
  return vector;
}

function boundsOnAxes(axes: BoneAxes, range: TissueRange) {
  const lower: [number, number, number] = [0, 0, 0];
  const upper: [number, number, number] = [0, 0, 0];
  for (const direction of DIRECTIONS) {
    const [axis, sign] = axes[direction];
    const ends = range[direction].map((end) => sign * end);
    lower[axis] = Math.min(...ends);
    upper[axis] = Math.max(...ends);
  }
  return { lower, upper };
}

function bodyOf(axes: BoneAxes, tissue: TissueBone): AnimPhysBodyDefinition {
  const linear = boundsOnAxes(axes, tissue.linear);
  const angular = boundsOnAxes(axes, tissue.angularDegrees);
  const alongAxis = axes.along[0];
  return {
    boundBone: tissue.bone,
    boxExtents: [tissue.extents, tissue.extents, tissue.extents],
    localJointOffset: onAxes(axes, { along: tissue.centerAlong, up: 0, side: 0 }),
    collisionType: 'CoM',
    constraintSetup: {
      linearXLimitType: 'Limited',
      linearYLimitType: 'Limited',
      linearZLimitType: 'Limited',
      linearAxesMin: linear.lower,
      linearAxesMax: linear.upper,
      angularConstraintType: 'Angular',
      twistAxis: AXIS_NAMES[alongAxis],
      angularTargetAxis: AXIS_NAMES[alongAxis],
      angularTarget: [0, 1, 2].map((axis) => (axis === alongAxis ? 1 : 0)) as unknown as Triple,
      angularLimitsMin: angular.lower,
      angularLimitsMax: angular.upper,
    },
  };
}

const colliderOf = (collider: TissueCollider): AnimPhysSphericalLimit => ({
  drivingBone: collider.bone,
  sphereLocalOffset: collider.offset,
  limitRadius: collider.radius,
  limitType: 'Outer',
});

export interface SoftTissueTuning {
  strength: number;
  stiffness: number;
  decayPerSecond?: number;
}

const dampingForDecay = (decayPerSecond: number) => 1 - Math.exp(-decayPerSecond);

interface TissueNodeProps {
  rig: SoftTissueRig;
  chain: TissueChain;
  tissue: TissueBone;
  tuning: SoftTissueTuning;
  children: ReactNode;
}

function TissueNode({ rig, chain, tissue, tuning, children }: TissueNodeProps) {
  const damping = dampingForDecay(tuning.decayPerSecond ?? tissue.decayPerSecond);
  return (
    <animDynamics
      boundBone={tissue.bone}
      physicsBodyDefinitions={[bodyOf(chain.axes, tissue)]}
      simulationSpace="BoneRelative"
      relativeSpaceBone={chain.spaceBone}
      simSpaceSettings={{ simSpaceAngularAlpha: 0 }}
      externalForce={forceOf(tissue.bone)}
      useGravityOverride
      gravityOverrideInSimSpace
      gravityOverride={gravityOf(tissue.bone)}
      alpha={tuning.strength}
      linearSpring={tissue.spring > 0}
      linearSpringConstant={tissue.spring * tuning.stiffness}
      angularSpring
      angularSpringConstant={tissue.angularSpring * tuning.stiffness}
      overrideLinearDamping
      linearDampingOverride={damping}
      overrideAngularDamping
      angularDampingOverride={damping}
      useSphericalLimits={chain.colliders.length > 0}
      sphericalLimits={chain.colliders.map(colliderOf)}
      usePlanarLimit={false}
    >
      {children}
    </animDynamics>
  );
}

export interface SoftTissueProps {
  rig: SoftTissueRig;
  tuning?: SoftTissueTuning;
  children: ReactNode;
}

export const softTissueBones = (rig: SoftTissueRig) => rig.chains.flatMap((chain) => chain.bones.map((tissue) => tissue.bone));

export function SoftTissue({ rig, tuning = { strength: 1, stiffness: 1 }, children }: SoftTissueProps) {
  const tissues = rig.chains.flatMap((chain) => chain.bones.map((tissue) => ({ chain, tissue })));
  return tissues.reduce<ReactNode>(
    (pose, { chain, tissue }) => (
      <TissueNode key={tissue.bone} rig={rig} chain={chain} tissue={tissue} tuning={tuning}>
        {pose}
      </TissueNode>
    ),
    children,
  );
}
