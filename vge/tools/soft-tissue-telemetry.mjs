import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { devServerUrl } from './engine.mjs';

const { values } = parseArgs({
  options: {
    motion: { type: 'string', default: 'walk' },
    physics: { type: 'string', default: 'on' },
    stiffness: { type: 'string', default: '1' },
    decay: { type: 'string' },
    bounce: { type: 'string', default: '1' },
    seconds: { type: 'string', default: '10' },
    only: { type: 'string' },
    angular: { type: 'string', default: 'on' },
    colliders: { type: 'string', default: 'on' },
    gravity: { type: 'string', default: 'on' },
    drive: { type: 'string', default: 'on' },
    out: { type: 'string' },
  },
});

const scene = 'labs/soft-tissue';
const seconds = Number(values.seconds);
const isolation = { angularSpring: values.angular === 'on', colliders: values.colliders === 'on', gravity: values.gravity === 'on', drive: values.drive === 'on', ...(values.only ? { bones: values.only.split(',') } : {}) };
const variant = `${values.motion}-physics-${values.physics}-stiffness-${values.stiffness}-decay-${values.decay ?? 'preset'}-bounce-${values.bounce}-angular-${values.angular}-colliders-${values.colliders}-gravity-${values.gravity}${values.only ? `-only-${values.only.replace(/,/g, '+')}` : ''}`;
const out = resolve(values.out ?? `wip/soft-tissue/telemetry-${variant}-${Date.now()}.json`);

async function evaluate(code, timeoutMs = 5000) {
  const response = await fetch(`${devServerUrl()}/__vge/eval`, { method: 'POST', body: JSON.stringify({ code, timeoutMs, scene }) });
  const { results } = await response.json();
  const reply = results.find((each) => !each.skipped);
  if (!reply) throw new Error(`no world is on scene ${scene}: npm run play -- --lab soft-tissue`);
  if (!reply.ok) throw new Error(reply.error);
  return reply.result;
}

await evaluate(`(() => { const lab = globalThis.softTissueLab; lab.setMotion(${JSON.stringify(values.motion)}); lab.setPhysics(${values.physics === 'on'}); lab.setStiffness(${Number(values.stiffness)}); lab.setDecay(${values.decay === undefined ? 'undefined' : Number(values.decay)}); lab.setBounce(${Number(values.bounce)}); lab.setIsolation(${JSON.stringify(isolation)}); return true; })()`);
await new Promise((done) => setTimeout(done, 300));
await evaluate('globalThis.softTissueLab.resetDynamics()');
await new Promise((done) => setTimeout(done, 1000));
await evaluate('globalThis.softTissueLab.clear()');
await new Promise((done) => setTimeout(done, seconds * 1000));
const report = await evaluate(
  `(() => { const lab = globalThis.softTissueLab; const summary = lab.summary(); return { graph: lab.graph()?.DescribeGraph() ?? '', summary, samples: Object.fromEntries(summary.map((tissue) => [tissue.bone, lab.samples(tissue.bone)])) }; })()`,
  20000,
);
const simulated = (report.graph.match(/animDynamics#/g) ?? []).length;
if (values.physics === 'on' && simulated === 0) throw new Error(`the running graph has no animDynamics node, the numbers would be the bare animation: ${report.graph || '(empty graph)'}`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ scene, ...values, recordedAt: new Date().toISOString(), ...report }, null, 1));
console.log(`[soft-tissue-telemetry] ${report.summary.length} bones, ${report.summary[0]?.samples ?? 0} frames each -> ${out}`);
for (const tissue of report.summary) {
  const range = (axis) => `${tissue.min[axis].toFixed(2)}..${tissue.max[axis].toFixed(2)}`;
  console.log(`${tissue.bone.padEnd(12)} x ${range(0)}  y ${range(1)}  z ${range(2)} cm  rms ${tissue.rms.toFixed(2)}  ${tissue.peakAngle.toFixed(1)} deg  scale ${tissue.scaleRange.map((value) => value.toFixed(3)).join('..')}  ${tissue.crossingsPerSecond.toFixed(2)} Hz`);
}
