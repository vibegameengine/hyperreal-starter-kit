import { readFileSync, statSync } from 'node:fs';

const DEFINES = {
  material: { from: 'material', names: ['defineMaterial', 'defineInstance'] },
  niagara: { from: 'niagara', names: ['defineSystem'] },
  terrain: { from: 'terrain', names: ['defineTerrain'] },
  motion: { from: 'motion', names: ['defineMotionMatching'] },
  compute: { from: 'compute', names: ['defineCompute'] },
  pcg: { from: 'pcg', names: ['defineGraph'] },
  fracture: { from: 'fracture', names: ['defineFracture'] },
  vehicle: { from: 'vehicle', names: ['defineVehicle'] },
  groom: { from: 'groom', names: ['defineGroom'] },
};

export const CONTENT_KINDS = Object.keys(DEFINES);

const CODE = /\.[jt]sx?$/;
const NAMED_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const known = new Map();

function kindsIn(source) {
  const kinds = new Set();
  for (const [, names, specifier] of source.matchAll(NAMED_IMPORT)) {
    const imported = names.split(',').map((name) => name.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, ''));
    for (const [kind, define] of Object.entries(DEFINES)) {
      const fromShared = new RegExp(`(^|/)shared/${define.from}(/index(\\.[jt]sx?)?)?$`).test(specifier);
      if (fromShared && imported.some((name) => define.names.includes(name))) kinds.add(kind);
    }
  }
  return kinds;
}

export function contentKindsOf(file) {
  const path = file.split('?')[0].replaceAll('\\', '/');
  if (!CODE.test(path) || path.includes('/shared/') || path.endsWith('.d.ts')) return new Set();
  let modified;
  try {
    modified = statSync(path).mtimeMs;
  } catch {
    return new Set();
  }
  const cached = known.get(path);
  if (cached?.modified === modified) return cached.kinds;
  const kinds = kindsIn(readFileSync(path, 'utf8'));
  known.set(path, { modified, kinds });
  return kinds;
}

export const contentModule = (kind) => ({ test: (file) => contentKindsOf(file).has(kind) });
