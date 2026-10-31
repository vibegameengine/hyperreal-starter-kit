import type { ReactNode } from 'react';

const JOINT_NOISE = '/Script/VibeGameEngine.VgeAnimNode_JointNoise';

export interface Angles {
  roll?: number;
  pitch?: number;
  yaw?: number;
}

export interface NoisyJoint {
  bone: string;
  amplitude: Angles;
  frequency: number;
  min?: Angles;
  max?: Angles;
}

export interface JointNoiseProps {
  joints: readonly NoisyJoint[];
  children: ReactNode;
}

const UNLIMITED = 180;
const rotator = ({ roll = 0, pitch = 0, yaw = 0 }: Angles) => ({ Roll: roll, Pitch: pitch, Yaw: yaw });
const limit = ({ roll, pitch, yaw }: Angles = {}, open: number) => rotator({ roll: roll ?? open, pitch: pitch ?? open, yaw: yaw ?? open });

export function JointNoise({ joints, children }: JointNoiseProps) {
  return (
    <control
      node={JOINT_NOISE}
      Joints={joints.map((joint) => ({ Bone: { BoneName: joint.bone }, Amplitude: rotator(joint.amplitude), Frequency: joint.frequency, MinAngles: limit(joint.min, -UNLIMITED), MaxAngles: limit(joint.max, UNLIMITED) }))}
    >
      {children}
    </control>
  );
}
