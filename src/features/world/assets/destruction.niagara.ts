import { defineSystem, option } from '../../../shared/niagara';
import dust from './dust.material';

export const breakDust = defineSystem({
  emitters: {
    Dust: {
      template: 'OmnidirectionalBurst',
      sim: 'cpu',
      inputs: {
        'InitializeParticle.Color': [0.42, 0.38, 0.33, 0.35],
        'InitializeParticle.Lifetime Min': 1.5,
        'InitializeParticle.Lifetime Max': 3,
        'InitializeParticle.Sprite Size Mode': option('Random Uniform'),
        'InitializeParticle.Uniform Sprite Size Min': 60,
        'InitializeParticle.Uniform Sprite Size Max': 160,
      },
      renderers: [{ type: 'sprite', material: dust }],
    },
  },
});
