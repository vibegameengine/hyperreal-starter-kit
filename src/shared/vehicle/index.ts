import type { ContentAssetRef } from '../engine/content';

export interface Suspension {
  readonly rate: number;
  readonly damping: number;
  readonly preload: number;
  readonly maxRaise: number;
  readonly maxDrop: number;
}

export interface Wheel {
  readonly bone: string;
  readonly radius: number;
  readonly width: number;
  readonly steerAngle?: number;
  readonly drive?: boolean;
  readonly handbrake?: boolean;
  readonly friction?: number;
  readonly brakeTorque?: number;
  readonly handbrakeTorque?: number;
  readonly suspension: Suspension;
}

export interface Engine {
  readonly torqueCurve: readonly (readonly [rpm: number, newtonMetres: number])[];
  readonly idleRPM: number;
  readonly maxRPM: number;
  readonly brakeEffect?: number;
}

export interface Gears {
  readonly forward: readonly number[];
  readonly reverse: number;
  readonly finalRatio: number;
  readonly changeUpRPM: number;
  readonly changeDownRPM: number;
  readonly changeSeconds?: number;
  readonly automatic?: boolean;
}

export interface VehicleDescription {
  readonly model: string;
  readonly massKg: number;
  readonly centerOfMass: readonly [x: number, y: number, z: number];
  readonly dragCoefficient?: number;
  readonly chassisHeight: number;
  readonly wheels: readonly Wheel[];
  readonly engine: Engine;
  readonly gears: Gears;
}

export interface VehicleDefinition {
  kind: 'vehicle-definition';
  description: VehicleDescription;
}

export interface VehicleRef {
  readonly kind: 'vehicle';
  readonly key: string;
  readonly model: ContentAssetRef;
  readonly description: Omit<VehicleDescription, 'model'>;
  readonly wheelClasses: readonly string[];
  readonly path?: string;
}

export function defineVehicle(description: VehicleDescription): VehicleRef {
  return { kind: 'vehicle-definition', description } as unknown as VehicleRef;
}
