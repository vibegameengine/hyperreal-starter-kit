import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, createWriteStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { engine, repoRoot, saveRuntime, unrealRoot } from './engine.mjs';
import { isAlive, runtimeUsers } from './processes.mjs';
import { buildShell, buildShipping, buildTargets, masterMaterials, packageBase, refuseRebuildingRuntimeInUse, typings } from './steps.mjs';

export const V8_VERSION = '11.8.172';
// What a runtime is built from, as paths in the checkout: the Unreal project in unreal/ and the shell's sources in
// vge/shell. In the build tree the Unreal project is the tree itself and the shell is shell/ (treePath), where UBT, the
// cook and the shell's build (steps.mjs buildShell) expect them.
const SOURCES = ['unreal/VibeGameEngine.uproject', 'unreal/Source', 'unreal/Config', 'unreal/Content', 'unreal/Plugins', 'vge/shell/src'];
const UNREAL = 'unreal/';
const SHELL = 'vge/shell/';
const treePath = (file) => (file.startsWith(UNREAL) ? file.slice(UNREAL.length) : file.startsWith(SHELL) ? `shell/${file.slice(SHELL.length)}` : file);
// Folders of the Unreal project (unreal/) the kit links from its runtime.
export const LINKS = ['Binaries', 'Plugins/Puerts/Binaries', 'Releases', 'Typing', 'Content/Vge/Materials', 'Content/Characters/Mannequins'];
export const storeRoot = join(homedir(), '.vge');
const V8_DIR = `v8_${V8_VERSION}`;
const V8_URL = `https://github.com/puerts/backend-v8/releases/download/V8_${V8_VERSION}__251225/v8_bin_${V8_VERSION}.tar.gz`;
const sharedV8 = join(storeRoot, 'V8', V8_DIR);

// Plugins installed from Fab (vge/content/fab.mjs) are ignored by git, being the user's under Fab's licence, but they
// are part of what the runtime is built from: the game links their code and cooks their content.
const MARKETPLACE = 'Plugins/Marketplace';
const BUILD_OUTPUT = new Set(['Binaries', 'Intermediate', 'Saved', '.git']);

function marketplaceFiles(dir = join(unrealRoot, MARKETPLACE), prefix = `${UNREAL}${MARKETPLACE}`) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return BUILD_OUTPUT.has(entry.name) ? [] : marketplaceFiles(join(dir, entry.name), `${prefix}/${entry.name}`);
    return [`${prefix}/${entry.name}`];
  });
}

export function sourceFiles() {
  return [
    ...execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--', ...SOURCES], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean),
    ...marketplaceFiles(),
  ].sort();
}

function engineIdentity() {
  const dir = join(engine().root, 'Engine');
  const { BuildId } = JSON.parse(readFileSync(join(dir, 'Binaries', 'Win64', 'UnrealEditor.modules'), 'utf8'));
  return `${readFileSync(join(dir, 'Build', 'Build.version'), 'utf8')}\0${BuildId}\0${V8_VERSION}`;
}

