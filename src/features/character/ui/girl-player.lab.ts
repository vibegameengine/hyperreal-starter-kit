import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'girl-player',
  title: 'Girl player',
  description: 'The tripo-girl prefab as the player: close over-the-shoulder camera, walk and Shift to run, soft tissue, hair and gear physics, a rim light that draws her outline. The base for motion matching.',
  category: 'character',
  load: () => import('../labs/girl-player'),
});
