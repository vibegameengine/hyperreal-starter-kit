import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'compute',
  title: 'Compute',
  description: 'A compute shader written in TypeScript (*.compute.ts): one kernel writes a gradient and a clock into a render target every frame, shown on a plane.',
  category: 'render',
  load: () => import('../labs/compute'),
});
