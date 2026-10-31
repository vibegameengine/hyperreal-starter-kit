import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'metahuman',
  title: 'MetaHuman',
  description: "A MetaHuman from the MetaHuman Sample (an asset pack, npm run pack -- MetaHumans) driven by the kit's player: Ada's body retargets from the player's animated Quinn, her face plays the ARKit expression set through RigLogic, and her strand hair, brows and lashes ride along. The HUD switches to a face close-up.",
  category: 'character',
  load: () => import('../labs/metahuman'),
});
