import { defineSystem, option, user } from '../../../../shared/niagara';

export const SAND_COLOR = [0.95, 0.84, 0.66, 1] as const;

export const sandKick = defineSystem({
  user: { Rate: 0, Back: [-1, 0, 0.6] },
  emitters: {
    Grains: {
      template: 'Fountain',
      sim: 'gpu',
      inputs: {
        'SpawnRate.SpawnRate': user('Rate'),
        'InitializeParticle.Lifetime Min': 0.35,
        'InitializeParticle.Lifetime Max': 0.7,
        'InitializeParticle.Color': SAND_COLOR,
        'InitializeParticle.Sprite Size Mode': option('Random Uniform'),
        'InitializeParticle.Uniform Sprite Size Min': 0.4,
        'InitializeParticle.Uniform Sprite Size Max': 1.2,
        'AddVelocity.Velocity Mode': option('In Cone'),
        'AddVelocity.Velocity Speed': 180,
        'AddVelocity.Cone Axis': user('Back'),
        'AddVelocity.Cone Angle': 35,
      },
    },
  },
});
