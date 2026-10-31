import * as THREE from 'three';
import { JSDOM } from 'jsdom';

export const BARK_TILE_METRES = 0.8;

globalThis.document ??= new JSDOM().window.document;
const { Tree } = await import('@dgreenheck/ez-tree');

const HULL_SEGMENTS = 8;

function growRecordingBranches(preset, seed) {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  const branches = [];
  const grow = tree.generateBranch.bind(tree);
  tree.generateBranch = (branch) => {
    branches.push({ start: tree.branches.verts.length / 3, sections: branch.sectionCount, segments: branch.segmentCount, level: branch.level });
    grow(branch);
  };
  tree.generate();
  return { tree, branches };
}

const vertexAt = (verts, index, scale) => [verts[index * 3] * scale, verts[index * 3 + 1] * scale, verts[index * 3 + 2] * scale];

function ringCentre(verts, branch, ring, scale) {
  const centre = [0, 0, 0];
  for (let j = 0; j < branch.segments; j++) {
    const p = vertexAt(verts, branch.start + ring * (branch.segments + 1) + j, scale);
    centre.forEach((_, k) => (centre[k] += p[k] / branch.segments));
  }
  return centre;
}

function ringRadius(verts, branch, ring, scale) {
  const centre = ringCentre(verts, branch, ring, scale);
  const p = vertexAt(verts, branch.start + ring * (branch.segments + 1), scale);
  return Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]);
}

function barkUvs(tree, branches, scale) {
  const verts = tree.branches.verts;
  const uvs = new Array((verts.length / 3) * 2).fill(0);
  for (const branch of branches) {
    const around = Math.max(1, Math.round((2 * Math.PI * ringRadius(verts, branch, 0, scale)) / BARK_TILE_METRES));
    let distance = 0;
    let previous = ringCentre(verts, branch, 0, scale);
    for (let ring = 0; ring <= branch.sections; ring++) {
      const centre = ringCentre(verts, branch, ring, scale);
      distance += Math.hypot(centre[0] - previous[0], centre[1] - previous[1], centre[2] - previous[2]);
      previous = centre;
      for (let j = 0; j <= branch.segments; j++) {
        const index = branch.start + ring * (branch.segments + 1) + j;
        uvs[index * 2] = (j / branch.segments) * around;
        uvs[index * 2 + 1] = -distance / BARK_TILE_METRES;
      }
    }
  }
  return uvs;
}

function trunkHull(tree, trunk, scale) {
  const verts = tree.branches.verts;
  const top = Math.max(1, Math.round(trunk.sections * 0.45));
  const bottom = ringCentre(verts, trunk, 0, scale);
  const upper = ringCentre(verts, trunk, top, scale);
  const radius = ringRadius(verts, trunk, 0, scale) * 0.85;
  const positions = [];
  const indices = [];
  for (const [ring, centre] of [bottom, upper].entries()) {
    for (let j = 0; j < HULL_SEGMENTS; j++) {
      const angle = (j / HULL_SEGMENTS) * Math.PI * 2;
      positions.push(centre[0] + Math.cos(angle) * radius, centre[1] - (ring ? 0 : 0.3), centre[2] + Math.sin(angle) * radius);
    }
  }
  for (let j = 0; j < HULL_SEGMENTS; j++) {
    const next = (j + 1) % HULL_SEGMENTS;
    indices.push(j, j + HULL_SEGMENTS, next, next, j + HULL_SEGMENTS, next + HULL_SEGMENTS);
  }
  for (let j = 1; j + 1 < HULL_SEGMENTS; j++) indices.push(0, j + 1, j, HULL_SEGMENTS, HULL_SEGMENTS + j, HULL_SEGMENTS + j + 1);
  return { positions, normals: positions.map((_, i) => (i % 3 === 1 ? 1 : 0)), uvs: new Array((positions.length / 3) * 2).fill(0), indices };
}

function crownNormals(leaves, scale) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(leaves.verts), 3));
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox.getCenter(new THREE.Vector3()).multiplyScalar(scale);
  const normals = [];
  for (let i = 0; i < leaves.verts.length; i += 3) {
    const outward = new THREE.Vector3(leaves.verts[i] * scale, leaves.verts[i + 1] * scale, leaves.verts[i + 2] * scale).sub(centre).normalize();
    const card = new THREE.Vector3(leaves.normals[i], leaves.normals[i + 1], leaves.normals[i + 2]);
    if (card.dot(outward) < 0) card.negate();
    normals.push(...card.lerp(outward, 0.65).normalize().toArray());
  }
  return normals;
}

function tallestSide(tree) {
  const box = new THREE.Box3().setFromObject(tree);
  return Math.max(0.001, box.max.y - box.min.y);
}

export function ezTree({ preset, seed, height }) {
  const { tree, branches } = growRecordingBranches(preset, seed);
  const scale = height / tallestSide(tree);
  const leafNormals = tree.leavesMesh.geometry.getAttribute('normal').array;
  tree.leaves.normals = Array.from(leafNormals);
  const bark = {
    positions: tree.branches.verts.map((v) => v * scale),
    normals: tree.branches.normals.slice(),
    uvs: barkUvs(tree, branches, scale),
    indices: tree.branches.indices.slice(),
  };
  const leaves = {
    positions: tree.leaves.verts.map((v) => v * scale),
    normals: crownNormals(tree.leaves, scale),
    uvs: tree.leaves.uvs.map((v, i) => (i % 2 ? 1 - v : v)),
    indices: tree.leaves.indices.slice(),
  };
  const card = tree.options.leaves.size * scale;
  return { bark, leaves, hull: trunkHull(tree, branches[0], scale), cardMetres: card };
}
