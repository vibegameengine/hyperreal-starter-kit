import mixamo from './default-humanoid.fbx';
import mixamoWithMannyClips from './default-humanoid.fbx?retargetFrom=manny';
import idle from './animations/idle.fbx?skeleton=../default-humanoid.fbx';
import idleOnManny from './animations/idle.fbx?skeleton=../default-humanoid.fbx&retarget=manny';
import running from './animations/running.fbx?skeleton=../default-humanoid.fbx';
import runningOnManny from './animations/running.fbx?skeleton=../default-humanoid.fbx&retarget=manny';
import runningBackward from './animations/running-backward.fbx?skeleton=../default-humanoid.fbx';
import runningBackwardOnManny from './animations/running-backward.fbx?skeleton=../default-humanoid.fbx&retarget=manny';
import walkStrafeRight from './animations/walk-strafe-right.fbx?skeleton=../default-humanoid.fbx';
import walkStrafeRightOnManny from './animations/walk-strafe-right.fbx?skeleton=../default-humanoid.fbx&retarget=manny';
import walking from './animations/walking.fbx?skeleton=../default-humanoid.fbx';
import walkingOnManny from './animations/walking.fbx?skeleton=../default-humanoid.fbx&retarget=manny';
import walkingBackwards from './animations/walking-backwards.fbx?skeleton=../default-humanoid.fbx';
import walkingBackwardsOnManny from './animations/walking-backwards.fbx?skeleton=../default-humanoid.fbx&retarget=manny';
import rigforgeJog from './motion/jog_loop.fbx?skeleton=rig.fbx';
import rigforgeJogOnManny from './motion/jog_loop.fbx?skeleton=rig.fbx&retarget=manny';

export { mixamo, mixamoWithMannyClips };

export const MIXAMO_CLIPS = {
  idle: { clip: idle, onManny: idleOnManny },
  walking: { clip: walking, onManny: walkingOnManny },
  running: { clip: running, onManny: runningOnManny },
  walkingBackwards: { clip: walkingBackwards, onManny: walkingBackwardsOnManny },
  runningBackward: { clip: runningBackward, onManny: runningBackwardOnManny },
  walkStrafeRight: { clip: walkStrafeRight, onManny: walkStrafeRightOnManny },
  rigforgeJog: { clip: rigforgeJog, onManny: rigforgeJogOnManny },
};
export type MixamoClip = keyof typeof MIXAMO_CLIPS;
