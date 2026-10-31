import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

const outDir = join(import.meta.dirname, '../../src/features/world/assets/destruction');
const sources = join(import.meta.dirname, 'destruction/sources');
const MAPS = { color: 'Diffuse', normal: 'nor_gl', surface: 'arm' };

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}

async function polyhavenSurface(id) {
  const [info, files] = await Promise.all([json(`https://api.polyhaven.com/info/${id}`), json(`https://api.polyhaven.com/files/${id}`)]);
  const images = {};
  for (const [map, kind] of Object.entries(MAPS)) {
    const file = files[kind]?.['2k']?.jpg ?? (() => { throw new Error(`${id}: Poly Haven has no 2k ${kind} jpg`); })();
    const target = join(sources, id, file.url.slice(file.url.lastIndexOf('/') + 1));
    if (!existsSync(target) || statSync(target).size !== file.size) {
      const response = await fetch(file.url);
      if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    }
    images[map] = readFileSync(target);
  }
  return { id, images, tileMetres: info.dimensions[0] / 1000 };
}

function geometry() {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const quad = (corners, normal, cornerUvs) => {
    const base = positions.length / 3;
    for (const [index, corner] of corners.entries()) {
      positions.push(...corner);
      normals.push(...normal);
      uvs.push(...cornerUvs[index]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  return { positions, normals, uvs, indices, quad };
}

function box([sx, sy, sz], tile, target = geometry()) {
  const [x, y, z] = [sx / 2, sy / 2, sz];
  const face = (corners, normal, [u, v]) => target.quad(corners, normal, [[0, v / tile], [u / tile, v / tile], [u / tile, 0], [0, 0]]);
  face([[-x, -y, 0], [x, -y, 0], [x, -y, z], [-x, -y, z]], [0, -1, 0], [sx, sz]);
  face([[x, y, 0], [-x, y, 0], [-x, y, z], [x, y, z]], [0, 1, 0], [sx, sz]);
  face([[x, -y, 0], [x, y, 0], [x, y, z], [x, -y, z]], [1, 0, 0], [sy, sz]);
  face([[-x, y, 0], [-x, -y, 0], [-x, -y, z], [-x, y, z]], [-1, 0, 0], [sy, sz]);
  face([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1], [sx, sy]);
  face([[-x, y, 0], [x, y, 0], [x, -y, 0], [-x, -y, 0]], [0, 0, -1], [sx, sy]);
  return target;
}

function cylinder({ radius, from, to, sides }, tile, target) {
  const around = 2 * Math.PI * radius;
  for (let side = 0; side < sides; side++) {
    const [a, b] = [side / sides, (side + 1) / sides].map((t) => t * 2 * Math.PI);
    const corner = (angle, z) => [Math.cos(angle) * radius, Math.sin(angle) * radius, z];
    const middle = (a + b) / 2;
    const [ua, ub] = [(side / sides) * around, ((side + 1) / sides) * around].map((u) => u / tile);
    target.quad([corner(a, from), corner(b, from), corner(b, to), corner(a, to)], [Math.cos(middle), Math.sin(middle), 0], [[ua, -from / tile], [ub, -from / tile], [ub, -to / tile], [ua, -to / tile]]);
  }
  return target;
}

function column({ radius, height, plinth, sides }, tile) {
  const target = box([plinth.width, plinth.width, plinth.height], tile);
  cylinder({ radius, from: plinth.height, to: height - plinth.height, sides }, tile, target);
  const top = geometry();
  box([plinth.width, plinth.width, plinth.height], tile, top);
  const base = target.positions.length / 3;
  for (let index = 0; index < top.positions.length; index += 3) target.positions.push(top.positions[index], top.positions[index + 1], top.positions[index + 2] + height - plinth.height);
  target.normals.push(...top.normals);
  target.uvs.push(...top.uvs);
  target.indices.push(...top.indices.map((index) => index + base));
  return target;
}

async function model(name, shape, surface) {
  const document = new Document();
  const buffer = document.createBuffer();
  const texture = (map) => document.createTexture(`${surface.id}_${map}`).setImage(surface.images[map]).setMimeType('image/jpeg');
  const material = document
    .createMaterial(name)
    .setBaseColorTexture(texture('color'))
    .setNormalTexture(texture('normal'))
    .setMetallicRoughnessTexture(texture('surface'))
    .setOcclusionTexture(document.getRoot().listTextures().at(-1))
    .setMetallicFactor(1)
    .setRoughnessFactor(1);
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setMaterial(material)
    .setIndices(accessor('SCALAR', new Uint32Array(shape.indices)))
    .setAttribute('POSITION', accessor('VEC3', new Float32Array(shape.positions)))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array(shape.normals)))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(shape.uvs)));
  const mesh = document.createMesh(name).addPrimitive(primitive);
  document.createScene(name).addChild(document.createNode(name).setMesh(mesh));
  return document;
}

const brick = await polyhavenSurface('red_brick');
const stone = await polyhavenSurface('castle_brick_07');
mkdirSync(outDir, { recursive: true });
const io = new NodeIO();
const models = {
  'brick-wall': await model('BrickWall', box([4, 0.3, 2.5], brick.tileMetres), brick),
  'stone-column': await model('StoneColumn', column({ radius: 0.3, height: 3.2, sides: 24, plinth: { width: 0.8, height: 0.25 } }, stone.tileMetres), stone),
};
for (const [file, document] of Object.entries(models)) await io.write(join(outDir, `${file}.glb`), document);
console.log(`wrote ${Object.keys(models).map((m) => `${m}.glb`).join(', ')} to ${outDir}`);
