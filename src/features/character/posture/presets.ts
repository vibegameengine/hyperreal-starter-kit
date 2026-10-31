import type { Angles, NoisyJoint } from './JointNoise';

const MARGIN = 5;
const within = (roll: [number, number], pitch: [number, number], yaw: [number, number]): { min: Angles; max: Angles } => ({
  min: { roll: roll[0] - MARGIN, pitch: pitch[0] - MARGIN, yaw: yaw[0] - MARGIN },
  max: { roll: roll[1] + MARGIN, pitch: pitch[1] + MARGIN, yaw: yaw[1] + MARGIN },
});
const even = (degrees: number): Angles => ({ roll: degrees, pitch: degrees, yaw: degrees });

export const TRIPO_GIRL_JOINT_NOISE: readonly NoisyJoint[] = [
  { bone: 'Spine', amplitude: even(1.5), frequency: 0.3, ...within([7, 23], [-2, 2], [-5, 4]) },
  { bone: 'Spine1', amplitude: even(1.5), frequency: 0.3, ...within([-11, 10], [-2, 3], [-3, 4]) },
  { bone: 'Spine2', amplitude: even(1), frequency: 0.3, ...within([3, 5], [-4, 3], [-1, 1]) },
  { bone: 'Neck', amplitude: even(2), frequency: 0.35, ...within([-11, -3], [-3, 5], [-5, 5]) },
  { bone: 'Head', amplitude: even(3), frequency: 0.4, ...within([-16, -2], [-11, 12], [-3, 3]) },
  { bone: 'LeftShoulder', amplitude: even(1.5), frequency: 0.3, ...within([-6, 6], [-7, 5], [-5, 14]) },
  { bone: 'RightShoulder', amplitude: even(1.5), frequency: 0.3, ...within([-3, 7], [-5, 9], [-14, 4]) },
  { bone: 'LeftArm', amplitude: even(3), frequency: 0.35, ...within([65, 79], [-7, 18], [-44, 6]) },
  { bone: 'RightArm', amplitude: even(3), frequency: 0.35, ...within([60, 77], [-22, 6], [-5, 47]) },
  { bone: 'LeftForeArm', amplitude: { yaw: 4 }, frequency: 0.4, min: { yaw: -47 - MARGIN }, max: { yaw: 0 } },
  { bone: 'RightForeArm', amplitude: { yaw: 4 }, frequency: 0.4, min: { yaw: 0 }, max: { yaw: 68 + MARGIN } },
  { bone: 'LeftHand', amplitude: even(4), frequency: 0.5, ...within([-24, 18], [-11, 41], [-7, 11]) },
  { bone: 'RightHand', amplitude: even(4), frequency: 0.5, ...within([-22, 10], [-41, 10], [-9, 9]) },
  { bone: 'LeftUpLeg', amplitude: even(1.5), frequency: 0.3, ...within([-13, 38], [-7, 24], [-24, 9]) },
  { bone: 'RightUpLeg', amplitude: even(1.5), frequency: 0.3, ...within([-16, 38], [-26, 7], [-9, 17]) },
  { bone: 'LeftLeg', amplitude: { roll: 1.5 }, frequency: 0.3, min: { roll: -67 - MARGIN }, max: { roll: 0 } },
  { bone: 'RightLeg', amplitude: { roll: 1.5 }, frequency: 0.3, min: { roll: -62 - MARGIN }, max: { roll: 0 } },
];
