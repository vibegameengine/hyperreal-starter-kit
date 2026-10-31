export const RISE_SECONDS = 1.4;
export const WAVE_SPEED = 4500;
export const GROWTH_STAGES = { ground: 0, path: 6, grass: 10, trees: 16 };
export const FULLY_GROWN = 1e9;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

function backOut(t: number, overshoot: number) {
  const u = clamp01(t) - 1;
  return 1 + (overshoot + 1) * u * u * u + overshoot * u * u;
}

export const sprout = (metresBehind: number, start: number, span: number) => backOut((metresBehind - start) / span, 1.7);

export const FLAT_SECONDS = 0.8;

export const riseAt = (seconds: number) => backOut(clamp01((seconds - FLAT_SECONDS) / RISE_SECONDS) ** 2, 0.8);

export const frontRadius = (seconds: number) => Math.max(0, seconds - FLAT_SECONDS - RISE_SECONDS) * WAVE_SPEED;

export const metresBehindFront = (radius: number, distance: number) => (radius - distance) / 100;
