import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const blender = process.env.BLENDER ?? 'C:/Program Files (x86)/Steam/steamapps/common/Blender/blender.exe';
const outDir = join(import.meta.dirname, '../../src/features/character/assets/hair');

const LONG_HAIR = {
  file: 'long-hair.abc',
  seed: 7,
  strands: 12000,
  points: 18,
  scalp: { centre: [0, 1.5, 170.5], radius: 10.8 },
  length: [48, 62],
  fall: 0.82,
  outward: 3.5,
  shoulders: { centre: [0, -2, 146], radius: 21 },
};

const script = (groom, target) => `
import bpy, math, random
groom = ${JSON.stringify(groom)}
random.seed(groom['seed'])
bpy.ops.wm.read_factory_settings(use_empty=True)
cx, cy, cz = groom['scalp']['centre']
r = groom['scalp']['radius']
sx, sy, sz = groom['shoulders']['centre']
sr = groom['shoulders']['radius']
curve = bpy.data.curves.new('LongHair', 'CURVE')
curve.dimensions = '3D'
made = 0
while made < groom['strands']:
    z = random.uniform(-0.25, 1.0)
    a = random.uniform(0, 2 * math.pi)
    ring = math.sqrt(max(0.0, 1 - z * z))
    nx, ny, nz = ring * math.cos(a), ring * math.sin(a), z
    if ny > 0.25 and nz < 0.75:
        continue
    if nz < 0.1 and abs(nx) < 0.55 and ny > -0.2:
        continue
    root = (cx + nx * r, cy + ny * r, cz + nz * r)
    length = random.uniform(*groom['length'])
    spline = curve.splines.new('POLY')
    spline.points.add(groom['points'] - 1)
    for i in range(groom['points']):
        t = i / (groom['points'] - 1)
        drop = length * t * groom['fall']
        spread = groom['outward'] * math.sin(min(1.0, t * 3) * math.pi / 2)
        x = root[0] + nx * spread
        y = root[1] + ny * spread - length * t * (1 - groom['fall']) * 0.6
        zz = root[2] + nz * spread * 0.5 - drop * t ** 0.35
        dx, dy, dz = x - sx, y - sy, zz - sz
        d = math.sqrt(dx * dx + dy * dy)
        if zz < sz + 6 and d < sr:
            k = sr / max(d, 0.001)
            x, y = sx + dx * k, sy + dy * k
        spline.points[i].co = (x, -zz, y, 1.0)
        spline.points[i].radius = 0.004 * (1 - 0.7 * t)
    made += 1
obj = bpy.data.objects.new('LongHair', curve)
bpy.context.scene.collection.objects.link(obj)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.wm.alembic_export(filepath=${JSON.stringify(target)}, selected=True, curves_as_mesh=False, export_hair=False, export_particles=False, global_scale=1.0)
print('wrote', made, 'strands')
`;

mkdirSync(outDir, { recursive: true });
for (const groom of [LONG_HAIR]) {
  const target = join(outDir, groom.file).replaceAll('\\', '/');
  const file = join(tmpdir(), `vge-groom-${groom.seed}.py`);
  writeFileSync(file, script(groom, target));
  const run = spawnSync(blender, ['-b', '--factory-startup', '--python', file], { encoding: 'utf8' });
  const wrote = /wrote (\d+) strands/.exec(run.stdout ?? '');
  if (run.status !== 0 || !wrote) throw new Error(`Blender did not write ${groom.file}:\n${run.stdout}\n${run.stderr}`);
  console.log(`[hair] ${groom.file}: ${wrote[1]} strands -> ${target}`);
}
