import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'hair',
  title: 'Hair strands',
  description: 'Strand hair from TypeScript: an Alembic groom beside the code is imported like a model, bound to Quinn by a .groom.ts description, simulated by the hair solver and blown by the HUD\'s wind while you run and turn.',
  category: 'character',
  load: () => import('../labs/hair'),
});
