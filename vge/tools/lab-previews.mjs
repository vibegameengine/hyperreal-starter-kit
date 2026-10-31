import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { devServerUrl, runtimeDir } from './engine.mjs';
import { startGame } from './game-process.mjs';
import { labIds } from './lab-registry.mjs';

const { values, positionals } = parseArgs({ options: { settle: { type: 'string', default: '6' } }, allowPositionals: true });
const settleMs = Number(values.settle) * 1000;
const root = resolve(import.meta.dirname, '../..');
const previewsDir = join(root, 'src', 'ui', 'app', 'ui', 'labs', 'previews');
const screenshotsDir = join(runtimeDir(), 'Build', 'Package', 'Windows', 'VibeGameEngine', 'Saved', 'Screenshots', 'Windows');
const PREVIEW_WIDTH = 960;
const CAPTURE = { width: 1600, height: 900 };

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function evalInGames(code, timeoutMs = 5000) {
  const response = await fetch(`${devServerUrl()}/__vge/eval`, { method: 'POST', body: JSON.stringify({ code, timeoutMs }) });
  return response.json();
}

async function waitForScene(scene, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { results } = await evalInGames('__vge.app?.scene ?? null').catch(() => ({ results: [] }));
    if (results.some((reply) => reply.ok && reply.result === scene)) return;
    await sleep(500);
  }
  throw new Error(`${scene} did not open within ${timeoutMs / 1000} s`);
}

function newestScreenshot(after) {
  if (!existsSync(screenshotsDir)) return undefined;
  return readdirSync(screenshotsDir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => join(screenshotsDir, name))
    .filter((file) => statSync(file).mtimeMs > after)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

async function waitForScreenshot(after, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const file = newestScreenshot(after);
    if (file) {
      await sleep(500);
      return file;
    }
    await sleep(250);
  }
  throw new Error('the engine wrote no screenshot');
}

async function capture(id) {
  const scene = `labs/${id}`;
  const { child } = startGame({ name: `preview-${id}`, scene, width: CAPTURE.width, height: CAPTURE.height });
  try {
    await waitForScene(scene);
    await sleep(settleMs);
    const requested = Date.now();
    // Only the preview's own game shoots: every game on this dev server answers the eval (the shell's worlds too), and
    // they all write into the same runtime's Screenshots folder.
    await evalInGames(`__vge.app?.scene === '${scene}' && UE.KismetSystemLibrary.ExecuteConsoleCommand(world, 'HighResShot ${CAPTURE.width}x${CAPTURE.height}', null)`);
    const png = await waitForScreenshot(requested);
    const target = join(previewsDir, `${id}.webp`);
    await sharp(png).resize({ width: PREVIEW_WIDTH }).webp({ quality: 82 }).toFile(target);
    console.log(`[labs:previews] ${id} -> ${target}`);
  } finally {
    child.kill();
    await sleep(1500);
  }
}

mkdirSync(previewsDir, { recursive: true });
const wanted = positionals.length > 0 ? positionals : labIds(root);
for (const id of wanted) await capture(id);
