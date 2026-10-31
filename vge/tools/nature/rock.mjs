import * as THREE from 'three';
import { createNoise, seededRandom } from './noise.mjs';

const BOTTOM_CLAMP = 0.75;
export const ROCK_TILE_METRES = 1.2;

function randomUnitVector(next, out) {
  const z = next() * 2 - 1;
  const a = next() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

function weldIcosphere(source) {
  const src = source.getAttribute('position');
  const keyToIndex = new Map();
  const unique = [];
  const index = new Uint32Array(src.count);
  for (let i = 0; i < src.count; i++) {
    const key = `${Math.round(src.getX(i) * 1e5)},${Math.round(src.getY(i) * 1e5)},${Math.round(src.getZ(i) * 1e5)}`;
    let found = keyToIndex.get(key);
    if (found === undefined) {
      found = unique.length / 3;
      keyToIndex.set(key, found);
      unique.push(src.getX(i), src.getY(i), src.getZ(i));
    }
    index[i] = found;
  }
  const welded = new THREE.BufferGeometry();
  welded.setAttribute('position', new THREE.BufferAttribute(new Float32Array(unique), 3));
  welded.setIndex(new THREE.BufferAttribute(index, 1));
  return welded;
}

function lumpedSphere(position, shape) {
  const { noise, radius, scale, lumpOffset, lumpFrequency, lumpAmplitude } = shape;
  const directions = new Float32Array(position.count * 3);
  const d = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    d.fromBufferAttribute(position, i).normalize();
    d.toArray(directions, i * 3);
    const lump = noise.fbm3(d.x * lumpFrequency + lumpOffset.x, d.y * lumpFrequency + lumpOffset.y, d.z * lumpFrequency + lumpOffset.z, 4, 2.1, 0.5);
    const p = d.clone().multiplyScalar((1 + lumpAmplitude * lump) * radius).multiply(scale);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  return directions;
}

const along = (position, i, n) => position.getX(i) * n.x + position.getY(i) * n.y + position.getZ(i) * n.z;

function cutFacets(position, next, sharpness) {
  const cutCount = 3 + Math.floor(next() * 4) + Math.round(sharpness * 2);
  const n = new THREE.Vector3();
  for (let c = 0; c < cutCount; c++) {
    randomUnitVector(next, n);
    if (n.y < -0.2) n.y = -n.y;
    n.normalize();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const t = along(position, i, n);
      min = Math.min(min, t);
      max = Math.max(max, t);
    }
    const plane = max - (max - min) * (0.1 + next() * 0.2 * (0.5 + sharpness));
    for (let i = 0; i < position.count; i++) {
      const over = along(position, i, n) - plane;
      if (over > 0) position.setXYZ(i, position.getX(i) - n.x * over, position.getY(i) - n.y * over, position.getZ(i) - n.z * over);
    }
  }
}

function carveCrevices(position, directions, shape) {
  const { noise, radius, scale, ridgeOffset, ridgeFrequency, creviceDepth } = shape;
  const crevice = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const [x, y, z] = [directions[i * 3], directions[i * 3 + 1], directions[i * 3 + 2]];
    const ridge = noise.ridged3(x * ridgeFrequency + ridgeOffset.x, y * ridgeFrequency + ridgeOffset.y, z * ridgeFrequency + ridgeOffset.z, 4);
    crevice[i] = THREE.MathUtils.smoothstep(ridge, 0.5, 0.95);
    const push = creviceDepth * THREE.MathUtils.smoothstep(ridge, 0.62, 0.95) * radius;
    position.setXYZ(i, position.getX(i) - x * push * scale.x, position.getY(i) - y * push * scale.y, position.getZ(i) - z * push * scale.z);
  }
  const floor = -BOTTOM_CLAMP * radius * scale.y;
  for (let i = 0; i < position.count; i++) if (position.getY(i) < floor) position.setY(i, floor);
  return crevice;
}

