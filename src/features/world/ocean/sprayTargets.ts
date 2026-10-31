import * as UE from 'ue';
import { world } from '../../../shared/engine/world';
import { STATION_RES } from '../assets/ocean/breakerSpec';
import { SPRAY_COLUMNS, SPRAY_EMIT_TEXELS, SPRAY_HEAD_TEXELS, SPRAY_ROWS } from '../assets/ocean/spraySpec';
import { DOTS_SIZE, dotsPixels, mippedTarget, PUFF_SIZE, puffPixels } from './sprayTextures';

const floatTarget = (width: number, height: number) =>
  UE.KismetRenderingLibrary.CreateRenderTarget2D(world, width, height, UE.ETextureRenderTargetFormat.RTF_RGBA32f, new UE.LinearColor(0, 0, 0, 0), false, true);

export interface SprayTargets {
  pos: UE.TextureRenderTarget2D;
  vel: UE.TextureRenderTarget2D;
  info: UE.TextureRenderTarget2D;
  death: UE.TextureRenderTarget2D;
  deathList: UE.TextureRenderTarget2D;
  tally: UE.TextureRenderTarget2D;
  emit: UE.TextureRenderTarget2D;
  base: UE.TextureRenderTarget2D;
  head: UE.TextureRenderTarget2D;
  puff: UE.TextureRenderTarget2D;
  dots: UE.TextureRenderTarget2D;
}

export function createSprayTargets(): SprayTargets {
  const particles = () => floatTarget(SPRAY_COLUMNS, SPRAY_ROWS);
  return {
    pos: particles(),
    vel: particles(),
    info: particles(),
    death: particles(),
    deathList: particles(),
    tally: floatTarget(1, 1),
    emit: floatTarget(STATION_RES * SPRAY_EMIT_TEXELS, STATION_RES),
    base: floatTarget(STATION_RES, STATION_RES),
    head: floatTarget(SPRAY_HEAD_TEXELS, 1),
    puff: mippedTarget(puffPixels(), PUFF_SIZE),
    dots: mippedTarget(dotsPixels(), DOTS_SIZE),
  };
}
