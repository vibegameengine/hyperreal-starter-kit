import { defineSystem, option, user } from '../../../shared/niagara';
import glow from './glow';


export const sparks = defineSystem({
  user: { Rate: 2000, Tint: [1, 0.45, 0.12, 1] },
  emitters: {
    Sparks: {
      template: 'Fountain',
      sim: 'gpu',
      inputs: {
        'SpawnRate.SpawnRate': user('Rate'),
        'InitializeParticle.Color': user('Tint'),
        'InitializeParticle.Lifetime Min': 1.5,
        'InitializeParticle.Lifetime Max': 2.5,
      },
      modules: [{ stage: 'particleUpdate', script: '/Niagara/Modules/Update/Forces/V2/CurlNoiseForce.CurlNoiseForce', inputs: { 'Noise Strength': 900 } }],
      renderers: [{ type: 'sprite', material: glow }],
    },
  },
});

const repeating = { 'EmitterState.Life Cycle Mode': option('Self'), 'EmitterState.Loop Behavior': option('Infinite') };

export const burst = defineSystem({
  emitters: {
    Burst: {
      template: 'OmnidirectionalBurst',
      sim: 'cpu',
      inputs: {
        ...repeating,
        'InitializeParticle.Color': [0.3, 0.7, 1, 1],
        'InitializeParticle.Sprite Size Mode': option('Uniform'),
        'InitializeParticle.Uniform Sprite Size': 12,
      },
      renderers: [{ type: 'sprite', material: glow }],
    },
  },
});

export const ribbon = defineSystem({
  emitters: {
    Ribbon: {
      template: 'LocationBasedRibbon',
      inputs: { ...repeating, 'InitializeParticle.Ribbon Width Mode': option('Direct Set'), 'InitializeParticle.Ribbon Width': 25 },
      modules: [{ stage: 'emitterUpdate', script: '/Niagara/Modules/Emitter/SpawnRate.SpawnRate', inputs: { SpawnRate: 60 } }],
    },
  },
});

export const meshes = defineSystem({
  emitters: {
    Meshes: {
      template: 'UpwardMeshBurst',
      inputs: { ...repeating, 'InitializeParticle.Mesh Uniform Scale Min': 0.1, 'InitializeParticle.Mesh Uniform Scale Max': 0.25 },
      renderers: [{ type: 'mesh', meshes: ['/Engine/BasicShapes/Cube.Cube'] }],
    },
  },
});