function blendNormals(indexed, sharpness) {
  indexed.computeVertexNormals();
  const geometry = indexed.toNonIndexed();
  const smooth = geometry.getAttribute('normal').array.slice();
  geometry.computeVertexNormals();
  const normal = geometry.getAttribute('normal');
  const blended = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    const j = i * 3;
    blended.set(...[0, 1, 2].map((k) => smooth[j + k] * (1 - sharpness) + normal.array[j + k] * sharpness)).normalize();
    normal.setXYZ(i, blended.x, blended.y, blended.z);
  }
  return geometry;
}

function sphericalUv(direction, pole) {
  return [0.5 + Math.atan2(direction.z, direction.x) / (2 * Math.PI), 0.5 + Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1)) / Math.PI, pole];
}

function buildSphericalUvs(geometry, radius, scale) {
  const position = geometry.getAttribute('position');
  const uv = new Float32Array(position.count * 2);
  const meanRadius = (radius * (scale.x + scale.y + scale.z)) / 3;
  const repeatU = Math.max(1, Math.round((2 * Math.PI * meanRadius) / ROCK_TILE_METRES));
  const repeatV = Math.max(1, Math.round((Math.PI * meanRadius) / ROCK_TILE_METRES));
  const d = new THREE.Vector3();
  for (let t = 0; t < position.count; t += 3) {
    const corners = [0, 1, 2].map((k) => {
      d.fromBufferAttribute(position, t + k).divide(scale).normalize();
      return sphericalUv(d, Math.abs(d.y) > 0.999);
    });
    const open = corners.filter(([, , pole]) => !pole);
    const us = open.map(([u]) => u);
    if (Math.max(...us) - Math.min(...us) > 0.5) open.forEach((c) => c[0] < 0.5 && (c[0] += 1));
    const meanU = open.length ? open.reduce((sum, [u]) => sum + u, 0) / open.length : 0;
    corners.forEach((c, k) => {
      uv[(t + k) * 2] = THREE.MathUtils.clamp(c[2] ? meanU : c[0], 0, 1.5) * repeatU;
      uv[(t + k) * 2 + 1] = THREE.MathUtils.clamp(c[1], 0, 1) * repeatV;
    });
  }
  return uv;
}

function shapeOf({ seed, radius, scale: given, sharpness }) {
  const next = seededRandom((seed * 0x9e3779b1) >>> 0);
  const scale = given ? new THREE.Vector3(given.x, given.y, given.z) : new THREE.Vector3(1.0 + next() * 0.55, 0.62 + next() * 0.38, 0.8 + next() * 0.5);
  return {
    next,
    noise: createNoise((seed * 0x85ebca6b + 17) >>> 0),
    radius,
    scale,
    lumpOffset: new THREE.Vector3(next() * 40, next() * 40, next() * 40),
    ridgeOffset: new THREE.Vector3(next() * 40 + 100, next() * 40, next() * 40),
    lumpFrequency: 1.1 + next() * 0.5,
    ridgeFrequency: 3.6 + next() * 1.6,
    lumpAmplitude: 0.22 + next() * 0.12,
    creviceDepth: 0.025 + 0.045 * sharpness,
  };
}

export function rock(options) {
  const sharpness = THREE.MathUtils.clamp(options.sharpness ?? 0.6, 0, 1);
  const shape = shapeOf({ ...options, sharpness });
  const indexed = weldIcosphere(new THREE.IcosahedronGeometry(1, options.detail ?? 31));
  const position = indexed.getAttribute('position');
  const directions = lumpedSphere(position, shape);
  cutFacets(position, shape.next, sharpness);
  indexed.setAttribute('crevice', new THREE.BufferAttribute(carveCrevices(position, directions, shape), 1));
  const geometry = blendNormals(indexed, sharpness);
  const crevice = geometry.getAttribute('crevice').array;
  const count = geometry.getAttribute('position').count;
  return [
    {
      name: 'Stone',
      color: [0.4, 0.38, 0.35, 1],
      roughness: 0.85,
      positions: Array.from(geometry.getAttribute('position').array),
      normals: Array.from(geometry.getAttribute('normal').array),
      uvs: Array.from(buildSphericalUvs(geometry, shape.radius, shape.scale)),
      colors: Array.from(crevice, (c) => [c, 0, 0, 1]).flat(),
      indices: Array.from({ length: count }, (_, i) => i),
    },
  ];
}
