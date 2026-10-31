import sharp from 'sharp';

const LUMA = [0.2126, 0.7152, 0.0722];
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
};

async function loadLinear(path, size) {
  const { data, info } = await sharp(path).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = [0, 1, 2].map(() => new Float64Array(size * size));
  for (let i = 0; i < size * size; i++) for (let c = 0; c < 3; c++) channels[c][i] = srgbToLinear(data[i * info.channels + c] / 255);
  return channels;
}

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j], im[i], im[j]] = [re[j], re[i], im[j], im[i]];
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const [wr, wi] = [Math.cos(angle * k), Math.sin(angle * k)];
        const [xr, xi] = [re[i + k + len / 2], im[i + k + len / 2]];
        const [tr, ti] = [xr * wr - xi * wi, xr * wi + xi * wr];
        [re[i + k + len / 2], im[i + k + len / 2]] = [re[i + k] - tr, im[i + k] - ti];
        re[i + k] += tr;
        im[i + k] += ti;
      }
    }
  }
  if (!inverse) return;
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] /= n;
  }
}

function fft2(re, im, size, inverse) {
  const rowRe = new Float64Array(size);
  const rowIm = new Float64Array(size);
  for (const stride of [[size, 1], [1, size]]) {
    for (let line = 0; line < size; line++) {
      for (let k = 0; k < size; k++) [rowRe[k], rowIm[k]] = [re[line * stride[0] + k * stride[1]], im[line * stride[0] + k * stride[1]]];
      fft(rowRe, rowIm, inverse);
      for (let k = 0; k < size; k++) [re[line * stride[0] + k * stride[1]], im[line * stride[0] + k * stride[1]]] = [rowRe[k], rowIm[k]];
    }
  }
}

function boundaryJump(u, size) {
  const v = new Float64Array(size * size);
  for (let k = 0; k < size; k++) {
    const vertical = u[(size - 1) * size + k] - u[k];
    v[k] += vertical;
    v[(size - 1) * size + k] -= vertical;
    const horizontal = u[k * size + size - 1] - u[k * size];
    v[k * size] += horizontal;
    v[k * size + size - 1] -= horizontal;
  }
  return v;
}

function periodicComponent(u, size) {
  const re = boundaryJump(u, size);
  const im = new Float64Array(size * size);
  fft2(re, im, size, false);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = 2 * (Math.cos((2 * Math.PI * y) / size) + Math.cos((2 * Math.PI * x) / size) - 2);
      const i = y * size + x;
      [re[i], im[i]] = d === 0 ? [0, 0] : [re[i] / d, im[i] / d];
    }
  }
  fft2(re, im, size, true);
  return u.map((value, i) => value - re[i]);
}

const luminanceOf = (channels, i) => LUMA[0] * channels[0][i] + LUMA[1] * channels[1][i] + LUMA[2] * channels[2][i];

function calibrate(channels, targetLuminance) {
  const count = channels[0].length;
  let mean = 0;
  for (let i = 0; i < count; i++) mean += luminanceOf(channels, i) / count;
  const gain = targetLuminance / Math.max(mean, 1e-6);
  return channels.map((channel) => channel.map((v) => v * gain));
}

function heightNormal(height, size, { texelMetres, depthMetres, wrap }) {
  const normal = new Uint8Array(size * size * 4);
  const at = (x, y) => (wrap ? height[((y + size) % size) * size + ((x + size) % size)] : height[Math.min(size - 1, Math.max(0, y)) * size + Math.min(size - 1, Math.max(0, x))]);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = ((at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)) / (8 * texelMetres)) * depthMetres;
      const dy = ((at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) - at(x - 1, y + 1) - 2 * at(x, y + 1) - at(x + 1, y + 1)) / (8 * texelMetres)) * depthMetres;
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      normal.set([(-dx / length) * 0.5 + 0.5, (-dy / length) * 0.5 + 0.5, (1 / length) * 0.5 + 0.5].map((v) => Math.round(v * 255)).concat(255), (y * size + x) * 4);
    }
  }
  return normal;
}

function relativeHeight(channels, size) {
  const height = new Float64Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < size * size; i++) {
    height[i] = Math.sqrt(luminanceOf(channels, i));
    min = Math.min(min, height[i]);
    max = Math.max(max, height[i]);
  }
  return height.map((h) => (h - min) / Math.max(max - min, 1e-6));
}

