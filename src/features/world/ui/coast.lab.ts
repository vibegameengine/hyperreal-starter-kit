import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'coast',
  title: 'Coast',
  description: 'A rocky lagoon coast from TypeScript: a terrain height function with sand, shore, ground and rock layers, CC0 Poly Haven cliff and boulder scans placed along the rocky shore, the sea and the grass.',
  category: 'world',
  load: () => import('../labs/coast'),
});
