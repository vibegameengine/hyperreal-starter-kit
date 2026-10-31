import * as UE from 'ue';
import { useEffect, useState, type ReactNode } from 'react';
import { onTerrain } from '../engine/content';
import { onFrame, world } from '../engine/world';
import type { TerrainRef } from '../terrain';
import type { Vector3 } from './props';

export interface TerrainProps {
  terrain: TerrainRef;
  at?: Vector3;
  children?: ReactNode;
}

function unload(level: UE.LevelStreamingDynamic | null) {
  if (level) level.SetIsRequestingUnloadAndRemoval(true);
}

export function Terrain({ terrain, at = [0, 0, 0], children }: TerrainProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let level: UE.LevelStreamingDynamic | null = null;
    let loading: UE.LevelStreamingDynamic | null = null;
    let stopWatching = () => {};
    const stop = onTerrain(terrain, (built) => {
      stopWatching();
      unload(loading);
      loading = UE.VgeScriptLibrary.LoadLevelInstance(world, built.path.replace(/\.[^./]+$/, ''), new UE.Vector(at[0], at[1], at[2]));
      if (!loading) {
        console.error(`[terrain] ${terrain.key}: ${built.path} did not load`);
        return;
      }
      const next = loading;
      stopWatching = onFrame(() => {
        if (!next.IsLevelVisible()) return;
        stopWatching();
        unload(level);
        level = next;
        loading = null;
        setReady(true);
      });
    });
    return () => {
      stop();
      stopWatching();
      unload(loading);
      unload(level);
    };
  }, [terrain.key, at[0], at[1], at[2]]);

  return ready ? <>{children}</> : null;
}
