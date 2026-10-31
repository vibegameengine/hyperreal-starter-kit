import { defineSystem, option } from '../../../shared/niagara';
import dust from './dust';

export const breakDust = defineSystem({
  emitters: {
    Dust: {
      template: 'OmnidirectionalBurst',
      sim: 'cpu',
      inputs: {
        'InitializeParticle.Color': [0.5, 0.46, 0.4, 0.6],
        'InitializeParticle.Lifetime Min': 2,
        'InitializeParticle.Lifetime Max': 4,
        'InitializeParticle.Sprite Size Mode': option('Random Uniform'),
        'InitializeParticle.Uniform Sprite Size Min': 180,
        'InitializeParticle.Uniform Sprite Size Max': 420,
      },
      renderers: [{ type: 'sprite', material: dust }],
    },
  },
});
