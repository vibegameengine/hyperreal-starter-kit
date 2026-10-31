import { hashOf } from '../material/describe';
import type { VehicleDefinition, VehicleDescription, Wheel } from './index';

export interface VehicleWheelRequest {
  bone: string;
  name: string;
  defaults: Record<string, unknown>;
}

export interface VehicleExport {
  exportName: string;
  exportKey: string;
  folder: string;
  name: string;
  path: string;
  description: Record<string, unknown>;
  vehicle: Omit<VehicleDescription, 'model'>;
  model: string;
  wheelClasses: string[];
  request: { wheels: VehicleWheelRequest[]; models: string[] };
  materials: never[];
}

const FORMAT = 1;
const BONE = /^[A-Za-z][A-Za-z0-9_]*$/;

const isVehicle = (value: unknown): value is VehicleDefinition => !!value && typeof value === 'object' && (value as VehicleDefinition).kind === 'vehicle-definition';

const moduleName = (fileKey: string) =>
  fileKey
    .slice(fileKey.lastIndexOf('/') + 1)
    .replace(/\.vehicle\.[jt]sx?$/, '')
    .replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());

const exportAssetName = (fileKey: string, exportName: string) =>
  `${moduleName(fileKey)}${exportName === 'default' ? '' : `_${exportName.replace(/[^A-Za-z0-9]/g, '').replace(/^./, (c) => c.toUpperCase())}`}`;

function modelKeyOf(fileKey: string, model: string) {
  const parts = fileKey.split('/').slice(0, -1);
  for (const part of model.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function wheelDefaults(wheel: Wheel) {
  const { rate, damping, preload, maxRaise, maxDrop } = wheel.suspension;
  return {
    AxleType: wheel.steerAngle ? 'Front' : 'Rear',
    WheelRadius: wheel.radius,
    WheelWidth: wheel.width,
    MaxSteerAngle: wheel.steerAngle ?? 0,
    bAffectedBySteering: !!wheel.steerAngle,
    bAffectedByEngine: !!wheel.drive,
    bAffectedByHandbrake: !!wheel.handbrake,
    bAffectedByBrake: true,
    FrictionForceMultiplier: wheel.friction ?? 3,
    MaxBrakeTorque: wheel.brakeTorque ?? 4500,
    MaxHandBrakeTorque: wheel.handbrakeTorque ?? (wheel.handbrake ? 6000 : 0),
    SpringRate: rate,
    SuspensionDampingRatio: damping,
    SpringPreload: preload,
    SuspensionMaxRaise: maxRaise,
    SuspensionMaxDrop: maxDrop,
  };
}

export function describeModule(fileKey: string, moduleExports: Record<string, unknown>, folderRoot: string): VehicleExport[] {
  const result: VehicleExport[] = [];
  for (const [exportName, value] of Object.entries(moduleExports)) {
    if (!isVehicle(value)) continue;
    const exportKey = `${fileKey}#${exportName}`;
    try {
      const { model, ...vehicle } = value.description;
      if (!vehicle.wheels.length) throw new Error('a vehicle has at least one wheel');
      if (!vehicle.engine.torqueCurve.length) throw new Error('the engine has a torque curve of at least one point');
      for (const wheel of vehicle.wheels) if (!BONE.test(wheel.bone)) throw new Error(`'${wheel.bone}' is not a bone name`);
      const name = exportAssetName(fileKey, exportName);
      const wheels = vehicle.wheels.map((wheel) => ({ bone: wheel.bone, name: `${name}_${wheel.bone}`, defaults: wheelDefaults(wheel) }));
      const modelKey = modelKeyOf(fileKey, model);
      const folder = `${folderRoot}/${name}_${hashOf(JSON.stringify([FORMAT, name, wheels]))}`;
      const wheelClasses = wheels.map((wheel) => `${folder}/${wheel.name}.${wheel.name}_C`);
      result.push({ exportName, exportKey, folder, name, path: `${folder}/${wheels[0].name}.${wheels[0].name}`, description: { wheels: wheels.length }, vehicle, model: modelKey, wheelClasses, request: { wheels, models: [modelKey] }, materials: [] });
    } catch (err: any) {
      throw new Error(`${exportKey}: ${err?.message ?? err}`);
    }
  }
  return result;
}
