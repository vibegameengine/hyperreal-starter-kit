import * as UE from 'ue';
import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import type { AnimPhysBodyDefinition } from '../../../shared/react/anim';
import { useFrame } from '../../../shared/react';
import { forceOf, gravityOf, useInertialDrive, type DrivenNode } from '../secondary-motion/useInertialDrive';
import type { DanglerChain, DanglerRig } from './presets';

const ALONG_AFTER_FBX_IMPORT = -1;

export type LinkLengths = ReadonlyMap<string, number>;

function bodyOf(bone: string, length: number, chain: DanglerChain): AnimPhysBodyDefinition {
  const { swingDegrees, thickness } = chain.tuning;
  return {
    boundBone: bone,
    boxExtents: [thickness, length, thickness],
    localJointOffset: [0, (ALONG_AFTER_FBX_IMPORT * length) / 2, 0],
    collisionType: 'CoM',
    constraintSetup: {
      linearXLimitType: 'Limited',
      linearYLimitType: 'Limited',
      linearZLimitType: 'Limited',
      linearAxesMin: [0, 0, 0],
      linearAxesMax: [0, 0, 0],
      angularConstraintType: 'Angular',
      twistAxis: 'AxisY',
      angularTargetAxis: 'AxisY',
      angularTarget: [0, 1, 0],
      angularLimitsMin: [-swingDegrees, 0, -swingDegrees],
      angularLimitsMax: [swingDegrees, 0, swingDegrees],
    },
  };
}

function linkLengthsOf(component: UE.SkeletalMeshComponent, rig: DanglerRig): Map<string, number> {
  const lengths = new Map<string, number>();
  for (const each of rig.chains) {
    each.bones.forEach((bone, index) => {
      const next = each.bones[index + 1];
      const translation = next ? component.GetRefPoseTransform(component.GetBoneIndex(next)).Translation : undefined;
      lengths.set(bone, translation ? Math.hypot(translation.X, translation.Y, translation.Z) : each.tuning.tipLength);
    });
  }
  return lengths;
}

export function useLinkLengths(body: RefObject<UE.SkeletalMeshComponent | null>, rig: DanglerRig) {
  const [lengths, setLengths] = useState<LinkLengths>();
  useFrame(() => {
    const component = body.current;
    if (lengths || !component || component.GetBoneIndex(rig.chains[0].bones[0]) < 0) return;
    setLengths(linkLengthsOf(component, rig));
  });
  return lengths;
}

const linksOf = (rig: DanglerRig) => rig.chains.flatMap((chain) => chain.bones.map((bone) => ({ bone, chain })));

export function useDanglerDrive(body: RefObject<UE.SkeletalMeshComponent | null>, rig: DanglerRig, response: number) {
  const nodes = useMemo<DrivenNode[]>(
    () =>
      linksOf(rig).map(({ bone, chain }) => {
        const inertia = chain.tuning.inertiaScale;
        return { key: bone, pointBone: bone, spaceBone: chain.spaceBone, responseOnBoneAxes: [inertia, inertia, inertia] as [number, number, number], gravityScale: chain.tuning.gravityScale };
      }),
    [rig],
  );
  return useInertialDrive(body, nodes, { response: rig.response * response, accelerationClamp: rig.accelerationClamp });
}

interface LinkNodeProps {
  bone: string;
  chain: DanglerChain;
  length: number;
  strength: number;
  children: ReactNode;
}

function LinkNode({ bone, chain, length, strength, children }: LinkNodeProps) {
  const { angularSpring, decayPerSecond } = chain.tuning;
  const damping = 1 - Math.exp(-decayPerSecond);
  return (
    <animDynamics
      boundBone={bone}
      physicsBodyDefinitions={[bodyOf(bone, length, chain)]}
      simulationSpace="BoneRelative"
      relativeSpaceBone={chain.spaceBone}
      simSpaceSettings={{ simSpaceAngularAlpha: 0 }}
      externalForce={forceOf(bone)}
      useGravityOverride
      gravityOverrideInSimSpace
      gravityOverride={gravityOf(bone)}
      alpha={strength}
      angularSpring={angularSpring > 0}
      angularSpringConstant={angularSpring}
      overrideLinearDamping
      linearDampingOverride={damping}
      overrideAngularDamping
      angularDampingOverride={damping}
      usePlanarLimit={false}
    >
      {children}
    </animDynamics>
  );
}

export interface DanglersProps {
  rig: DanglerRig;
  lengths: LinkLengths | undefined;
  strength?: number;
  children: ReactNode;
}

export function Danglers({ rig, lengths, strength = 1, children }: DanglersProps) {
  if (!lengths) return <>{children}</>;
  return linksOf(rig).reduce<ReactNode>(
    (pose, { bone, chain }) => (
      <LinkNode key={bone} bone={bone} chain={chain} length={lengths.get(bone) ?? chain.tuning.tipLength} strength={strength}>
        {pose}
      </LinkNode>
    ),
    children,
  );
}
