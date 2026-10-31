export const FFT_SIZE = 256;
export const ATLAS_SIZE = FFT_SIZE * 2;
export const FFT_STAGES = Math.log2(FFT_SIZE);
export const CASCADE_SIZES = [733, 157, 33.3, 7.1] as const;
export const CASCADES = CASCADE_SIZES.length;
export const GRAVITY = 9.81;
export const SEA_DEPTH = 500;
export const SEED = 1337;
export const CHOPPINESS = 0.9;
export const FOAM = { bias: 0.58, gain: 3, decay: 0.35, add: 2.5 } as const;
export const FOAM_WEIGHTS = [0.35, 0.45, 0.5, 0.25] as const;
export const FOAM_PATTERN_SIZE = 1024;
export const WIND_SPEED = 7;

export interface WaveSystem {
  scale: number;
  windSpeed: number;
  windDirection: number;
  fetch: number;
  spreadBlend: number;
  swell: number;
  peakEnhancement: number;
  shortWavesFade: number;
}

const waveSystem = (overrides: Partial<WaveSystem>): WaveSystem => ({
  scale: 1,
  windSpeed: 8,
  windDirection: 20,
  fetch: 200,
  spreadBlend: 0.9,
  swell: 0.2,
  peakEnhancement: 3.3,
  shortWavesFade: 0.01,
  ...overrides,
});

export const LOCAL_SEA = waveSystem({ windSpeed: WIND_SPEED, windDirection: 25, fetch: 120, spreadBlend: 0.85, swell: 0.05 });
export const SWELL_SEA = waveSystem({ scale: 0.48, windSpeed: 6, windDirection: 5, fetch: 1200, spreadBlend: 1.0, swell: 0.9, shortWavesFade: 0.1 });

export function systemTerms(system: WaveSystem) {
  const fetchMetres = Math.max(1, system.fetch) * 1000;
  const wind = Math.max(0.1, system.windSpeed);
  const alpha = 0.076 * Math.pow((GRAVITY * fetchMetres) / (wind * wind), -0.22);
  const peakOmega = 22 * Math.pow((wind * fetchMetres) / (GRAVITY * GRAVITY), -0.33);
  return {
    a: [system.scale, (system.windDirection * Math.PI) / 180, system.spreadBlend, system.swell],
    b: [alpha, peakOmega, system.peakEnhancement, system.shortWavesFade],
  };
}

export function cascadeCuts(cascade: number) {
  const low = cascade === 0 ? 0.0001 : ((Math.PI * 2) / CASCADE_SIZES[cascade]) * 6;
  const high = cascade === CASCADES - 1 ? 9999 : ((Math.PI * 2) / CASCADE_SIZES[cascade + 1]) * 6;
  return [low, high];
}

export const cascadeTile = (cascade: number) => [cascade % 2, Math.floor(cascade / 2)] as const;
