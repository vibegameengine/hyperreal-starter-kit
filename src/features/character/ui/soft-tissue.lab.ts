import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'soft-tissue',
  title: 'Soft tissue',
  description: 'The Tripo girl walking and jogging on Manny clips while <animDynamics> moves her breast and butt bones: physics on and off, stiffness and damping live.',
  category: 'character',
  load: () => import('../labs/soft-tissue'),
});
