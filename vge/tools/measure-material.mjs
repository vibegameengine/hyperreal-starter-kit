// Measures a material edit end to end in a running game: writes a new version of the lava material module (a marker
// in its Custom HLSL, so every run is a shader the cache has never seen), then reads the game until both meshes that
// use it (the packed cube and the sphere's dynamic instance) draw the new asset. Latency = that moment - the time
// the file write finished. Per run it also prints the build's own timings and the cook's shader compile stats.
//   node vge/tools/measure-material.mjs [runs]          (the game shows labs/materials: npm run play -- --lab materials)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { devServerUrl, unrealRoot } from './engine.mjs';

const runs = Number(process.argv[2] ?? '3');
const modulePath = new URL('../../src/features/materials/assets/lava.tsx', import.meta.url);
const original = readFileSync(modulePath, 'utf8');
const pipelineDir = join(unrealRoot, 'Plugins', 'VgeLive', 'Saved', 'Pipeline');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function evaluate(code) {
  const response = await fetch(`${devServerUrl()}/__vge/eval`, { method: 'POST', body: JSON.stringify({ code, timeoutMs: 3000 }) });
  const { results } = await response.json();
  if (!results?.[0]?.ok) throw new Error(`the game did not answer: ${results?.[0]?.error ?? 'no game connected'}`);
  return results[0].result;
}

// The lava's asset as each mesh draws it: the sphere's dynamic instance's parent, the packed cube's material.
async function drawn() {
  const report = await evaluate('materialsLab.report()');
  const cube = report.packed.find((group) => group.material?.class === 'Material');
  return { sphere: report.sphere?.parent ?? null, cube: cube?.material?.path ?? null };
}

const newestBuild = () =>
  readdirSync(pipelineDir)
    .filter((name) => /^b\d{4}$/.test(name))
    .sort()
    .at(-1);

function cookStats(build) {
  const log = join(pipelineDir, build, 'cook.log');
  if (!existsSync(log)) return {};
  const text = readFileSync(log, 'utf8');
  const pick = (re) => re.exec(text)?.[1];
  return {
    jobQueries: Number(pick(/Total job queries (\d+)/) ?? 0),
    ddcHits: Number(pick(/DDC hits (\d+)/) ?? 0),
    shadersCompiled: Number(pick(/Shaders Compiled: (\d+)/) ?? 0),
    batches: pick(/Jobs were issued in (\d+) batches/),
    jobsPerBatch: pick(/average ([\d.]+) jobs\/batch/),
    parallelization: pick(/Effective parallelization: ([\d.]+)/),
    inFlight: pick(/Time at least one job was in flight \(either pending or executed\): ([\d.]+) s/),
    formats: [...new Set([...text.matchAll(/Missing cached shadermap for \S+ in (\w+)/g)].map((m) => m[1]))],
  };
}

const results = [];
try {
  for (let run = 0; run < runs; run++) {
    const before = await drawn();
    if (!before.sphere || !before.cube) throw new Error(`the lab does not show the lava yet: ${JSON.stringify(before)}`);
    const stamp = `${Date.now().toString(36)}${run}`;
    // A constant of the shader itself: the shader compile cache keys on the preprocessed source, without comments.
    writeFileSync(modulePath, original.replace('v * 1.6', `v * (1.6 + ${(Date.now() % 100000) / 1e9})`));
    const written = Date.now();
    let now = before;
    let sphereAt;
    let cubeAt;
    while (Date.now() - written < 120_000 && !(sphereAt && cubeAt)) {
      await sleep(50);
      now = await drawn();
      if (!sphereAt && now.sphere !== before.sphere) sphereAt = Date.now();
      if (!cubeAt && now.cube !== before.cube) cubeAt = Date.now();
    }
    if (!sphereAt || !cubeAt) throw new Error(`run ${run}: the new material did not reach both meshes in 120 s: ${JSON.stringify(now)}`);
    const build = newestBuild();
    const timingsFile = join(pipelineDir, build, 'timings.json');
    const timings = existsSync(timingsFile) ? JSON.parse(readFileSync(timingsFile, 'utf8')).timings : null;
    results.push({ run, seconds: (Math.max(sphereAt, cubeAt) - written) / 1000, build, asset: now.cube, timings, cook: cookStats(build) });
    console.log(JSON.stringify(results.at(-1)));
    // The standby cook process of the next build starts after this one (content/cooker.mjs); an edit is measured
    // the way one lands seconds after the previous build, with that process ready.
    await sleep(15000);
  }
} finally {
  writeFileSync(modulePath, original);
}
const seconds = results.map((r) => r.seconds).sort((a, b) => a - b);
console.log(JSON.stringify({ runs: seconds, median_s: seconds[Math.floor(seconds.length / 2)], max_s: seconds.at(-1) }));