const sourceBlobs = (files) =>
  execFileSync('git', ['hash-object', '--stdin-paths'], { cwd: repoRoot, input: files.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim().split('\n');

export function runtimeKey(files = sourceFiles(), blobs = sourceBlobs(files)) {
  const hash = createHash('sha256').update(engineIdentity());
  files.forEach((file, index) => hash.update(`\0${treePath(file)}\0${blobs[index]}`));
  return hash.digest('hex').slice(0, 16);
}

export const runtimePath = (key) => join(storeRoot, 'Runtime', key);
export const isBuilt = (dir) => existsSync(join(dir, 'runtime.json'));

const isLink = (path) => lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() ?? false;

function junction(target, link) {
  if (isLink(link)) {
    if (resolve(readlinkSync(link)) === resolve(target)) return;
    unlinkSync(link);
  }
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, 'junction');
}

const V8_PARTS = ['Inc', 'Lib/Win64MD', 'Lib/Win64DLL'];
const hasV8 = (dir) => V8_PARTS.every((part) => existsSync(join(dir, part)));

// The runtime's V8 is a junction to the shared copy. A runtime folder on a volume without junctions (exFAT: the
// store's folder linked to another drive) gets its own copy instead.
function linkV8(tag, link) {
  if (!isLink(link) && hasV8(link)) return;
  try {
    junction(sharedV8, link);
  } catch (err) {
    if (err.code !== 'EISDIR' && err.code !== 'EPERM') throw err;
    for (const part of V8_PARTS) cpSync(join(sharedV8, part), join(link, part), { recursive: true });
    console.log(`[${tag}] ${dirname(link)} cannot hold a junction; V8 copied into the runtime`);
  }
}

async function fetchV8(tag) {
  if (hasV8(sharedV8)) return;
  mkdirSync(dirname(sharedV8), { recursive: true });
  const archive = join(dirname(sharedV8), `v8_bin_${V8_VERSION}.tar.gz`);
  console.log(`[${tag}] downloading V8 ${V8_VERSION} binaries for Puerts (~370 MB) from ${V8_URL}`);
  const response = await fetch(V8_URL);
  if (!response.ok) throw new Error(`V8 download failed: HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length'));
  let received = 0;
  let shown = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    const percent = Math.floor((received / total) * 100);
    if (percent >= shown + 10) console.log(`[${tag}]   ${(shown = percent)}%`);
  });
  await pipeline(body, createWriteStream(archive));
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const members = V8_PARTS.map((part) => `${V8_DIR}/${part}`);
  const result = spawnSync(tar, ['-xzf', archive, '-C', dirname(sharedV8), ...members], { stdio: 'inherit' });
  rmSync(archive, { force: true });
  if (result.status !== 0 || !hasV8(sharedV8)) throw new Error('V8 archive could not be extracted');
  console.log(`[${tag}] V8 ${V8_VERSION} binaries in ${sharedV8}`);
}

// The build tree: one project folder on this machine where every runtime is compiled, cooked and packaged. It keeps
// what Unreal builds incrementally from (Intermediate, Saved/Cooked, the shader caches), so a runtime for changed
// sources recompiles and recooks only what the change touches. UBT's makefiles and dependency files hold absolute
// paths, so the folder never moves; kits with different sources take turns in it (BUILD_LOCK).
export const buildRoot = join(storeRoot, 'Build');
const BUILD_MANIFEST = 'sources.json';
const BUILD_LOCK = 'building.json';

// Brings the build tree to these sources: a file is written only when its content differs (its git blob), so an
// unchanged file keeps its timestamp and UBT sees it as up to date; a source the kit no longer has is removed.
function syncSources(tag, files, blobs) {
  const manifestFile = join(buildRoot, BUILD_MANIFEST);
  const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {};
  const current = {};
  const writtenAt = new Date();
  let written = 0;
  files.forEach((file, index) => {
    const target = treePath(file);
    current[target] = blobs[index];
    if (previous[target] === blobs[index] && existsSync(join(buildRoot, target))) return;
    mkdirSync(dirname(join(buildRoot, target)), { recursive: true });
    copyFileSync(join(repoRoot, file), join(buildRoot, target));
    utimesSync(join(buildRoot, target), writtenAt, writtenAt);
    written++;
  });
  const removed = Object.keys(previous).filter((file) => !(file in current));
  for (const file of removed) rmSync(join(buildRoot, file), { force: true });
  writeFileSync(manifestFile, JSON.stringify(current));
  console.log(`[${tag}] build tree ${buildRoot}: ${written} source file(s) written, ${removed.length} removed`);
}

async function lockBuildTree(tag) {
  mkdirSync(buildRoot, { recursive: true });
  const file = join(buildRoot, BUILD_LOCK);
  for (let said = false; existsSync(file) && isAlive(JSON.parse(readFileSync(file, 'utf8')).pid); said = true) {
    if (!said) console.log(`[${tag}] the build tree is building for another kit (pid ${JSON.parse(readFileSync(file, 'utf8')).pid}); waiting`);
    await new Promise((done) => setTimeout(done, 5000));
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid }));
  return () => rmSync(file, { force: true });
}

// The build tree at the kit's current sources, locked for the caller: run `work(buildRoot)`, then it is released.
export async function inBuildTree(tag, work) {
  const unlock = await lockBuildTree(tag);
  try {
    const files = sourceFiles();
    syncSources(tag, files, sourceBlobs(files));
    await fetchV8(tag);
    linkV8(tag, join(buildRoot, 'Plugins', 'Puerts', 'ThirdParty', V8_DIR));
    copyMannequin(tag, buildRoot);
    return await work(buildRoot);
  } finally {
    unlock();
  }
}

function copyMannequin(tag, dir) {
  const target = join(dir, 'Content', 'Characters', 'Mannequins');
  if (existsSync(join(target, 'Meshes'))) return;
  const source = join(engine().templates, 'High', 'Characters', 'Content', 'Mannequins');
  if (!existsSync(source)) throw new Error(`the engine has no template Mannequin at ${source}; install the engine's templates from the launcher`);
  cpSync(source, target, { recursive: true });
  console.log(`[${tag}] Mannequin copied from ${source}`);
}

const CRYPTO = join('Saved', 'Cooked', 'Windows', 'VibeGameEngine', 'Metadata', 'Crypto.json');
const SHIPPING = /^VibeGameEngine-Win64-Shipping\./;

// What a runtime is, out of the build tree: the binaries the kit links (the editor modules the content service and
// the cooker load, the game's), typings, the base package and its release, the master materials and Mannequin the
// kit links, the shell, and the cook's crypto keys the content pipeline packages with. Sources and build state stay
// in the build tree. The Shipping game is not part of it: the release build adds it (ensureShipping).
function publishRuntime(dir) {
  const copy = (path, filter) => existsSync(join(buildRoot, path)) && cpSync(join(buildRoot, path), join(dir, path), { recursive: true, filter });
  copy('Binaries', (source) => !SHIPPING.test(basename(source)) && !/^VibeGameEngine\.(exe|pdb)$/.test(basename(source)));
  for (const path of ['Plugins/Puerts/Binaries', ...marketplaceBinaries(buildRoot), 'Typing', 'Releases', 'Build/Package', 'Build/Shell', 'Content/Vge/Materials', 'Content/Characters/Mannequins', CRYPTO]) {
    copy(path);
  }
}

export async function ensureRuntime(tag, { rebuild = false } = {}) {
  const files = sourceFiles();
  const key = runtimeKey(files);
  const dir = runtimePath(key);
  if (isBuilt(dir) && !rebuild) {
    console.log(`[${tag}] runtime ${key} present in ${dir}`);
    return dir;
  }
  refuseRebuildingRuntimeInUse(dir);
  const started = Date.now();
  console.log(`[${tag}] building runtime ${key} (once per machine for these sources)`);
  await inBuildTree(tag, (root) => {
    if (runtimeKey(sourceFiles()) !== key) throw new Error('the sources changed while the build waited for the build tree; run it again');
    buildTargets(tag, root);
    typings(tag, root);
    masterMaterials(tag, root);
    packageBase(tag, root);
    buildShell(tag, root);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, BUILDING), JSON.stringify({ pid: process.pid }));
    publishRuntime(dir);
  });
  writeFileSync(join(dir, 'runtime.json'), `${JSON.stringify({ key, engine: engine().root, sources: files.length, builtAt: new Date().toISOString() }, null, 2)}\n`);
  rmSync(join(dir, BUILDING), { force: true });
  console.log(`[${tag}] runtime ${key} built in ${((Date.now() - started) / 60000).toFixed(1)} min`);
  return dir;
}

