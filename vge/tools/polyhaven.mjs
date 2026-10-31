import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const kitRoot = resolve(import.meta.dirname, '../..');
const manifests = process.argv.slice(2).length ? process.argv.slice(2) : ['src/features/world/assets/scans/scans.json'];

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function download(url, target, size) {
  if (existsSync(target) && statSync(target).size === size) return false;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, Buffer.from(await response.arrayBuffer()));
  return true;
}

async function fetchScan(folder, { id, resolution }) {
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  const gltf = files.gltf?.[resolution]?.gltf;
  if (!gltf) throw new Error(`${id}: Poly Haven has no ${resolution} glTF`);
  const entries = [[`${id}.gltf`, gltf], ...Object.entries(gltf.include ?? {})];
  let fetched = 0;
  for (const [path, file] of entries) if (await download(file.url, join(folder, id, path), file.size)) fetched++;
  console.log(`[polyhaven] ${id} ${resolution}: ${fetched} of ${entries.length} files fetched, the rest already on disk`);
}

const TEXTURE_MAPS = { Diffuse: 'color', nor_gl: 'normal', arm: 'arm', Displacement: 'height' };

async function fetchTexture(folder, { id, resolution }) {
  const files = await json(`https://api.polyhaven.com/files/${id}`);
  let fetched = 0;
  for (const [map, name] of Object.entries(TEXTURE_MAPS)) {
    const file = files[map]?.[resolution]?.jpg;
    if (!file) throw new Error(`${id}: Poly Haven has no ${resolution} ${map} jpg`);
    if (await download(file.url, join(folder, 'textures', id, `${name}.jpg`), file.size)) fetched++;
  }
  const { dimensions } = await json(`https://api.polyhaven.com/info/${id}`);
  writeFileSync(join(folder, 'textures', id, 'info.json'), JSON.stringify({ id, tileCentimetres: dimensions[0] / 10 }));
  console.log(`[polyhaven] texture ${id} ${resolution}: ${fetched} of ${Object.keys(TEXTURE_MAPS).length} maps fetched, ${dimensions[0] / 1000} m`);
}

for (const manifest of manifests) {
  const path = resolve(kitRoot, manifest);
  const folder = dirname(path);
  const { scans = [], textures = [] } = JSON.parse(readFileSync(path, 'utf8'));
  for (const scan of scans) await fetchScan(folder, scan);
  for (const texture of textures) await fetchTexture(folder, texture);
}
