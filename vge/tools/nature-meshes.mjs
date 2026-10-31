import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import { BARK_TILE_METRES, ezTree } from './nature/ezTree.mjs';
import { keyedCutout, tilingSurface } from './nature/photoTextures.mjs';
import { grassPatch } from './nature/grass.mjs';
import { ROCK_TILE_METRES, rock } from './nature/rock.mjs';

const outDir = join(import.meta.dirname, '../../src/features/world/assets/nature');
const sources = join(import.meta.dirname, 'nature/sources');

const BARK_ALBEDO = { oak: 0.11, ash: 0.2 };
const LEAF_ALBEDO = 0.09;
const ROCK_ALBEDO = 0.25;

async function broadleafTree({ preset, species, seed, height }) {
  const grown = ezTree({ preset, seed, height });
  const barkTextures = await tilingSurface(join(sources, `bark-${species}.png`), { albedo: BARK_ALBEDO[species], tileMetres: BARK_TILE_METRES, reliefMetres: 0.015, roughness: [0.82, 0.96] });
  const leafTextures = await keyedCutout(join(sources, `sprig-${species}.png`), { albedo: LEAF_ALBEDO, cardMetres: grown.cardMetres, reliefMetres: 0.0015, roughness: [0.35, 0.7] });
  return [
    { name: 'Bark', color: [1, 1, 1, 1], roughness: 1, textures: barkTextures, ...grown.bark },
    { name: 'Leaves', textureName: 'Leaf', color: [1, 1, 1, 1], roughness: 1, alphaMask: true, textures: leafTextures, ...grown.leaves },
    { name: 'Trunk', collision: true, color: [1, 1, 1, 1], roughness: 1, ...grown.hull },
  ];
}

async function boulder(options) {
  const textures = await tilingSurface(join(sources, 'rock-granite.png'), { albedo: ROCK_ALBEDO, tileMetres: ROCK_TILE_METRES, reliefMetres: 0.02, roughness: [0.7, 0.92] });
  return rock(options).map((piece) => ({ ...piece, color: [1, 1, 1, 1], roughness: 1, textures }));
}

const NEAR_GRASS = { size: 0.5, blades: 420, widthScale: 1, segments: 4 };
const FAR_GRASS = { size: 1.5, blades: 2000, widthScale: 1.6, segments: 3 };

async function pngTexture(document, name, { size, ...maps }, map) {
  const png = await sharp(Buffer.from(maps[map]), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  return document.createTexture(`${name}${map[0].toUpperCase()}${map.slice(1)}`).setImage(png).setMimeType('image/png');
}

async function texturedMaterial(document, piece) {
  const material = document.createMaterial(piece.name).setBaseColorFactor(piece.color).setRoughnessFactor(piece.roughness).setMetallicFactor(0).setDoubleSided(true);
  if (piece.alphaMask) material.setAlphaMode('MASK').setAlphaCutoff(0.5);
  if (!piece.textures) return material;
  const textureName = piece.textureName ?? piece.name;
  material.setBaseColorTexture(await pngTexture(document, textureName, piece.textures, 'color'));
  material.setNormalTexture(await pngTexture(document, textureName, piece.textures, 'normal'));
  return material.setMetallicRoughnessTexture(await pngTexture(document, textureName, piece.textures, 'surface'));
}

async function staticModel(name, parts) {
  const document = new Document();
  const buffer = document.createBuffer();
  const mesh = document.createMesh(name);
  const hulls = parts.filter((piece) => piece.collision);
  const hullMesh = hulls.length ? document.createMesh(`UCX_${name}`) : null;
  for (const piece of parts) {
    const target = piece.collision ? hullMesh : mesh;
    const count = piece.positions.length / 3;
    const material = await texturedMaterial(document, piece);
    target.addPrimitive(
      document
        .createPrimitive()
        .setMaterial(material)
        .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint32Array(piece.indices)).setBuffer(buffer))
        .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(piece.positions)).setBuffer(buffer))
        .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(new Float32Array(piece.normals)).setBuffer(buffer))
        .setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(new Float32Array(piece.uvs)).setBuffer(buffer))
        .setAttribute('COLOR_0', document.createAccessor().setType('VEC4').setArray(piece.colors ? new Float32Array(piece.colors) : new Float32Array(count * 4).fill(1)).setBuffer(buffer)),
    );
  }
  const scene = document.createScene(name).addChild(document.createNode(name).setMesh(mesh));
  if (hullMesh) scene.addChild(document.createNode(`UCX_${name}`).setMesh(hullMesh));
  return document;
}

mkdirSync(outDir, { recursive: true });
const io = new NodeIO();
const models = {
  tree: await broadleafTree({ preset: 'Oak Medium', species: 'oak', seed: 7, height: 10 }),
  'tree-tall': await broadleafTree({ preset: 'Ash Large', species: 'ash', seed: 19, height: 14 }),
  rock: await boulder({ seed: 3, radius: 1 }),
  'rock-flat': await boulder({ seed: 11, radius: 1, scale: { x: 1.5, y: 0.45, z: 1.1 }, sharpness: 0.8 }),
  grass: grassPatch({ seed: 5, ...NEAR_GRASS }),
  'grass-far': grassPatch({ seed: 9, ...FAR_GRASS }),
};
for (const [file, parts] of Object.entries(models)) await io.write(join(outDir, `${file}.glb`), await staticModel(file, parts));
console.log(`wrote ${Object.keys(models).map((m) => `${m}.glb`).join(', ')} to ${outDir}`);
