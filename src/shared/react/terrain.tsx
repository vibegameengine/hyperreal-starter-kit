import * as UE from 'ue';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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

function afterUnloaded(level: UE.LevelStreamingDynamic | null, then: () => void) {
  if (!level) {
    then();
    return () => {};
  }
  const stop = onFrame(() => {
    if (level.GetLoadedLevel()) return;
    stop();
    UE.VgeScriptLibrary.RefreshWaterZones(world);
    then();
  });
  return stop;
}

export function Terrain({ terrain, at = [0, 0, 0], children }: TerrainProps) {
  const [ready, setReady] = useState<string | null>(null);

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
        const previous = level;
        level = next;
        loading = null;
        stopWatching = afterUnloaded(previous, () => setReady(`${built.path}#${built.build}`));
      });
    });
    return () => {
      stop();
      stopWatching();
      unload(loading);
      unload(level);
    };
  }, [terrain.key, at[0], at[1], at[2]]);

  return ready ? <TerrainLevelContext.Provider value={ready}>{children}</TerrainLevelContext.Provider> : null;
}

const TerrainLevelContext = createContext<string | null>(null);

export const useTerrainLevel = () => useContext(TerrainLevelContext);
