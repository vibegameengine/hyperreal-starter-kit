import { seededRandom } from './noise.mjs';

const CLUMP_METRES = 0.12;
const UP_SHARE = 0.6;
const FOLD_RADIANS = 0.45;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const rotateAround = (v, axis, angle) => add(add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))), scale(axis, (axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]) * (1 - Math.cos(angle))));

const BLADE_KINDS = [
  { share: 0.82, width: [0.003, 0.0055], height: 1, kind: 0 },
  { share: 0.14, width: [0.006, 0.009], height: 0.8, kind: 0 },
  { share: 0.04, width: [0.0012, 0.0018], height: 1.6, kind: 1 },
];

function kindOf(roll) {
  let total = 0;
  for (const kind of BLADE_KINDS) {
    total += kind.share;
    if (roll < total) return kind;
  }
  return BLADE_KINDS[0];
}

function clumpField(next) {
  const clumps = new Map();
  return (x, z) => {
    const key = `${Math.floor(x / CLUMP_METRES)},${Math.floor(z / CLUMP_METRES)}`;
    if (!clumps.has(key)) {
      const tall = Math.exp((next() - 0.5) * 1.3);
      clumps.set(key, { height: 0.24 * tall, facing: next() * Math.PI * 2, lean: 0.1 + next() * 0.35, shade: next() });
    }
    return clumps.get(key);
  };
}

function bladeFrame(blade, t) {
  const bend = blade.lean * t * t;
  const facing = [Math.cos(blade.facing), 0, Math.sin(blade.facing)];
  const centre = [blade.x + facing[0] * bend * blade.height, blade.height * t * Math.cos(bend), blade.z + facing[2] * bend * blade.height];
  const along = normalize([facing[0] * 2 * blade.lean * t, 1, facing[2] * 2 * blade.lean * t]);
  const across = rotateAround([-facing[2], 0, facing[0]], along, blade.twist * t);
  return { centre, along, across };
}

function emitBlade(target, blade, segments) {
  const base = target.positions.length / 3;
  for (let step = 0; step <= segments; step++) {
    const t = step / segments;
    const { centre, along, across } = bladeFrame(blade, t);
    const half = blade.width * 0.5 * Math.pow(1 - t, 0.6) + 0.0002;
    const face = normalize(cross(across, along));
    const lift = (normal) => normalize(add(scale([0, 1, 0], UP_SHARE), scale(normal, 1 - UP_SHARE)));
    target.positions.push(...add(centre, scale(across, -half)), ...add(centre, scale(across, half)));
    target.normals.push(...lift(rotateAround(face, along, FOLD_RADIANS)), ...lift(rotateAround(face, along, -FOLD_RADIANS)));
    target.uvs.push(0, 1 - t, 1, 1 - t);
    target.colors.push(blade.shade, blade.clumpShade, blade.kind, 1, blade.shade, blade.clumpShade, blade.kind, 1);
  }
  for (let step = 0; step < segments; step++) {
    const a = base + step * 2;
    target.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
}

export function grassPatch({ seed, size, blades: count, widthScale, segments }) {
  const next = seededRandom(seed);
  const clumpAt = clumpField(next);
  const target = { positions: [], normals: [], uvs: [], indices: [], colors: [] };
  for (let i = 0; i < count; i++) {
    const x = (next() - 0.5) * size;
    const z = (next() - 0.5) * size;
    const clump = clumpAt(x + size, z + size);
    const kind = kindOf(next());
    const blade = {
      x,
      z,
      height: clump.height * kind.height * (0.7 + next() * 0.6),
      width: (kind.width[0] + next() * (kind.width[1] - kind.width[0])) * widthScale,
      facing: clump.facing + (next() - 0.5) * 2.2,
      lean: clump.lean * (kind.kind ? 0.4 : 1) + (next() - 0.5) * 0.15,
      twist: (next() - 0.5) * 1.6,
      shade: clump.shade * 0.5 + next() * 0.5,
      clumpShade: clump.shade,
      kind: kind.kind,
    };
    emitBlade(target, blade, segments);
  }
  return [{ name: 'Grass', color: [0.25, 0.42, 0.12, 1], roughness: 0.75, ...target }];
}
