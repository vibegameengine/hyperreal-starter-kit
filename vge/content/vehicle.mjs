import { contentModule } from './contentKind.mjs';

export const VEHICLE_MODULE = contentModule('vehicle');
const DESCRIBE = '/src/shared/vehicle/describe.ts';
const CONTENT_MODULE = '/src/shared/engine/content.ts';
const WHEEL_CLASS = '/Script/ChaosVehicles.ChaosVehicleWheel';

export function createVehicleModules({ materials, folderRoot }) {
  const rootOf = (key) => (typeof folderRoot === 'function' ? folderRoot(key) : folderRoot);
  const describe = (file) =>
    materials.describeWith(file, async (runner, exports) => {
      const key = materials.keyOf(file);
      return (await runner.import(DESCRIBE)).describeModule(key, exports, rootOf(key));
    });
  const affectedBy = (file) => materials.graph.affectedBy(file, VEHICLE_MODULE);
  return { keyOf: materials.keyOf, describe, affectedBy };
}

export function vehicleHandleModule(exports, paths = {}, objects = {}) {
  const lines = [`import { vehicleAsset } from '${CONTENT_MODULE}';`];
  for (const entry of exports) {
    const model = { key: entry.model, ...(objects[entry.model] ? { objects: objects[entry.model] } : {}) };
    const handle = { kind: 'vehicle', key: entry.exportKey, model, description: entry.vehicle, wheelClasses: entry.wheelClasses, ...(paths[entry.exportKey] ? { path: paths[entry.exportKey] } : {}) };
    const value = `vehicleAsset(${JSON.stringify(handle)})`;
    lines.push(entry.exportName === 'default' ? `export default ${value};` : `export const ${entry.exportName} = ${value};`);
  }
  return `${lines.join('\n')}\n`;
}

export async function buildVehicle(service, entry) {
  const fail = (message) => {
    throw new Error(`${entry.exportKey}: ${message}`);
  };
  await service.call('delete', { path: entry.folder });
  const created = [];
  for (const wheel of entry.request.wheels) {
    const made = await service.call('create-class', { path: `${entry.folder}/${wheel.name}`, parent: WHEEL_CLASS, defaults: wheel.defaults });
    if (made.error) fail(`${wheel.bone}: ${made.error}`);
    created.push(`${entry.folder}/${wheel.name}.${wheel.name}`);
  }
  const saved = await service.call('save', { paths: created });
  if (saved.error || !saved.saved) fail(`the wheel classes did not save: ${saved.error ?? 'see the service log'}`);
  return { path: entry.path };
}
