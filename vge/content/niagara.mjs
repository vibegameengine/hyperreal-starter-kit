// Niagara modules (modules that call defineSystem from src/shared/niagara): described in Node like material modules
// (through their describer, since renderers use materials), built by the content service with the engine's Niagara
// tool calls (NiagaraToolsets in the ToolsetRegistry, run by Source/VibeGameEngineTools/Private/VgeNiagara.cpp), and
// turned into the handle module the game imports in their place.
import { contentModule } from './contentKind.mjs';

export const NIAGARA_MODULE = contentModule('niagara');
const DESCRIBE = '/src/shared/niagara/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';

// `materials` is the material modules' describer (content/materials.mjs): one evaluation chain and one set of known
// material names for both. `folderRoot` is where systems go (/VgeLive/Niagara in the dev server; a function of the key
// in the release build).
export function createNiagaraModules({ materials, folderRoot }) {
  const rootOf = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
  const describe = (file) =>
    materials.describeWith(file, async (runner, exports, names, materialRoot) => {
      const key = materials.keyOf(file);
      return (await runner.import(DESCRIBE)).describeModule(key, exports, rootOf(key), materialRoot(key), names);
    });
  const affectedBy = (file) => materials.graph.affectedBy(file, NIAGARA_MODULE);
  return { keyOf: materials.keyOf, describe, affectedBy };
}

