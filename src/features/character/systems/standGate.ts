import type { MotionReport } from './motionChecks';

export interface GateExpectation {
  startClip?: RegExp;
  stopClip?: RegExp;
  finalYaw: number;
  yawTolerance: number;
  holdYaw?: boolean;
}

export interface GateLimits {
  rotationPopDegrees: number;
  positionPopCm: number;
}

export const GATE_LIMITS: GateLimits = { rotationPopDegrees: 30, positionPopCm: 15 };

const yawGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

export function gateFailures(report: MotionReport, expected: GateExpectation, limits: GateLimits = GATE_LIMITS): string[] {
  const failures: string[] = [];
  const { timeline, worst } = report;
  const started = timeline.find((change) => change.situation.startsWith('starting') || change.situation.startsWith('moving'));
  if (expected.startClip && !timeline.some((change) => expected.startClip!.test(change.clip))) failures.push(`no start clip ${expected.startClip} (${started?.clip ?? 'none'})`);
  if (expected.stopClip && !timeline.some((change) => expected.stopClip!.test(change.clip))) failures.push(`no stop clip ${expected.stopClip}`);
  const last = timeline[timeline.length - 1];
  if (last && yawGap(last.yaw, expected.finalYaw) > expected.yawTolerance) failures.push(`final yaw ${last.yaw.toFixed(0)}, expected ${expected.finalYaw}`);
  if (expected.holdYaw) {
    const drift = timeline.find((change) => yawGap(change.yaw, expected.finalYaw) > expected.yawTolerance);
    if (drift) failures.push(`yaw drifted to ${drift.yaw.toFixed(0)} at ${drift.clip}`);
  }
  if (!last?.situation.startsWith('idle')) failures.push(`ends in ${last?.situation ?? 'nothing'}`);
  for (const item of worst) {
    if (item.kind === 'knee') failures.push(`knee ${item.bone} ${item.value.toFixed(0)} in ${item.clip}`);
    if (item.kind === 'rotation-pop' && item.value > limits.rotationPopDegrees) failures.push(`rotation pop ${item.bone} ${item.value.toFixed(0)} in ${item.clip}`);
    if (item.kind === 'position-pop' && item.value > limits.positionPopCm) failures.push(`position pop ${item.bone} ${item.value.toFixed(0)} in ${item.clip}`);
  }
  return [...new Set(failures)];
}
