export interface RootSample {
  time: number;
  distance: number;
}

const MOVING_SHARE = 0.9;
const STILL_SHARE = 0.05;

export function speedsOf(samples: readonly RootSample[]): RootSample[] {
  return samples.slice(1).map((sample, index) => ({ time: sample.time, distance: (sample.distance - samples[index].distance) / Math.max(1e-6, sample.time - samples[index].time) }));
}

export function brakingOf(samples: readonly RootSample[]): number | undefined {
  const speeds = speedsOf(samples);
  const top = Math.max(...speeds.map((sample) => sample.distance));
  if (!(top > 0)) return undefined;
  const lastMoving = speeds.map((sample) => sample.distance >= top * MOVING_SHARE).lastIndexOf(true);
  const still = speeds.findIndex((sample, index) => index > lastMoving && sample.distance <= top * STILL_SHARE);
  if (lastMoving < 0 || still < 0) return undefined;
  const span = samples[still + 1].distance - samples[lastMoving + 1].distance;
  return span > 0 ? (top * top) / (2 * span) : undefined;
}

export function accelerationOf(samples: readonly RootSample[]): number | undefined {
  const speeds = speedsOf(samples);
  const top = Math.max(...speeds.map((sample) => sample.distance));
  if (!(top > 0)) return undefined;
  const lastStill = speeds.map((sample) => sample.distance <= top * STILL_SHARE).indexOf(false) - 1;
  const moving = speeds.findIndex((sample) => sample.distance >= top * MOVING_SHARE);
  if (moving < 0) return undefined;
  const span = samples[moving + 1].distance - samples[Math.max(0, lastStill) + 1].distance;
  return span > 0 ? (top * top) / (2 * span) : undefined;
}

export const mean = (values: readonly (number | undefined)[]) => {
  const known = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : undefined;
};
