import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';

const outDir = join(import.meta.dirname, '../../src/features/world/assets/vehicle');

const WHEEL_RADIUS = 0.36;
const WHEEL_WIDTH = 0.26;
const WHEELS = {
  Wheel_FL: [1.32, -0.86, WHEEL_RADIUS],
  Wheel_FR: [1.32, 0.86, WHEEL_RADIUS],
  Wheel_RL: [-1.28, -0.86, WHEEL_RADIUS],
  Wheel_RR: [-1.28, 0.86, WHEEL_RADIUS],
};

const yUp = ([x, y, z]) => [x, z, -y];

function shape() {
  const positions = [];
  const normals = [];
  const indices = [];
  const quad = (corners, normal) => {
    const base = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      normals.push(...normal);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  return { positions, normals, indices, quad };
}

function box([x0, y0, z0], [x1, y1, z1], target = shape()) {
  target.quad([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0]);
  target.quad([[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [0, 1, 0]);
  target.quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], [1, 0, 0]);
  target.quad([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], [-1, 0, 0]);
  target.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1]);
  target.quad([[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]], [0, 0, -1]);
  return target;
}

function wheel([cx, cy, cz], sides = 28) {
  const target = shape();
  const half = WHEEL_WIDTH / 2;
  const at = (angle, y) => [cx + Math.cos(angle) * WHEEL_RADIUS, cy + y, cz + Math.sin(angle) * WHEEL_RADIUS];
  for (let side = 0; side < sides; side++) {
    const [a, b] = [side / sides, (side + 1) / sides].map((t) => t * 2 * Math.PI);
    const middle = (a + b) / 2;
    target.quad([at(a, -half), at(a, half), at(b, half), at(b, -half)], [Math.cos(middle), 0, Math.sin(middle)]);
    for (const [y, normal] of [[-half, [0, -1, 0]], [half, [0, 1, 0]]]) {
      const base = target.positions.length / 3;
      target.positions.push(cx, cy + y, cz, ...at(a, y), ...at(b, y));
      target.normals.push(...normal, ...normal, ...normal);
      target.indices.push(...(y < 0 ? [base, base + 1, base + 2] : [base, base + 2, base + 1]));
    }
  }
  return target;
}

const parts = [
  { material: 'Paint', color: [0.62, 0.05, 0.04, 1], roughness: 0.35, metallic: 0.6, joint: 0, ...box([-2.05, -0.82, 0.32], [2.1, 0.82, 0.92]) },
  { material: 'Glass', color: [0.04, 0.05, 0.06, 1], roughness: 0.1, metallic: 0, joint: 0, ...box([-1.15, -0.72, 0.92], [0.55, 0.72, 1.38]) },
  ...Object.values(WHEELS).map((centre, index) => ({ material: 'Tyre', color: [0.03, 0.03, 0.03, 1], roughness: 0.9, metallic: 0, joint: index + 1, ...wheel(centre) })),
];

function vehicleModel(name) {
  const document = new Document();
  const buffer = document.createBuffer();
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  const root = document.createNode('Root');
  const joints = [root, ...Object.entries(WHEELS).map(([bone, centre]) => document.createNode(bone).setTranslation(yUp(centre)))];
  for (const joint of joints.slice(1)) root.addChild(joint);
  const skin = document.createSkin('skin');
  for (const joint of joints) skin.addJoint(joint);
  const inverse = joints.flatMap((joint) => {
    const [x, y, z] = joint.getTranslation();
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -x, -y, -z, 1];
  });
  skin.setInverseBindMatrices(accessor('MAT4', new Float32Array(inverse)));
  const materials = new Map();
  const mesh = document.createMesh(name);
  for (const part of parts) {
    if (!materials.has(part.material)) materials.set(part.material, document.createMaterial(part.material).setBaseColorFactor(part.color).setRoughnessFactor(part.roughness).setMetallicFactor(part.metallic));
    const count = part.positions.length / 3;
    const positions = [];
    const normals = [];
    for (let index = 0; index < part.positions.length; index += 3) {
      positions.push(...yUp(part.positions.slice(index, index + 3)));
      normals.push(...yUp(part.normals.slice(index, index + 3)));
    }
    mesh.addPrimitive(
      document
        .createPrimitive()
        .setMaterial(materials.get(part.material))
        .setIndices(accessor('SCALAR', new Uint32Array(part.indices)))
        .setAttribute('POSITION', accessor('VEC3', new Float32Array(positions)))
        .setAttribute('NORMAL', accessor('VEC3', new Float32Array(normals)))
        .setAttribute('JOINTS_0', accessor('VEC4', new Uint16Array(Array.from({ length: count }, () => [part.joint, 0, 0, 0]).flat())))
        .setAttribute('WEIGHTS_0', accessor('VEC4', new Float32Array(Array.from({ length: count }, () => [1, 0, 0, 0]).flat()))),
    );
  }
  document.createScene(name).addChild(root).addChild(document.createNode(name).setMesh(mesh).setSkin(skin));
  return document;
}

mkdirSync(outDir, { recursive: true });
await new NodeIO().write(join(outDir, 'car.glb'), vehicleModel('Car'));
console.log(`wrote car.glb to ${outDir}`);
