import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

const PROFILE_VERTICES = 20;
const REACH = 135;
const BELOW = -5;
const ABOVE = 10;
const outDir = join(import.meta.dirname, '../../src/features/world/assets/ocean');

const count = PROFILE_VERTICES * 2;
const positions = new Float32Array(count * 3);
const normals = new Float32Array(count * 3);
const uvs = new Float32Array(count * 2);
for (let side = 0; side < 2; side++) {
  for (let k = 0; k < PROFILE_VERTICES; k++) {
    const v = side * PROFILE_VERTICES + k;
    positions.set([(k / (PROFILE_VERTICES - 1)) * 2 * REACH - REACH, k % 2 ? ABOVE : BELOW, side * 2 * REACH - REACH], v * 3);
    normals.set([0, 1, 0], v * 3);
    uvs.set([k, side], v * 2);
  }
}
const indices = [];
for (let k = 0; k < PROFILE_VERTICES - 1; k++) {
  const a = k;
  const b = k + 1;
  const c = PROFILE_VERTICES + k;
  const d = PROFILE_VERTICES + k + 1;
  indices.push(a, c, b, b, c, d);
}

const document = new Document();
const buffer = document.createBuffer();
const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const material = document.createMaterial('BreakerLip');
const primitive = document
  .createPrimitive()
  .setMaterial(material)
  .setIndices(accessor('SCALAR', new Uint32Array(indices)))
  .setAttribute('POSITION', accessor('VEC3', positions))
  .setAttribute('NORMAL', accessor('VEC3', normals))
  .setAttribute('TEXCOORD_0', accessor('VEC2', uvs));
document.createScene('breaker_lip').addChild(document.createNode('breaker_lip').setMesh(document.createMesh('breaker_lip').addPrimitive(primitive)));
await new NodeIO().write(join(outDir, 'lip.glb'), document);
console.log(`wrote lip.glb, ${count} vertices, ${indices.length / 3} triangles`);
