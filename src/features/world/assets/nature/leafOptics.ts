export interface LeafBiochemistry {
  N: number;
  Cab: number;
  Car: number;
  Cbrown: number;
}

export type Rgb = [number, number, number];

export interface LeafOptics {
  reflectance: Rgb;
  transmittance: Rgb;
}

const WAVELENGTHS = Array.from({ length: 31 }, (_, i) => 400 + i * 10);

const K_CHLOROPHYLL = [
  0.066, 0.075, 0.083, 0.086, 0.081, 0.068, 0.052, 0.036, 0.024, 0.015, 0.011, 0.0098, 0.0082, 0.0072, 0.0067, 0.0066, 0.0072, 0.0086, 0.0105, 0.014, 0.019,
  0.026, 0.035, 0.046, 0.054, 0.052, 0.042, 0.028, 0.016, 0.0085, 0.0045,
];
const K_CAROTENOID = [0.045, 0.062, 0.084, 0.105, 0.121, 0.128, 0.126, 0.112, 0.088, 0.058, 0.032, 0.015, 0.006, 0.002, 0.0006, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const K_BROWN = [
  0.72, 0.68, 0.64, 0.6, 0.565, 0.53, 0.495, 0.462, 0.43, 0.4, 0.372, 0.346, 0.322, 0.3, 0.28, 0.261, 0.244, 0.228, 0.213, 0.2, 0.188, 0.177, 0.167, 0.158,
  0.15, 0.143, 0.137, 0.131, 0.126, 0.121, 0.117,
];
const D65 = [
  82.75, 91.49, 93.43, 86.68, 104.86, 117.01, 117.81, 114.86, 115.92, 108.81, 109.35, 107.8, 104.79, 107.69, 104.41, 104.05, 100.0, 96.33, 95.79, 88.69,
  90.01, 89.6, 87.7, 83.29, 83.7, 80.03, 80.21, 82.28, 78.28, 69.72, 71.61,
];

function gauss(l: number, mu: number, s1: number, s2: number) {
  const t = (l - mu) / (l < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
const cieX = (l: number) => 1.056 * gauss(l, 599.8, 37.9, 31.0) + 0.362 * gauss(l, 442.0, 16.0, 26.7) - 0.065 * gauss(l, 501.1, 20.4, 26.2);
const cieY = (l: number) => 0.821 * gauss(l, 568.8, 46.9, 40.5) + 0.286 * gauss(l, 530.9, 16.3, 31.1);
const cieZ = (l: number) => 1.217 * gauss(l, 437.0, 11.8, 36.0) + 0.681 * gauss(l, 459.0, 26.0, 13.8);

const refractiveIndex = (l: number) => 1.44 - 0.04 * ((l - 400) / 300);

function fresnel(cosI: number, n: number) {
  const sinT2 = (1 - cosI * cosI) / (n * n);
  if (sinT2 >= 1) return 1;
  const cosT = Math.sqrt(1 - sinT2);
  const rs = (cosI - n * cosT) / (cosI + n * cosT);
  const rp = (n * cosI - cosT) / (n * cosI + cosT);
  return 0.5 * (rs * rs + rp * rp);
}

const tavCache = new Map<string, number>();
function tav(alphaDeg: number, n: number) {
  const key = `${alphaDeg}|${n}`;
  const cached = tavCache.get(key);
  if (cached !== undefined) return cached;
  const alpha = (alphaDeg * Math.PI) / 180;
  let num = 0;
  let den = 0;
  for (let i = 0; i < 256; i++) {
    const th = ((i + 0.5) / 256) * alpha;
    const w = Math.sin(th) * Math.cos(th);
    num += (1 - fresnel(Math.cos(th), n)) * w;
    den += w;
  }
  tavCache.set(key, num / den);
  return num / den;
}

function expint1(x: number) {
  if (x <= 1) {
    let sum = 0;
    let term = 1;
    for (let k = 1; k < 60; k++) {
      term *= -x / k;
      sum += -term / k;
      if (Math.abs(term) < 1e-16) break;
    }
    return -0.5772156649015329 - Math.log(x) + sum;
  }
  let b = x + 1;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * i;
    b += 2;
    d = 1 / (an * d + b);
    c = b + an / c;
    const del = c * d;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h * Math.exp(-x);
}

const layerTransmittance = (k: number) => (k <= 1e-9 ? 1 : (1 - k) * Math.exp(-k) + k * k * expint1(k));

function stackOfLayers(r: number, t: number, N: number): [number, number] {
  if (r + t >= 1) {
    const T = t / (t + (1 - t) * (N - 1));
    return [1 - T, T];
  }
  const D = Math.sqrt((1 + r + t) * (1 + r - t) * (1 - r + t) * (1 - r - t));
  const a = (1 + r * r - t * t + D) / (2 * r);
  const b = (1 - r * r + t * t + D) / (2 * t);
  const bNm1 = Math.pow(b, N - 1);
  const den = a * a * bNm1 * bNm1 - 1;
  return [(a * (bNm1 * bNm1 - 1)) / den, (bNm1 * (a * a - 1)) / den];
}

function plateModel(k: number, n: number, N: number, alphaDeg: number): [number, number] {
  const tau = layerTransmittance(k);
  const talf = tav(alphaDeg, n);
  const t12 = tav(90, n);
  const t21 = t12 / (n * n);
  const r21 = 1 - t21;
  const denom = 1 - r21 * r21 * tau * tau;
  const Ta = (talf * tau * t21) / denom;
  const Ra = 1 - talf + r21 * tau * Ta;
  const t = (t12 * tau * t21) / denom;
  const r = 1 - t12 + r21 * tau * t;
  const [Rsub, Tsub] = stackOfLayers(r, t, N);
  const den = 1 - Rsub * r;
  return [Ra + (Ta * Rsub * t) / den, (Ta * Tsub) / den];
}

function spectrumToLinearSrgb(spectrum: number[]): Rgb {
  let X = 0;
  let Y = 0;
  let Z = 0;
  let white = 0;
  WAVELENGTHS.forEach((l, i) => {
    X += spectrum[i] * D65[i] * cieX(l);
    Y += spectrum[i] * D65[i] * cieY(l);
    Z += spectrum[i] * D65[i] * cieZ(l);
    white += D65[i] * cieY(l);
  });
  [X, Y, Z] = [X / white, Y / white, Z / white];
  return desaturateIntoGamut([3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z], Y);
}

function desaturateIntoGamut(rgb: Rgb, luminance: number): Rgb {
  const lowest = Math.min(...rgb);
  if (lowest >= 0) return rgb;
  const keep = luminance / (luminance - lowest);
  return rgb.map((channel) => Math.max(0, luminance + (channel - luminance) * keep)) as Rgb;
}

function leafSpectra(leaf: LeafBiochemistry) {
  const N = Math.max(1, leaf.N);
  const body: number[] = [];
  const transmitted: number[] = [];
  WAVELENGTHS.forEach((l, i) => {
    const n = refractiveIndex(l);
    const k = (leaf.Cab * K_CHLOROPHYLL[i] + leaf.Car * K_CAROTENOID[i] + leaf.Cbrown * K_BROWN[i]) / N;
    const [R, T] = plateModel(k, n, N, 40);
    body.push(Math.max(0, R - (1 - tav(40, n))));
    transmitted.push(T);
  });
  return { body, transmitted };
}

export function leafOptics(leaf: LeafBiochemistry): LeafOptics {
  const { body, transmitted } = leafSpectra(leaf);
  return { reflectance: spectrumToLinearSrgb(body), transmittance: spectrumToLinearSrgb(transmitted) };
}

export function measuredBodyReflectance(measured: readonly number[], closestModel: LeafBiochemistry): Rgb {
  const modelBody = leafSpectra(closestModel).body;
  const darkest = measured.slice(0, 11).reduce((best, value, i) => (value < measured[best] ? i : best), 0);
  const surface = measured[darkest] - modelBody[darkest];
  return spectrumToLinearSrgb(measured.map((value) => Math.max(0, value - surface)));
}

export const USGS_LAWN_GRASS_GDS91 = [
  0.0252, 0.0276, 0.0299, 0.0309, 0.0313, 0.0355, 0.0364, 0.0366, 0.0366, 0.0368, 0.0394, 0.0466, 0.0637, 0.0842, 0.094, 0.097, 0.0949, 0.0843, 0.0724,
  0.066, 0.0634, 0.06, 0.0558, 0.0531, 0.05, 0.045, 0.0425, 0.0391, 0.0384, 0.0462, 0.0901,
];

export function mixBiochemistry(a: LeafBiochemistry, b: LeafBiochemistry, t: number): LeafBiochemistry {
  const k = Math.min(1, Math.max(0, t));
  return { N: a.N + (b.N - a.N) * k, Cab: a.Cab + (b.Cab - a.Cab) * k, Car: a.Car + (b.Car - a.Car) * k, Cbrown: a.Cbrown + (b.Cbrown - a.Cbrown) * k };
}

export const LEAF_PRESETS = {
  broadleaf: { N: 2.0, Cab: 58, Car: 11, Cbrown: 0 },
  broadleafYoung: { N: 1.6, Cab: 28, Car: 8, Cbrown: 0 },
  broadleafOld: { N: 2.1, Cab: 18, Car: 7, Cbrown: 0.15 },
  grass: { N: 1.5, Cab: 45, Car: 9, Cbrown: 0 },
  grassYoung: { N: 1.4, Cab: 26, Car: 7, Cbrown: 0 },
  grassDry: { N: 1.6, Cab: 8, Car: 5, Cbrown: 0.6 },
} satisfies Record<string, LeafBiochemistry>;
