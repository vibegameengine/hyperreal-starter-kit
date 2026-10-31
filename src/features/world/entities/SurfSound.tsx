import * as UE from 'ue';
import { $ref } from 'puerts';
import { useEffect, useRef } from 'react';
import { soundOf } from '../../../shared/engine/sound';
import { gameInstance, onFrame, world } from '../../../shared/engine/world';
import { useContentAsset } from '../../../shared/react';
import surfFar from '../assets/audio/surf_far.wav';
import { SEA_LEVEL } from '../assets/coastShape';
import type { ShoreTextures } from '../ocean/Ocean';
import { buildStations, STATION_COUNT, ShoreSampler, stationLevels, type SurfStation } from '../ocean/surfStations';

const SURF_VOLUME = 0.6;
const CM = 100;
const REBUILD_DISTANCE = 12;
const EMITTER_HEIGHT_CM = 10;
const ignoredHit = $ref(new UE.HitResult());

interface SurfBed {
  emitters: UE.AudioComponent[];
  stations: SurfStation[];
  builtAt: [number, number];
}

function spatialOnly() {
  const attenuation = new UE.SoundAttenuation(gameInstance);
  attenuation.Attenuation.bAttenuate = false;
  attenuation.Attenuation.bSpatialize = true;
  return attenuation;
}

function spawnEmitters(sound: UE.SoundWave) {
  const attenuation = spatialOnly();
  return Array.from({ length: STATION_COUNT }, () =>
    UE.GameplayStatics.SpawnSoundAtLocation(world, sound, new UE.Vector(0, 0, SEA_LEVEL), new UE.Rotator(0, 0, 0), 0, 1, Math.random() * sound.Duration, attenuation),
  );
}

function listenerMeters(): [number, number, number] | undefined {
  const manager = UE.GameplayStatics.GetPlayerCameraManager(world, 0);
  if (!manager) return undefined;
  const location = manager.GetCameraLocation();
  return [location.X / CM, location.Y / CM, location.Z / CM];
}

function placeStations(bed: SurfBed, sampler: ShoreSampler, listener: readonly [number, number, number]) {
  const moved = Math.hypot(listener[0] - bed.builtAt[0], listener[1] - bed.builtAt[1]);
  if (bed.stations.length > 0 && moved <= REBUILD_DISTANCE) return;
  const stations = buildStations(sampler, listener[0], listener[1]);
  if (!stations) return;
  bed.stations = stations;
  bed.builtAt = [listener[0], listener[1]];
  bed.emitters.forEach((emitter, index) => {
    const station = stations[index];
    if (station) emitter.K2_SetWorldLocation(new UE.Vector(station.x * CM, station.y * CM, SEA_LEVEL + EMITTER_HEIGHT_CM), false, ignoredHit, true);
  });
}

function mixStations(bed: SurfBed, listener: readonly [number, number, number]) {
  const time = UE.GameplayStatics.GetTimeSeconds(world);
  const levels = stationLevels(bed.stations, listener, SEA_LEVEL / CM, time, SURF_VOLUME);
  bed.emitters.forEach((emitter, index) => emitter.SetVolumeMultiplier(levels[index]?.volume ?? 0));
}

export function useSurfSound(shore: ShoreTextures) {
  const asset = useContentAsset(surfFar);
  const bed = useRef<SurfBed | undefined>(undefined);
  useEffect(() => {
    const sound = asset && soundOf(asset);
    if (!sound || !shore.data) return undefined;
    sound.bLooping = true;
    const sampler = new ShoreSampler(shore.data);
    const current: SurfBed = { emitters: spawnEmitters(sound), stations: [], builtAt: [Infinity, Infinity] };
    bed.current = current;
    const stopMixing = onFrame(() => {
      const listener = listenerMeters();
      if (!listener) return;
      placeStations(current, sampler, listener);
      mixStations(current, listener);
    });
    return () => {
      stopMixing();
      for (const emitter of current.emitters) emitter.Stop();
      bed.current = undefined;
    };
  }, [asset, shore]);
}
