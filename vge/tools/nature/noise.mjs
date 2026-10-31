import { createNoise3D } from 'simplex-noise';

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createNoise(seed) {
  const noise3 = createNoise3D(seededRandom(seed));
  const fbm3 = (x, y, z, octaves = 5, lacunarity = 2, gain = 0.5) => {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise3(x * frequency, y * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / norm;
  };
  const ridged3 = (x, y, z, octaves = 4) => {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let signal = 1 - Math.abs(noise3(x * frequency, y * frequency, z * frequency));
      signal *= signal * weight;
      weight = Math.min(1, Math.max(0, signal * 2));
      sum += signal * amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return Math.min(1, sum);
  };
  return { fbm3, ridged3 };
}