// The module the game imports in place of a Niagara module: a handle per export (shared/engine/content.ts
// niagaraAsset). `paths` (release build) bakes in each export's cooked object path.
export function niagaraHandleModule(exports, paths = {}) {
  const lines = [`import { niagaraAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const handle = { kind: 'niagara', key: entry.exportKey, user: entry.user, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}) };
    const value = `niagaraAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

const TOOLS = 'NiagaraToolsets.NiagaraToolset_System.';
const SYSTEM_TEMPLATE = '/Niagara/DefaultAssets/DefaultSystem.DefaultSystem';
const EMITTER_TEMPLATES = '/Niagara/DefaultAssets/Templates/Emitters';
const SCRIPTS = { emitterSpawn: 'EmitterSpawnScript', emitterUpdate: 'EmitterUpdateScript', particleSpawn: 'ParticleSpawnScript', particleUpdate: 'ParticleUpdateScript' };
const RENDERERS = {
  sprite: '/Script/Niagara.NiagaraSpriteRendererProperties',
  mesh: '/Script/Niagara.NiagaraMeshRendererProperties',
  ribbon: '/Script/Niagara.NiagaraRibbonRendererProperties',
  light: '/Script/Niagara.NiagaraLightRendererProperties',
};
const USER_TYPES = {
  float: '/Script/Niagara.NiagaraFloat',
  bool: '/Script/Niagara.NiagaraBool',
  vector: '/Script/CoreUObject.Vector3f',
  color: '/Script/CoreUObject.LinearColor',
};

const ref = (refPath) => ({ refPath });
const templatePath = (template = 'Minimal') => (template.startsWith('/') ? template : `${EMITTER_TEMPLATES}/${template}.${template}`);
const instanced = (struct, value) => ({ struct: ref(struct), value });

// A value of a Niagara type from what a description gives (shared/niagara/index.ts NiagaraValue); `type` is the struct
// path the input or variable has.
function typedValue(type, value, where) {
  const tuple = (keys) => {
    if (!Array.isArray(value) || value.length !== keys.length) throw new Error(`${where}: ${type.replace(/^.*\./, '')} takes ${keys.length} numbers`);
    return Object.fromEntries(keys.map((key, index) => [key, value[index]]));
  };
  switch (type) {
    case '/Script/Niagara.NiagaraFloat':
    case '/Script/Niagara.NiagaraInt32':
      if (typeof value !== 'number') throw new Error(`${where}: a number`);
      return instanced(type, { value });
    case '/Script/Niagara.NiagaraBool':
      if (typeof value !== 'boolean') throw new Error(`${where}: a boolean`);
      return instanced(type, { value: value ? -1 : 0 });
    case '/Script/CoreUObject.Vector2f':
      return instanced(type, tuple(['x', 'y']));
    case '/Script/CoreUObject.Vector3f':
    case '/Script/Niagara.NiagaraPosition':
      return instanced(type, tuple(['x', 'y', 'z']));
    case '/Script/CoreUObject.Vector4f':
    case '/Script/CoreUObject.Quat4f':
      return instanced(type, tuple(['x', 'y', 'z', 'w']));
    case '/Script/CoreUObject.LinearColor':
      return instanced(type, tuple(['r', 'g', 'b', 'a']));
    default:
      throw new Error(`${where}: inputs of type ${type} take user(), linked(), hlsl(), asset() or dynamicInput()`);
  }
}

// Builds the system `entry` (shared/niagara/describe.ts NiagaraExport) through the content service: removes the
// folder's previous contents, creates the system from the engine's empty system, adds each emitter from its template,
// applies the description, compiles and saves. Returns what was built.
export async function buildNiagaraSystem(service, entry) {
  const system = ref(entry.path);
  const at = (extra) => ({ system, emitterName: '', scriptName: '', moduleName: '', rendererIndex: -1, inputNameStack: [], ...extra });
  const call = async (tool, input) => (await service.call('niagara-tools', { calls: [{ tool: TOOLS + tool, input }] })).results[0]?.returnValue;

  await service.call('delete', { path: entry.folder });
  const { user = {}, emitters, template: systemTemplate } = entry.description;
  await call('CreateNiagaraSystem', { assetName: entry.name, assetPath: entry.folder, templateSystem: ref(systemTemplate ?? SYSTEM_TEMPLATE) });
  const templateEmitters = (await call('GetSystemSummary', { system })).emitters.map((emitter) => emitter.emitterName);
  if (!systemTemplate) {
    for (const emitterName of templateEmitters) await call('RemoveEmitter', { emitterToRemove: at({ emitterName }) });
  }
  const addUserVariables = async () => {
    if (!Object.keys(user).length) return;
    await call('AddUserVariables', {
      system,
      variablesToAdd: Object.entries(user).map(([name, value]) => {
        const type = USER_TYPES[entry.user[name]];
        return { name: `User.${name}`, type: { classStructOrEnum: ref(type) }, defaultValue: typedValue(type, value, `user.${name}`) };
      }),
    });
  };
  const linksUser = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value) && (String(value.link ?? '').startsWith('User.') || Object.values(value.inputs ?? {}).some(linksUser)));
  const userFirst = Object.values(emitters).some((emitter) => [...Object.values(emitter.inputs ?? {}), ...(emitter.modules ?? []).flatMap((module) => Object.values(module.inputs ?? {}))].some(linksUser));
  if (userFirst) await addUserVariables();
  const constants = [];

  for (const [emitterName, emitter] of Object.entries(emitters)) {
    const where = (rest) => `${emitterName}.${rest}`;
    if (systemTemplate && !templateEmitters.includes(emitterName)) throw new Error(where(`the system template has the emitters ${templateEmitters.join(', ')}`));
    const editsStack = Boolean(emitter.remove?.length || Object.keys(emitter.inputs ?? {}).length || emitter.modules?.length || emitter.renderers);
    const topology = !systemTemplate
      ? await call('AddEmitter', { system, templateEmitter: ref(templatePath(emitter.template)), emitterName })
      : editsStack ? await call('GetEmitterTopology', { emitterRef: at({ emitterName }) }) : { emitterName };
    // AddEmitter names the emitter as asked unless the name is taken; the topology says.
    const name = topology.emitterName;
    const emitterAt = (extra = {}) => at({ emitterName: name, ...extra });

    const properties = { ...(emitter.properties ?? {}), ...(emitter.sim ? { SimTarget: emitter.sim === 'gpu' ? 'GPUComputeSim' : 'CPUSim' } : {}) };
    if (Object.keys(properties).length) await call('SetEmitterData', { emitter: emitterAt(), emitterData: { propertyValues: JSON.stringify(properties) } });

    const modulesOf = () => Object.entries(SCRIPTS).flatMap(([, script]) => topology[script.charAt(0).toLowerCase() + script.slice(1)].modules.map((module) => ({ ...module, script })));
    for (const moduleName of emitter.remove ?? []) {
      const module = modulesOf().find((m) => m.moduleName === moduleName);
      if (!module) throw new Error(where(`remove: the template has no module '${moduleName}' (it has ${modulesOf().map((m) => m.moduleName).join(', ')})`));
      await call('RemoveModule', { moduleToRemove: emitterAt({ scriptName: module.script, moduleName }) });
    }

    // One input of one module of this emitter: `module` from the topology.
    const setInput = async (module, inputName, value, label) => {
      const input = module.inputs.find((i) => i.name === inputName);
      if (!input) throw new Error(`${label}: '${module.moduleName}' has no input '${inputName}' (inputs: ${module.inputs.filter((i) => i.bIsVisible).map((i) => i.name).join(', ')})`);
      const type = input.type.classStructOrEnum.refPath;
      const stackInputRef = emitterAt({ scriptName: module.script, moduleName: module.moduleName, inputNameStack: [inputName] });
      let inputData;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if ('link' in value) inputData = instanced('/Script/NiagaraEditor.NiagaraExt_StackInputData_Linked', { linkedVariable: { name: value.link, type: { classStructOrEnum: ref(type) } } });
        else if ('hlsl' in value) inputData = instanced('/Script/NiagaraEditor.NiagaraExt_StackInputData_HlslExpression', { hlslExpression: value.hlsl });
        else if ('asset' in value) inputData = instanced('/Script/NiagaraEditor.NiagaraExt_StackInputData_DataInterface', { propertyValues: JSON.stringify({ [inputName]: value.asset }) });
        else if ('dynamic' in value) inputData = instanced('/Script/NiagaraEditor.NiagaraExt_StackInputData_DynamicInput', { dynamicInputAsset: ref(value.dynamic) });
        else if ('option' in value) inputData = await enumValue(stackInputRef, type, value.option, label);
      } else {
        inputData = typedValue(type, value, label);
      }
      if (!inputData) throw new Error(`${label}: not a value Niagara takes`);
      await call('SetStackInputData', { stackInputRef, inputData });
      if (value && typeof value === 'object' && 'dynamic' in value && value.inputs) {
        for (const [dynamicName, dynamicValue] of Object.entries(value.inputs)) {
          await call('SetStackInputData', { stackInputRef: { ...stackInputRef, inputNameStack: [inputName, dynamicName] }, inputData: typedValue(await inputTypeOf({ ...stackInputRef, inputNameStack: [inputName, dynamicName] }), dynamicValue, `${label}.${dynamicName}`) });
        }
      }
    };
    const inputTypeOf = async (stackInputRef) => (await call('GetStackInputTopology', { stackInputRef })).type.classStructOrEnum.refPath;
    // An enum input's option by the name the editor shows (or its internal name), from the UEnum itself
    // (NiagaraToolset_Info.UEnum_Info). Not from GetStackInputSchema: it waits for an editor compile of the system,
    // which nothing ticks in the commandlet, and never returns.
    const enumValue = async (stackInputRef, type, optionName, label) => {
      const reply = await service.call('niagara-tools', { calls: [{ tool: 'NiagaraToolsets.NiagaraToolset_Info.UEnum_Info', input: { enum: ref(type) } }] });
      const info = JSON.parse(reply.results[0].returnValue);
      const options = info.Values.map((v) => ({ enumName: `${info.Name}::${v.Name}`, displayName: v.DisplayName }));
      const found = options.find((o) => o.displayName === optionName || o.enumName === optionName || o.enumName.endsWith(`::${optionName}`));
      if (!found) throw new Error(`${label}: no option '${optionName}' (options: ${options.map((o) => o.displayName).join(', ')})`);
      return instanced('/Script/NiagaraEditor.NiagaraExt_StackInputData_Enum', { enum: ref(type), ...found });
    };

    for (const [path, value] of Object.entries(emitter.inputs ?? {})) {
      const dot = path.indexOf('.');
      const moduleName = path.slice(0, dot);
      const module = modulesOf().find((m) => m.moduleName === moduleName);
      if (dot < 0 || !module) throw new Error(where(`inputs['${path}']: '<module>.<input>', and the template's modules are ${modulesOf().map((m) => m.moduleName).join(', ')}`));
      await setInput(module, path.slice(dot + 1), value, where(`inputs['${path}']`));
    }

    for (const [index, module] of (emitter.modules ?? []).entries()) {
      const scriptName = SCRIPTS[module.stage];
      if (!scriptName) throw new Error(where(`modules[${index}].stage: ${Object.keys(SCRIPTS).join(', ')}`));
      const added = await call('AddModule', { moduleLocationRef: emitterAt({ scriptName }), moduleAsset: ref(module.script) });
      for (const [inputName, value] of Object.entries(module.inputs ?? {})) await setInput({ ...added, script: scriptName }, inputName, value, where(`modules[${index}].inputs['${inputName}']`));
    }

    if (emitter.renderers) {
      for (let index = topology.renderers.length - 1; index >= 0; index--) await call('RemoveRenderer', { rendererToRemove: emitterAt({ rendererIndex: index }) });
      for (const [index, renderer] of emitter.renderers.entries()) {
        const rendererClass = RENDERERS[renderer.type];
        if (!rendererClass) throw new Error(where(`renderers[${index}].type: ${Object.keys(RENDERERS).join(', ')}`));
        const added = await call('AddRenderer', { newRendererLocation: emitterAt(), rendererClass: ref(rendererClass) });
        // Keys and object references as the renderer's property schema has them (GetRendererSchema): an object is
        // { refPath }.
        const values = { ...(renderer.properties ?? {}) };
        if (renderer.material) {
          if (renderer.type === 'mesh') {
            values.bOverrideMaterials = true;
            values.overrideMaterials = [{ explicitMat: ref(renderer.material) }];
          } else values.material = ref(renderer.material);
        }
        if (renderer.meshes) values.meshes = renderer.meshes.map((mesh) => ({ mesh: ref(mesh) }));
        if (Object.keys(values).length) await call('SetRendererData', { renderer: emitterAt({ rendererIndex: added.rendererIndex }), rendererData: { propertyValues: JSON.stringify(values) } });
      }
    }
    if (emitter.constants) constants.push({ name, values: emitter.constants, where });
  }

  if (!userFirst) await addUserVariables();
  for (const { name, values, where } of constants) {
    const written = await service.call('niagara-constants', { path: entry.path, emitter: name, values });
    if (written.error) throw new Error(where(`constants: ${written.error}`));
  }

  // The scripts are compiled by the cook (Niagara compiles a system for its target platform while cooking it); its
  // errors come back from the cook log (content/pipeline.mjs buildNiagara). Tools that wait for an editor compile
  // (GetStackIssues, GetSystemCompileState) are not used: nothing ticks the asynchronous compile in the commandlet.
  const saved = await service.call('niagara-save', { path: entry.path });
  return { path: entry.path, saved, emitters: await emittersAsBuilt(call, at, system) };
}

async function emittersAsBuilt(call, at, system) {
  const tryCall = async (tool, input) => {
    try {
      return await call(tool, input);
    } catch (err) {
      return { error: String(err?.message ?? err) };
    }
  };
  const emitters = {};
  for (const { emitterName } of (await call('GetSystemSummary', { system })).emitters) {
    const renderers = [];
    for (let rendererIndex = 0; rendererIndex < 8; rendererIndex++) {
      const renderer = await tryCall('GetRendererData', { rendererRef: at({ emitterName, rendererIndex }) });
      if (renderer?.error) break;
      renderers.push(renderer);
    }
    emitters[emitterName] = { data: await tryCall('GetEmitterData', { emitterRef: at({ emitterName }) }), renderers };
  }
  return emitters;
}
