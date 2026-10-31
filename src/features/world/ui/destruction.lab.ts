import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'destruction',
  title: 'Destruction',
  description: 'Chaos geometry collections from TypeScript: a model beside the code is fractured by a .fracture.ts description, the content service builds the geometry collection through Dataflow, and the pieces break at their damage thresholds.',
  category: 'world',
  load: () => import('../labs/destruction'),
});