function encodeColor(channels, size, alpha) {
  const color = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) color.set([...[0, 1, 2].map((c) => Math.round(linearToSrgb(channels[c][i]) * 255)), alpha ? alpha[i] : 255], i * 4);
  return color;
}

export async function tilingSurface(path, { size = 1024, albedo, tileMetres, reliefMetres, roughness }) {
  const tiled = (await loadLinear(path, size)).map((channel) => periodicComponent(channel, size).map((v) => Math.max(0, v)));
  const channels = calibrate(tiled, albedo);
  const height = relativeHeight(channels, size);
  const surface = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const cavity = 0.35 + 0.65 * Math.min(1, height[i] * 1.6);
    surface.set([cavity, roughness[1] + (roughness[0] - roughness[1]) * height[i], 0].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).concat(255), i * 4);
  }
  const normal = heightNormal(height, size, { texelMetres: tileMetres / size, depthMetres: reliefMetres, wrap: true });
  return { size, color: encodeColor(channels, size), normal, surface };
}

const keyness = (channels, i) => {
  const [r, g, b] = [linearToSrgb(channels[0][i]), linearToSrgb(channels[1][i]), linearToSrgb(channels[2][i])];
  return Math.min(r, b) - g;
};

function backgroundOf(channels, size) {
  const background = new Uint8Array(size * size);
  const queue = [];
  const visit = (i) => {
    if (background[i] || keyness(channels, i) < 0.25) return;
    background[i] = 1;
    queue.push(i);
  };
  for (let k = 0; k < size; k++) [k, (size - 1) * size + k, k * size, k * size + size - 1].forEach(visit);
  while (queue.length) {
    const i = queue.pop();
    const [x, y] = [i % size, Math.floor(i / size)];
    if (x > 0) visit(i - 1);
    if (x < size - 1) visit(i + 1);
    if (y > 0) visit(i - size);
    if (y < size - 1) visit(i + size);
  }
  return background;
}

function erode(mask, size) {
  return mask.map((solid, i) => {
    if (!solid) return 0;
    const [x, y] = [i % size, Math.floor(i / size)];
    return x > 0 && x < size - 1 && y > 0 && y < size - 1 && mask[i - 1] && mask[i + 1] && mask[i - size] && mask[i + size] ? 1 : 0;
  });
}

function bleedColor(channels, solid, size) {
  const filled = Uint8Array.from(solid);
  let frontier = [];
  for (let i = 0; i < size * size; i++) if (!filled[i]) frontier.push(i);
  while (frontier.length) {
    const next = [];
    const updates = [];
    for (const i of frontier) {
      const [x, y] = [i % size, Math.floor(i / size)];
      const neighbours = [x > 0 && i - 1, x < size - 1 && i + 1, y > 0 && i - size, y < size - 1 && i + size].filter((n) => n !== false && filled[n]);
      if (!neighbours.length) next.push(i);
      else updates.push([i, [0, 1, 2].map((c) => neighbours.reduce((sum, n) => sum + channels[c][n], 0) / neighbours.length)]);
    }
    if (!updates.length) break;
    for (const [i, color] of updates) {
      color.forEach((v, c) => (channels[c][i] = v));
      filled[i] = 1;
    }
    frontier = next;
  }
}

export async function keyedCutout(path, { size = 1024, albedo, cardMetres, reliefMetres, roughness }) {
  const raw = await loadLinear(path, size);
  const background = backgroundOf(raw, size);
  const solid = erode(background.map((b) => 1 - b), size);
  const channels = raw.map((channel) => Float64Array.from(channel));
  bleedColor(channels, solid, size);
  const leafLuminances = [];
  for (let i = 0; i < size * size; i++) if (solid[i]) leafLuminances.push(luminanceOf(channels, i));
  const gain = albedo / Math.max(leafLuminances.reduce((sum, l) => sum + l, 0) / Math.max(leafLuminances.length, 1), 1e-6);
  const calibrated = channels.map((channel) => channel.map((v) => v * gain));
  const height = relativeHeight(calibrated, size);
  const surface = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) surface.set([solid[i], roughness[0], roughness[1]].map((v) => Math.round(v * 255)).concat(255), i * 4);
  const normal = heightNormal(height, size, { texelMetres: cardMetres / size, depthMetres: reliefMetres, wrap: false });
  return { size, color: encodeColor(calibrated, size, solid.map((s) => s * 255)), normal, surface };
}