// The release build's Shipping game for the linked runtime: built in the build tree at the kit's sources (the
// runtime's own, checked by key) and added to the runtime's binaries, once per runtime.
export async function ensureShipping(tag, dir) {
  const exe = join(dir, 'Binaries', 'Win64', 'VibeGameEngine-Win64-Shipping.exe');
  if (existsSync(exe)) return;
  await inBuildTree(tag, (root) => {
    if (resolve(runtimePath(runtimeKey(sourceFiles()))) !== resolve(dir)) {
      throw new Error('the kit\'s sources are not the linked runtime\'s: run `npm run build:cpp` first');
    }
    buildShipping(tag, root);
    const binaries = join(root, 'Binaries', 'Win64');
    for (const name of readdirSync(binaries).filter((file) => SHIPPING.test(file) && !file.endsWith('.pdb'))) {
      copyFileSync(join(binaries, name), join(dir, 'Binaries', 'Win64', name));
    }
  });
}

// Old runtimes go away by themselves: every link of a kit removes the runtimes no kit on this machine links to, that
// no running dev server holds and that no build is writing. Kits register what they link in ~/.vge/kits.
const BUILDING = 'building.json';
const kitsDir = join(storeRoot, 'kits');

function registerKit(dir) {
  mkdirSync(kitsDir, { recursive: true });
  const name = createHash('sha256').update(resolve(repoRoot).toLowerCase()).digest('hex').slice(0, 16);
  writeFileSync(join(kitsDir, `${name}.json`), JSON.stringify({ kit: resolve(repoRoot), runtime: resolve(dir) }));
}

