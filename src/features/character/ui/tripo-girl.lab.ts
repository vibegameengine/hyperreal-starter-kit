import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'tripo-girl',
  title: 'Tripo girl as the player',
  description: "The modular Tripo character (body, separate head and hair, Mixamo rig with breast and butt bones) as the player's body: Manny's controls, locomotion graph and unarmed set retargeted onto her with ?retargetFrom=manny. Switch to Manny to compare.",
  category: 'character',
  load: () => import('../labs/tripo-girl'),
});
