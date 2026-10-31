import * as UE from 'ue';
import type { Situation } from './motionSituation';

export interface StopExit {
  shortOfEnd?: number;
  done: boolean;
}

const clipLengths = new WeakMap<UE.PoseSearchDatabase, Map<string, number>>();
const blendSeconds = new WeakMap<UE.AnimInstance, number>();

function clipLengthsOf(database: UE.PoseSearchDatabase) {
  const known = clipLengths.get(database);
  if (known) return known;
  const lengths = new Map<string, number>();
  for (let index = 0; index < database.GetNumAnimationAssets(); index++) {
    const clip = database.GetAnimationAsset(index) as UE.AnimSequenceBase | undefined;
    if (clip) lengths.set(clip.GetName(), clip.GetPlayLength());
  }
  clipLengths.set(database, lengths);
  return lengths;
}

function blendSecondsOf(instance: UE.AnimInstance) {
  const known = blendSeconds.get(instance);
  if (known !== undefined) return known;
  const fields = UE.VgeScriptLibrary.GetAnimNodeFields(instance, 'AnimNode_MotionMatching');
  const seconds = fields ? Number(JSON.parse(fields).blendTime ?? 0) : 0;
  blendSeconds.set(instance, seconds);
  return seconds;
}

export function trackStop(exit: StopExit, situation: Situation, shortOfEnd: readonly [number, number] | undefined) {
  if (situation === 'stopping' && exit.shortOfEnd === undefined && !exit.done && shortOfEnd) {
    exit.shortOfEnd = shortOfEnd[0] + Math.random() * (shortOfEnd[1] - shortOfEnd[0]);
  }
  if (situation !== 'stopping' && situation !== 'idle') {
    exit.shortOfEnd = undefined;
    exit.done = false;
  }
}

export function stopExitDue(exit: StopExit, instance: UE.AnimInstance, stops: UE.PoseSearchDatabase | undefined) {
  if (exit.done || exit.shortOfEnd === undefined || !stops) return false;
  const [clip, time, , , rate] = UE.VgeScriptLibrary.DescribeMotionMatching(instance).split('|');
  const length = clipLengthsOf(stops).get(clip);
  if (length === undefined) return false;
  return Number(time) + blendSecondsOf(instance) * Number(rate) >= length * (1 - exit.shortOfEnd);
}
