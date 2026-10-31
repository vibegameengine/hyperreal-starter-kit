import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'valley',
  title: 'Valley',
  description: 'A landscape built from TypeScript: heights computed in code, imported by the content service as an Unreal Landscape in a level of its own, streamed into the world, walked by the player.',
  category: 'world',
  load: () => import('../labs/valley'),
});
