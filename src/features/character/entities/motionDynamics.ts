import * as UE from 'ue';
import { useMemo } from 'react';
import { useMotionMatchingDatabases } from '../../../shared/react';
import type { MotionMatchingRef } from '../../../shared/motion';
import { accelerationOf, brakingOf, mean, type RootSample } from '../systems/clipDynamics';
import type { Gait } from './motionSituation';

const STEP_SECONDS = 1 / 30;

const canSampleRoot = () => typeof UE.VgeScriptLibrary.SampleClipRootMotion === 'function';

export function rootSamplesOf(clip: UE.AnimSequenceBase): RootSample[] {
  if (!canSampleRoot()) return [];
  const positions = UE.VgeScriptLibrary.SampleClipRootMotion(clip, STEP_SECONDS);
  const samples: RootSample[] = [];
  let distance = 0;
  for (let index = 0; index < positions.Num(); index++) {
    const now = positions.Get(index);
    if (index > 0) {
      const before = positions.Get(index - 1);
      distance += Math.hypot(now.X - before.X, now.Y - before.Y);
    }
    samples.push({ time: index * STEP_SECONDS, distance });
  }
  return samples;
}

function clipsOf(database: UE.PoseSearchDatabase | undefined) {
  if (!database) return [];
  return Array.from({ length: database.GetNumAnimationAssets() }, (_, index) => database.GetAnimationAsset(index) as UE.AnimSequenceBase | undefined).filter((clip): clip is UE.AnimSequenceBase => !!clip);
}

const measured = (database: UE.PoseSearchDatabase | undefined, measure: (samples: readonly RootSample[]) => number | undefined) => mean(clipsOf(database).map((clip) => measure(rootSamplesOf(clip))));

export interface GaitDynamics {
  braking: Partial<Record<Gait, number>>;
  acceleration: Partial<Record<Gait, number>>;
}

export interface DynamicsSources {
  stops: Partial<Record<Gait, MotionMatchingRef>>;
  starts: Partial<Record<Gait, MotionMatchingRef>>;
}

export function useClipDynamics({ stops, starts }: DynamicsSources): GaitDynamics {
  const stopDatabases = useMotionMatchingDatabases(stops);
  const startDatabases = useMotionMatchingDatabases(starts);
  return useMemo(() => {
    const gaits: Gait[] = ['walk', 'jog'];
    return {
      braking: Object.fromEntries(gaits.map((gait) => [gait, measured(stopDatabases[gait], brakingOf)])),
      acceleration: Object.fromEntries(gaits.map((gait) => [gait, measured(startDatabases[gait], accelerationOf)])),
    };
  }, [stopDatabases, startDatabases]);
}
