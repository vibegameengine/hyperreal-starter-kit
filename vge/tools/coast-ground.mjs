import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

const scans = join(import.meta.dirname, '../../src/features/world/assets/scans');
const textures = join(scans, 'textures');

export const GROUND_SETS = {
  Sand: 'sand_03',
  SandWet: 'damp_beach_sand',
  Shore: 'coast_sand_04',
  Ground: 'grass_ground',
  Rock: 'seaside_rock',
  MacroSand: 'aerial_beach_01',
  MacroLand: 'coast_land_rocks_01',
  CliffA: 'rock_face_03',
  CliffB: 'seaside_rock',
  Gravel: 'coast_sand_rocks_02',
};

const jpeg = (document, name, file) => document.createTexture(name).setImage(readFileSync(file)).setMimeType('image/jpeg');

async function arh(folder) {
  const size = (await sharp(join(folder, 'arm.jpg')).metadata()).width;
  const arm = await sharp(join(folder, 'arm.jpg')).removeAlpha().raw().toBuffer();
  const height = await sharp(join(folder, 'height.jpg')).resize(size, size).greyscale().raw().toBuffer();
  const packed = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    packed[i * 3] = arm[i * 3];
    packed[i * 3 + 1] = arm[i * 3 + 1];
    packed[i * 3 + 2] = height[i];
  }
  return sharp(packed, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
}

async function meanLuminance(file) {
  const { channels } = await sharp(file).stats();
  return 0.2126 * (channels[0].mean / 255) ** 2.2 + 0.7152 * (channels[1].mean / 255) ** 2.2 + 0.0722 * (channels[2].mean / 255) ** 2.2;
}

async function setMaterial(document, layer, id) {
  const folder = join(textures, id);
  const surface = document.createTexture(`${layer}Surface`).setImage(await arh(folder)).setMimeType('image/png');
  return document
    .createMaterial(layer)
    .setBaseColorTexture(jpeg(document, `${layer}Color`, join(folder, 'color.jpg')))
    .setNormalTexture(jpeg(document, `${layer}Normal`, join(folder, 'normal.jpg')))
    .setMetallicRoughnessTexture(surface);
}

function quad(document, buffer, material, offset) {
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  return document
    .createPrimitive()
    .setMaterial(material)
    .setIndices(accessor('SCALAR', new Uint32Array([0, 2, 1, 0, 3, 2])))
    .setAttribute('POSITION', accessor('VEC3', new Float32Array([offset, 0, 0, offset + 1, 0, 0, offset + 1, 0, 1, offset, 0, 1])))
    .setAttribute('NORMAL', accessor('VEC3', new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0])))
    .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])));
}

const document = new Document();
const buffer = document.createBuffer();
const mesh = document.createMesh('ground');
const sets = {};
for (const [index, [layer, id]] of Object.entries(GROUND_SETS).entries()) {
  mesh.addPrimitive(quad(document, buffer, await setMaterial(document, layer, id), index * 1.5));
  const info = JSON.parse(readFileSync(join(textures, id, 'info.json'), 'utf8'));
  sets[layer] = { id, tileCentimetres: info.tileCentimetres, meanLuminance: await meanLuminance(join(textures, id, 'color.jpg')) };
}
document.createScene('ground').addChild(document.createNode('ground').setMesh(mesh));
await new NodeIO().write(join(scans, 'ground.glb'), document);
writeFileSync(join(scans, 'groundSets.json'), JSON.stringify(sets, null, 2));
console.log(`wrote ground.glb and groundSets.json: ${Object.entries(sets).map(([l, s]) => `${l} ${s.id} ${s.tileCentimetres} cm`).join(', ')}`);
