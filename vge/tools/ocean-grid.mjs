import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

const GRID = 32;
const STRIP = 8;
const outDir = join(import.meta.dirname, '../../src/features/world/assets/ocean');

const side = GRID + 1;
const positions = new Float32Array(side * side * 3);
const normals = new Float32Array(side * side * 3);
const uvs = new Float32Array(side * side * 2);
for (let j = 0; j <= GRID; j++) {
  for (let i = 0; i <= GRID; i++) {
    const v = j * side + i;
    positions.set([i / GRID, 0, j / GRID], v * 3);
    normals.set([0, 1, 0], v * 3);
    uvs.set([i / GRID, j / GRID], v * 2);
  }
}
const indices = [];
for (let i0 = 0; i0 < GRID; i0 += STRIP) {
  for (let j = 0; j < GRID; j++) {
    for (let i = i0; i < Math.min(i0 + STRIP, GRID); i++) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      if ((i + j) % 2 === 0) indices.push(a, c, b, b, c, d);
      else indices.push(a, c, d, a, d, b);
    }
  }
}

const document = new Document();
const buffer = document.createBuffer();
const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const material = document.createMaterial('Ocean');
const primitive = document
  .createPrimitive()
  .setMaterial(material)
  .setIndices(accessor('SCALAR', new Uint32Array(indices)))
  .setAttribute('POSITION', accessor('VEC3', positions))
  .setAttribute('NORMAL', accessor('VEC3', normals))
  .setAttribute('TEXCOORD_0', accessor('VEC2', uvs));
document.createScene('ocean_grid').addChild(document.createNode('ocean_grid').setMesh(document.createMesh('ocean_grid').addPrimitive(primitive)));
await new NodeIO().write(join(outDir, 'grid.glb'), document);
writeFileSync(join(outDir, 'grid.mesh.json'), `${JSON.stringify({ nanite: false }, null, 2)}\n`);
console.log(`wrote grid.glb, ${side * side} vertices, ${indices.length / 3} triangles`);
