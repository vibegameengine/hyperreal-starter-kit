import * as UE from 'ue';
import { useEffect, useState } from 'react';
import { loadContent, onMotionMatching } from '../engine/content';
import type { MotionMatchingRef } from '../motion';

export function motionDatabaseOf(graphClass: string | undefined) {
  const match = graphClass && /^(.*)\/([^/.]+)\.[^/]+_C$/.exec(graphClass);
  return match ? loadContent<UE.PoseSearchDatabase>(`${match[1]}/${match[2]}_Database.${match[2]}_Database`) : undefined;
}

export function useMotionMatchingDatabases<K extends string>(refs: Partial<Record<K, MotionMatchingRef>> | undefined) {
  const [databases, setDatabases] = useState<Partial<Record<K, UE.PoseSearchDatabase>>>({});
  const keys = refs ? Object.entries(refs).map(([name, ref]) => `${name}:${(ref as MotionMatchingRef).key}:${(ref as MotionMatchingRef).continuingPoseCostBias}`).join('|') : '';

  useEffect(() => {
    if (!refs) return;
    const stops = Object.entries(refs).map(([name, ref]) =>
      onMotionMatching(ref as MotionMatchingRef, (built) => {
        const database = motionDatabaseOf(built.path);
        if (!database) return;
        const bias = (ref as MotionMatchingRef).continuingPoseCostBias;
        if (bias !== undefined) database.ContinuingPoseCostBias = bias;
        setDatabases((current) => ({ ...current, [name]: database }));
      }),
    );
    return () => stops.forEach((stop) => stop());
  }, [keys]);

  return databases;
}

export function useMotionMatchingSpeed(motion: MotionMatchingRef | undefined) {
  const [speed, setSpeed] = useState<number>();

  useEffect(() => {
    if (!motion) return;
    const stop = onMotionMatching(motion, (built) => {
      const moving = (built.clips ?? []).filter((clip) => clip.rootSpeed > 0);
      if (moving.length) setSpeed(moving.reduce((sum, clip) => sum + clip.rootSpeed, 0) / moving.length);
    });
    return () => stop();
  }, [motion?.key]);

  return speed;
}

export function useMotionMatchingClass(motion: MotionMatchingRef | undefined) {
  const [animClass, setAnimClass] = useState<string>();

  useEffect(() => {
    if (!motion) return;
    const stop = onMotionMatching(motion, (built) => {
      const database = motion.continuingPoseCostBias !== undefined ? motionDatabaseOf(built.path) : undefined;
      if (database) database.ContinuingPoseCostBias = motion.continuingPoseCostBias!;
      setAnimClass(built.path);
    });
    return () => stop();
  }, [motion?.key, motion?.continuingPoseCostBias]);

  return motion ? animClass : undefined;
}
