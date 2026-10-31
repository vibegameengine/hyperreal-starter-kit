import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'growth',
  title: 'Growth',
  description: 'The valley grows around the walking player: a world-space mask painted into a render target every frame lays the road, raises the grass and springs the trees up where the player has been.',
  category: 'world',
  load: () => import('../labs/growth'),
});