// The checkouts of this repository (the main kit and its profiles) count as registered even before their next link.
function worktrees() {
  const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' });
  return [...out.matchAll(/^worktree (.+)$/gm)].map((match) => resolve(match[1]));
}

// The runtime a kit links: from its vge/config.json, or from the vge.config.json at the root of a kit laid out before
// vge/ held the kit's tooling.
function runtimeOfKit(kit) {
  const config = [join(kit, 'vge', 'config.json'), join(kit, 'vge.config.json')].find((file) => existsSync(file));
  return config ? JSON.parse(readFileSync(config, 'utf8')).runtime : undefined;
}

function linkedRuntimes() {
  const linked = new Set();
  for (const kit of worktrees()) {
    const runtime = runtimeOfKit(kit);
    if (runtime) linked.add(resolve(runtime));
  }
  if (!existsSync(kitsDir)) return linked;
  for (const name of readdirSync(kitsDir)) {
    const file = join(kitsDir, name);
    const { kit } = JSON.parse(readFileSync(file, 'utf8'));
    const runtime = runtimeOfKit(kit);
    if (runtime) linked.add(resolve(runtime));
    else rmSync(file, { force: true });
  }
  return linked;
}

function beingBuilt(dir) {
  const file = join(dir, BUILDING);
  return existsSync(file) && isAlive(JSON.parse(readFileSync(file, 'utf8')).pid);
}

// A runtime folder may be a junction to another drive, and holds a junction to the shared V8: links are removed as
// links (rmSync does not follow them), the folder a store junction points to is removed with it.
function removeRuntime(dir) {
  const target = isLink(dir) ? resolve(readlinkSync(dir)) : null;
  if (target) {
    rmSync(target, { recursive: true, force: true });
    unlinkSync(dir);
  } else {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function pruneRuntimes(tag) {
  const root = join(storeRoot, 'Runtime');
  if (!existsSync(root)) return;
  const keep = linkedRuntimes();
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (keep.has(resolve(dir)) || runtimeUsers(dir).length || beingBuilt(dir)) continue;
    removeRuntime(dir);
    console.log(`[${tag}] removed runtime ${name}: no kit links it, nothing runs on it`);
  }
}

// The binaries of plugins installed from Fab, built into the runtime like Puerts': the content service and the cooker
// load the kit's project, and find each plugin's editor modules there.
function marketplaceBinaries(dir) {
  const plugins = join(dir, MARKETPLACE);
  if (!existsSync(plugins)) return [];
  return readdirSync(plugins)
    .filter((name) => existsSync(join(plugins, name, 'Binaries')))
    .map((name) => `${MARKETPLACE}/${name}/Binaries`);
}

export function linkKit(tag, dir) {
  for (const path of [...LINKS, ...marketplaceBinaries(dir)]) {
    const link = join(unrealRoot, path);
    if (existsSync(link) && !isLink(link)) {
      const aside = join(unrealRoot, 'Saved', 'Superseded', path);
      mkdirSync(dirname(aside), { recursive: true });
      rmSync(aside, { recursive: true, force: true });
      renameSync(link, aside);
      console.log(`[${tag}] ${path} was built here before the shared runtime; moved to Saved/Superseded/${path}`);
    }
    junction(join(dir, path), link);
  }
  saveRuntime(dir);
  registerKit(dir);
  console.log(`[${tag}] kit linked to runtime ${dir}`);
  pruneRuntimes(tag);
}
