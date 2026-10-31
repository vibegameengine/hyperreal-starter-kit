import * as UE from 'ue';
import { useEffect, useMemo } from 'react';
import { useCompute } from '../../../shared/react';
import { oceanSprayEmit, oceanSprayReserve, oceanSprayUpdate } from '../assets/ocean/spray.compute';
import { createSprayEmitter, mountSprayEmitter } from './sprayEmitter';
import { createSprayTargets } from './sprayTargets';
import type { ShoreTextures } from './Ocean';
import type { WakeSurface } from './useWake';

const PRIORITY = { reserve: 22, emit: 23, update: 24 } as const;

export interface SprayFrame {
  time: number;
  dt: number;
  seed: number;
  stations: number;
}

export function useBreakerSpray(shore: ShoreTextures, displacement: UE.TextureRenderTarget2D[], wake: WakeSurface) {
  const targets = useMemo(createSprayTargets, []);
  const emitter = useMemo(createSprayEmitter, []);
  const reserve = useCompute(oceanSprayReserve);
  const emit = useCompute(oceanSprayEmit);
  const update = useCompute(oceanSprayUpdate);

  useEffect(() => mountSprayEmitter(emitter), [emitter]);

  useEffect(() => {
    if (!reserve) return;
    reserve.component.SetTexture('Emit', targets.emit);
    reserve.component.SetTexture('Base', targets.base);
    reserve.component.SetTexture('Head', targets.head);
    reserve.component.SetSortPriority(PRIORITY.reserve);
  }, [reserve, targets]);

  useEffect(() => {
    if (!emit) return;
    emit.component.SetTexture('Emit', targets.emit);
    emit.component.SetTexture('Base', targets.base);
    emit.component.SetTexture('Pos', targets.pos);
    emit.component.SetTexture('Vel', targets.vel);
    emit.component.SetTexture('Info', targets.info);
    emit.component.SetSortPriority(PRIORITY.emit);
  }, [emit, targets]);

  useEffect(() => {
    if (!update) return;
    const bind: [string, UE.TextureRenderTarget2D][] = [
      ['Ground', shore.ground],
      ['Field', shore.field],
      ...displacement.map((texture, c): [string, UE.TextureRenderTarget2D] => [`Displacement${c}`, texture]),
      ['Wake', wake.display],
      ['Pos', targets.pos],
      ['Vel', targets.vel],
      ['Info', targets.info],
      ['Death', targets.death],
      ['DeathList', targets.deathList],
      ['Tally', targets.tally],
      ['Deposit', shore.deposit],
    ];
    for (const [name, texture] of bind) update.component.SetTexture(name, texture);
    update.component.SetSortPriority(PRIORITY.update);
  }, [update, targets, shore, displacement, wake]);

  const step = (frame: SprayFrame) => {
    if (!reserve || !emit || !update) return;
    reserve.component.SetParam('ReserveControl', new UE.LinearColor(frame.stations, frame.time, 0, 0));
    reserve.component.Execute();
    emit.component.SetParam('EmitControl', new UE.LinearColor(frame.stations, frame.seed, 0, 0));
    emit.component.Execute();
    update.component.SetParam('SprayStep', new UE.LinearColor(frame.dt, frame.time, frame.seed, 0));
    update.component.SetParam('WakeWindow', wake.window.current);
    emitter.flush(update.component);
    update.component.Execute();
  };

  return { targets, step, emitter };
}
