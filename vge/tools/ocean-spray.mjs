import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

const REACH = 260;
const BELOW = -10;
const ABOVE = 40;
const outDir = join(import.meta.dirname, '../../src/features/world/assets/ocean');

const corners = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];
const positions = new Float32Array(corners.length * 3);
const normals = new Float32Array(corners.length * 3);
const uvs = new Float32Array(corners.length * 2);
corners.forEach(([x, y], v) => {
  positions.set([x * REACH, v % 2 ? ABOVE : BELOW, y * REACH], v * 3);
  normals.set([0, 1, 0], v * 3);
  uvs.set([x, y], v * 2);
});
const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

const document = new Document();
const buffer = document.createBuffer();
const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const material = document.createMaterial('Spray');
const primitive = document
  .createPrimitive()
  .setMaterial(material)
  .setIndices(accessor('SCALAR', indices))
  .setAttribute('POSITION', accessor('VEC3', positions))
  .setAttribute('NORMAL', accessor('VEC3', normals))
  .setAttribute('TEXCOORD_0', accessor('VEC2', uvs));
document.createScene('spray_sprite').addChild(document.createNode('spray_sprite').setMesh(document.createMesh('spray_sprite').addPrimitive(primitive)));
await new NodeIO().write(join(outDir, 'spray.glb'), document);
console.log(`wrote spray.glb, ${corners.length} vertices, ${indices.length / 3} triangles`);
