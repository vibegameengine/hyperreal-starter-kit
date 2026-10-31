import { useEffect, useState } from 'react';
import { onMotionMatching } from '../engine/content';
import type { MotionMatchingRef } from '../motion';

export function useMotionMatchingClass(motion: MotionMatchingRef | undefined) {
  const [animClass, setAnimClass] = useState<string>();

  useEffect(() => {
    if (!motion) return;
    const stop = onMotionMatching(motion, (built) => setAnimClass(built.path));
    return () => stop();
  }, [motion?.key]);

  return motion ? animClass : undefined;
}

