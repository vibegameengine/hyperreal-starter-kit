import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'water',
  title: 'Water',
  description: "Unreal's Water plugin from TypeScript: a lake with Gerstner waves and a river flowing into it, described with the terrain and built by the content service, crates floating on buoyancy pontoons, the player wading in.",
  category: 'world',
  load: () => import('../labs/water'),
});
