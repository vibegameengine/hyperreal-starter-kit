import { defineVehicle, type Suspension } from '../../../shared/vehicle';

const suspension: Suspension = { rate: 250, damping: 0.5, preload: 50, maxRaise: 10, maxDrop: 12 };
const front = { radius: 36, width: 26, steerAngle: 38, friction: 3, brakeTorque: 4500, suspension };
const rear = { radius: 36, width: 26, drive: true, handbrake: true, friction: 3.5, brakeTorque: 4500, handbrakeTorque: 6000, suspension };

export const car = defineVehicle({
  model: './vehicle/car.glb',
  massKg: 1400,
  centerOfMass: [0, 0, 38],
  chassisHeight: 110,
  wheels: [
    { bone: 'Wheel_FL', ...front },
    { bone: 'Wheel_FR', ...front },
    { bone: 'Wheel_RL', ...rear },
    { bone: 'Wheel_RR', ...rear },
  ],
  engine: {
    torqueCurve: [
      [0, 300],
      [1500, 520],
      [4200, 600],
      [6000, 540],
      [7000, 400],
    ],
    idleRPM: 900,
    maxRPM: 7000,
  },
  gears: { forward: [4.25, 2.52, 1.66, 1.22, 1.0], reverse: 4.04, finalRatio: 2.81, changeUpRPM: 6000, changeDownRPM: 2000 },
});
