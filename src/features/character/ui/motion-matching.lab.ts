import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'motion-matching',
  title: 'Motion matching',
  description: "The player walks on Unreal's motion matching: a PoseSearch database and its graph built from a *.motion.ts module.",
  category: 'character',
  load: () => import('../labs/motion-matching'),
});
