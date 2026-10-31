import * as UE from 'ue';
import { $ref, $unref } from 'puerts';
import { world } from '../../../shared/engine/world';

export const PUFF_SIZE = 64;
export const DOTS_SIZE = 128;
const DOTS_COUNT = 150;

function puffHash(i: number, j: number, octave: number) {
  const s = Math.sin((i % octave) * 127.1 + (j % octave) * 311.7 + octave * 17.3) * 43758.5453;
  return s - Math.floor(s);
}

function valueNoise(x: number, y: number, octave: number) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = x - i;
  const fy = y - j;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = puffHash(i, j, octave);
  const b = puffHash(i + 1, j, octave);
  const c = puffHash(i, j + 1, octave);
  const d = puffHash(i + 1, j + 1, octave);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

export function puffPixels(size = PUFF_SIZE) {
  const pixels = new Float32Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let sum = 0;
      let weight = 0.5;
      let total = 0;
      for (let octave = 4; octave <= 32; octave *= 2) {
        sum += valueNoise((i / size) * octave, (j / size) * octave, octave) * weight;
        total += weight;
        weight *= 0.55;
      }
      const v = Math.round(Math.max(0, Math.min(1, (sum / total - 0.2) * 1.6)) * 255) / 255;
      pixels.set([v, v, v, 1], (j * size + i) * 4);
    }
  }
  return pixels;
}

function splatDrop(coverage: Float32Array, size: number, cx: number, cy: number, radius: number) {
  const reach = Math.ceil(radius + 1.5);
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = (((Math.floor(cx) + dx) % size) + size) % size;
      const y = (((Math.floor(cy) + dy) % size) + size) % size;
      const d = Math.hypot(Math.floor(cx) + dx + 0.5 - cx, Math.floor(cy) + dy + 0.5 - cy);
      coverage[y * size + x] = Math.max(coverage[y * size + x], Math.max(0, Math.min(1, radius + 0.5 - d)));
    }
  }
}

export function dotsPixels(size = DOTS_SIZE, count = DOTS_COUNT) {
  let seed = 12345;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const coverage = new Float32Array(size * size);
  for (let k = 0; k < count; k++) {
    const cx = random() * size;
    const cy = random() * size;
    splatDrop(coverage, size, cx, cy, Math.min(0.9 * Math.pow(1 - random() * 0.97, -0.55), 6));
  }
  const pixels = new Float32Array(size * size * 4);
  coverage.forEach((c, i) => {
    const v = Math.round(c * 255) / 255;
    pixels.set([v, v, v, 1], i * 4);
  });
  return pixels;
}

export function mippedTarget(pixels: Float32Array<ArrayBuffer>, size: number) {
  const source = UE.VgeScriptLibrary.CreateFloatTexture(size, size, pixels.buffer);
  const target = UE.KismetRenderingLibrary.CreateRenderTarget2D(world, size, size, UE.ETextureRenderTargetFormat.RTF_RGBA16f, new UE.LinearColor(0, 0, 0, 0), true, false);
  const canvas = $ref<UE.Canvas>(undefined as unknown as UE.Canvas);
  const extent = $ref(new UE.Vector2D(0, 0));
  const context = $ref(new UE.DrawToRenderTargetContext());
  UE.KismetRenderingLibrary.BeginDrawCanvasToRenderTarget(world, target, canvas, extent, context);
  $unref(canvas).K2_DrawTexture(source, new UE.Vector2D(0, 0), new UE.Vector2D(size, size), new UE.Vector2D(0, 0), new UE.Vector2D(1, 1), new UE.LinearColor(1, 1, 1, 1), UE.EBlendMode.BLEND_Opaque, 0, new UE.Vector2D(0, 0));
  UE.KismetRenderingLibrary.EndDrawCanvasToRenderTarget(world, $unref(context));
  return target;
}
