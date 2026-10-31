import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'volumetrics',
  title: 'Volumetrics',
  description: 'A forest clearing at a low sun: volumetric clouds with cover and height from the HUD, a local fog volume in the clearing lit through the trees, and a smoke column drawn as a heterogeneous volume; frame cost at each quality level.',
  category: 'render',
  load: () => import('../labs/volumetrics'),
});
