import * as UE from 'ue';
import { useEffect, useRef, useState } from 'react';
import { isWorldPaused, pauseWorldKeepingCamera, resumeWorld } from '../../../../shared/engine/pause';
import { world } from '../../../../shared/engine/world';
import { useFrame } from '../../../../shared/react';

export function useTransport() {
  const [timeScale, setTimeScale] = useState(1);
  const [paused, setPaused] = useState(false);
  const stepping = useRef(false);

  useEffect(() => {
    UE.GameplayStatics.SetGlobalTimeDilation(world, timeScale);
  }, [timeScale]);
  useEffect(() => {
    if (paused) pauseWorldKeepingCamera();
    else resumeWorld();
  }, [paused]);
  useEffect(
    () => () => {
      UE.GameplayStatics.SetGlobalTimeDilation(world, 1);
      if (isWorldPaused()) resumeWorld();
    },
    [],
  );
  useFrame(() => {
    if (!stepping.current) return;
    stepping.current = false;
    pauseWorldKeepingCamera();
  });

  const step = () => {
    setPaused(true);
    stepping.current = true;
    resumeWorld();
  };

  return { timeScale, setTimeScale, paused, setPaused, step };
}

export type Transport = ReturnType<typeof useTransport>;
