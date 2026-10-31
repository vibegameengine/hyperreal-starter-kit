import { defineSystem, user } from '../../../shared/niagara';
import { SANDSTORM_DENSITY, SANDSTORM_WIND } from './sandstormDefaults';

const PARTICLE_ADVECTION = '/NiagaraFluids/Templates/Gas/3D/Systems/Grid3D_Gas_ParticleAdvection.Grid3D_Gas_ParticleAdvection';

const SOURCE_POSITION = [-1400, 0, 260] as const;
const SOURCE_RADIUS = 240;
const SOURCE_SCALE = [0.8, 3.4, 2.2] as const;
const GRID_PIVOT = [0, 0, 0.5] as const;

export const sandstorm = defineSystem({
  template: PARTICLE_ADVECTION,
  user: { Wind: SANDSTORM_WIND, Density: SANDSTORM_DENSITY },
  emitters: {
    ParticleSourceEmitter: {
      remove: ['SpawnBurst_Instantaneous', 'SpinPosition_03'],
      renderers: [],
    },
    Advect_Particles_With_Grid: {
      inputs: {
        'SetVariables_6CFC1AFD4334B6B38B3FF69C3B2461CE.Particles.Color': [0.5, 0.34, 0.17, 1],
        'Grid3D_CreateUnitToWorldTransform.LocalPivot': GRID_PIVOT,
        'EmitterState.Life Cycle Mode': { option: 'Self' },
        'EmitterState.Loop Behavior': { option: 'Infinite' },
        'SpawnRate.SpawnRate': 20000,
        'ShapeLocation.Shape Primitive': { option: 'Sphere' },
        'ShapeLocation.Sphere Radius': SOURCE_RADIUS,
        'ShapeLocation.Scale Mode': { option: 'Default' },
        'ShapeLocation.Non Uniform Scale': SOURCE_SCALE,
        'ShapeLocation.Offset': SOURCE_POSITION,
        'InitializeParticle.Lifetime': 4,
        'InitializeParticle.Color Mode': { option: 'Direct Set' },
        'InitializeParticle.Color': [0.62, 0.44, 0.24, 1],
        'InitializeParticle.Sprite Size Mode': { option: 'Uniform' },
        'InitializeParticle.Uniform Sprite Size': 4,
      },
      modules: [{ stage: 'particleUpdate', script: '/Niagara/Modules/Update/Lifetime/KillParticlesInVolume.KillParticlesInVolume', inputs: { 'Kill Shape': { option: 'Box' }, 'Box Size': [3300, 1700, 800], 'Origin Offset': [0, 0, 500], 'Invert Volume': true } }],
    },
    Grid3D_Gas_Master_Emitter: {
      constants: {
        'User.WorldSpaceSize': [3600, 1800, 900],
        'User.ResolutionMaxAxis': 192,
        'Grid3D_Gas_QualityOverrides.Override.Resolution Max Axis': true,
        'Grid3D_Gas_UpdateEmitter.Local Pivot': GRID_PIVOT,
        'Grid3D_Gas_SphereSource.Enable': true,
        'Grid3D_Gas_SphereSource.Emit Position': SOURCE_POSITION,
        'Grid3D_Gas_SphereSource.Color': [1, 1, 1, 1],
        'Grid3D_Gas_SphereSource.Temperature': 0,
        'Grid3D_Gas_SphereSource.Density': user('Density'),
        'Grid3D_Gas_SphereSource.Emit Radius': SOURCE_RADIUS,
        'Grid3D_Gas_SphereSource.Non Uniform Scale': SOURCE_SCALE,
        'Grid3D_Gas_SphereSource.Velocity': user('Wind'),
        'Grid3D_Gas_SphereSource.Noise Intensity 1': 0.6,
        'Grid3D_Gas_SphereSource.Noise Frequency 1': 2,
        'Grid3D_Gas_SphereSource.Noise Speed 1': 1.4,
        'Grid3D_Gas_SphereSource.Noise Intensity 2': 0.35,
        'Grid3D_Gas_SphereSource.Noise Frequency 2': 6,
        'Grid3D_Gas_SphereSource.Noise Speed 2': 2.6,
        'Grid3D_Gas_Buoyancy.TemperatureBuoyancy': 0,
        'Grid3D_Gas_Buoyancy.DensityBuoyancy': 0.1,
        'Grid3D_Advect_FluidAttribute.Dissipation Rate Density': 0.15,
        'Grid3D_Advect_FluidAttribute.Subtraction Amount Density': 0.01,
        'Grid3D_Advect_FluidAttribute001.Dissipation Rate': 0,
        'Grid3D_SmallScaleForce.Gain': 200,
        'Grid3D_SmallScaleForce.Velocity Falloff': 10,
        'Grid3D_Turbulence001.Calculate Turbulence': true,
        'Grid3D_Turbulence001.Turbulence Bias': [-0.45, 0, 0],
        'Grid3D_Turbulence001.Turbulence Frequency': [0.05, 0.05, 0.05],
        'Grid3D_Turbulence001.Turbulence Gain': [50, 50, 50],
        'Grid3D_Turbulence001.Turbulence Speed': 0.2,
        'Grid3D_Turbulence002.Calculate Turbulence': true,
        'Grid3D_Turbulence002.Mask Range': [0, 1],
        'Grid3D_Turbulence002.Turbulence Frequency': [0.1, 0.1, 0.1],
        'Grid3D_Turbulence002.Turbulence Gain': [2000, 2000, 2000],
        'Grid3D_Turbulence002.Turbulence Speed': 1,
        'Grid3D_Turbulence002.Velocity Based Turbulence Gain': 1,
        'Grid3D_VorticityConfinementForce.Calculate Vorticity Confinement': false,
        'Grid3D_VorticityConfinementForce.Velocity Falloff': 5,
        'Grid3D_VorticityConfinementForce.VorticityMult': 0.5,
        'Grid3D_Gas_InitializeMaterialControls.Render Density': 'Linear',
        'Grid3D_Gas_InitializeMaterialControls.Render Temperature': 'Black Body',
        'Grid3D_Gas_MaterialControls.Density Albedo': 0.25,
        'Grid3D_Gas_MaterialControls.Smoke Color': [0.55, 0.36, 0.18, 1],
        'Grid3D_Gas_MaterialControls.Density Gain': 2,
      },
    },
  },
});
