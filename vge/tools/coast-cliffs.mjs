import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { COAST_HALF_SIZE } from '../../src/features/world/assets/coastShape.ts';
import { cliffSheets, STEP } from './rock/cliffSheet.mjs';

const outDir = join(import.meta.dirname, '../../src/features/world/assets/coast/cliffs');
const PIECE_COLUMNS = 600;
const CM_PER_METRE = 100;

function pieces(sheet) {
  const rows = sheet.positions.length / 3 / (sheet.length / STEP);
  const columns = sheet.positions.length / 3 / rows;
  const keep = sheet.indices[1] === sheet.indices[0] + 1;
  const result = [];
  for (let start = 0; start < columns - 1; start += PIECE_COLUMNS) {
    const end = Math.min(columns, start + PIECE_COLUMNS + 1);
    const positions = sheet.positions.slice(start * rows * 3, end * rows * 3);
    const colors = sheet.colors.slice(start * rows * 4, end * rows * 4);
    const indices = [];
    for (let i = 0; i + 1 < end - start; i++) {
      for (let r = 0; r + 1 < rows; r++) {
        const a = i * rows + r;
        const b = a + rows;
        if (keep) indices.push(a, a + 1, b, b, a + 1, b + 1);
        else indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    result.push({ positions, colors, indices });
  }
  return result;
}

function normalsOf(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      normals[i] += nx;
      normals[i + 1] += ny;
      normals[i + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= l;
    normals[i + 1] /= l;
    normals[i + 2] /= l;
  }
  return normals;
}

function addPiece(document, buffer, material, name, piece) {
  const { positions, colors, indices } = piece;
  const normals = normalsOf(positions, indices);
  const gltf = new Float32Array(positions.length);
  const gltfNormals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    gltf[i] = positions[i] / CM_PER_METRE;
    gltf[i + 1] = positions[i + 2] / CM_PER_METRE;
    gltf[i + 2] = positions[i + 1] / CM_PER_METRE;
    gltfNormals[i] = normals[i];
    gltfNormals[i + 1] = normals[i + 2];
    gltfNormals[i + 2] = normals[i + 1];
  }
  const flipped = new Uint32Array(indices.length);
  for (let t = 0; t < indices.length; t += 3) {
    flipped[t] = indices[t];
    flipped[t + 1] = indices[t + 2];
    flipped[t + 2] = indices[t + 1];
  }
  const uvs = new Float32Array((positions.length / 3) * 2);
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const primitive = document
    .createPrimitive()
    .setMaterial(material)
    .setIndices(accessor('SCALAR', flipped))
    .setAttribute('POSITION', accessor('VEC3', gltf))
    .setAttribute('NORMAL', accessor('VEC3', gltfNormals))
    .setAttribute('TEXCOORD_0', accessor('VEC2', uvs))
    .setAttribute('COLOR_0', accessor('VEC4', colors));
  return document.createNode(name).setMesh(document.createMesh(name).addPrimitive(primitive));
}

const started = Date.now();
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, '.gitignore'), '*\n!.gitignore\n');
const document = new Document();
const buffer = document.createBuffer();
const material = document.createMaterial('Cliff').setBaseColorFactor([0.5, 0.48, 0.45, 1]).setRoughnessFactor(0.9).setMetallicFactor(0);
const scene = document.createScene('coast_cliffs');
let triangles = 0;
for (const [s, sheet] of cliffSheets(COAST_HALF_SIZE * 0.98).entries()) {
  for (const [p, piece] of pieces(sheet).entries()) {
    scene.addChild(addPiece(document, buffer, material, `cliff_${s}_${p}`, piece));
    triangles += piece.indices.length / 3;
  }
}
await new NodeIO().write(join(outDir, 'coast_cliffs.glb'), document);
writeFileSync(join(outDir, 'segments.ts'), `import coastCliffs from './coast_cliffs.glb';\n\nexport const COAST_CLIFFS = coastCliffs;\n`);
console.log(`wrote coast_cliffs.glb, ${scene.listChildren().length} pieces, ${triangles} triangles, in ${((Date.now() - started) / 1000).toFixed(1)} s`);
