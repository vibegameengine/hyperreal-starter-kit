import { defineSystem, option, user } from '../../../../shared/niagara';

export const waterSplash = defineSystem({
  user: { Rate: 0, Throw: [0, 0, 1], Speed: 80 },
  emitters: {
    Drops: {
      template: 'Fountain',
      sim: 'gpu',
      inputs: {
        'SpawnRate.SpawnRate': user('Rate'),
        'InitializeParticle.Lifetime Min': 0.3,
        'InitializeParticle.Lifetime Max': 0.55,
        'InitializeParticle.Color': [0.85, 0.92, 0.95, 0.75],
        'InitializeParticle.Sprite Size Mode': option('Random Uniform'),
        'InitializeParticle.Uniform Sprite Size Min': 0.5,
        'InitializeParticle.Uniform Sprite Size Max': 2.2,
        'AddVelocity.Velocity Mode': option('In Cone'),
        'AddVelocity.Velocity Speed': user('Speed'),
        'AddVelocity.Cone Axis': user('Throw'),
        'AddVelocity.Cone Angle': 40,
      },
    },
  },
});
