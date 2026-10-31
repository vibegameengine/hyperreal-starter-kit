# Secondary motion: soft tissue, hair and danglers

Portable kit lesson. It holds for any skinned character in this kit that carries extra bones and uses `<animDynamics>`. Every number below was read from a running game with `vge/tools/soft-tissue-telemetry.mjs`. None of it is a guess.

## Shape of the system

- **Physics:** the engine's `FAnimNode_AnimDynamics`, bound as `<animDynamics>` (`VgeAnimInstance.cpp`, `VgeAnimNodes.h`) with the engine's own property names. The kit adds no physics of its own.
- **`src/features/character/secondary-motion/useInertialDrive.ts`:** feeds every node its gravity and its inertial push each frame (see "Engine defect" and "Drive" below).
- **`src/features/character/soft-tissue/`:** breast and butt.
  - `presets.ts` (`CURVY_BODY`, values from the Skyrim 3BA CBPC configs, `docs/research/mods-animation-and-body-physics.md` section 9);
  - `SoftTissue.tsx`: one node per tissue bone, base to tip;
  - `useSoftTissueDrive.ts`.
- **`src/features/character/danglers/`:** hair, jewellery, pouches, ribbons, straps.
  - `presets.ts` (`TRIPO_GIRL_DANGLERS`);
  - `Danglers.tsx`: one node per link, base to tip; link lengths are read from the ref pose;
  - drive hook.
- **`labs/soft-tissue`** is the bench.
  - The telemetry tool: `node vge/tools/soft-tissue-telemetry.mjs --motion idle|walk|jog [--bounce n --decay n --stiffness n --only bone,... --colliders off --gravity off --angular off --drive off --physics off]`.
  - It resets the dynamics, records N seconds and writes per-frame samples to `wip/soft-tissue/`.
  - For each bone it records the offset from its animated pose in the bone's own rest axes (cm), the rotation away from the animated pose (degrees) and the bone scale.

## How to tune: the method that worked

1. **Telemetry first, frames last.** A frame says "it looks wrong", the numbers say which bone, which axis and how far. Every fix below was found by reading those numbers, and checked by them again.
2. **Always record the same three motions** (idle, walk, jog) and compare against `--physics off`, which must read about 0.
3. **Cut until one node misbehaves alone**:
   - `--only` keeps only the chains holding the named bones;
   - `--gravity off`, `--angular off` and `--drive off` take one force out at a time.
   The faults were always found by switching one force off, never by turning numbers up or down.
4. **Reset the dynamics before every recording** (`ResetAnimInstanceDynamics(ResetPhysics)`, done by the tool). The body state survives between runs. A tip that flipped in the previous run stays flipped and poisons the next idle reading. Measured: idle angles of 70-85° that were leftovers.
5. **Read the bone axes from the game, never from Blender.** After the FBX import every extra bone of the tripo-girl rig points along local −Y. The breast's up is −Z, the butt's up is +Z, side is X.

## Soft tissue (breast, butt): decisions

- **Simulation space is the space bone** (`BoneRelative`): Spine2 for the breasts, Hips for the butt.
  - In component space the chest twist of the walk carries the breast 6 cm sideways in 0.35 s.
  - A soft spring (k 170-260) lags by the whole limit at 2.7-4 Hz.
  - A stiff one (×3 to ×12) only buzzes at 5-9 Hz. It hit the limits at every stiffness tried.
- **Damping is decay per second**, converted to the node's `1 − e^−rate`.
  - The engine multiplies momentum by `(1 − d)^dt` (`AnimPhysicsSolver.cpp:869`), so `d = 0.8` keeps 20 % per second.
  - Because `d` is a float, the strongest usable decay is about 16 /s.
- **Body centre on the bone** (`centerAlong` 0).
  - The engine anchors the linear spring at the body centre (`AnimNode_AnimDynamics.cpp:1367`), while the linear limit holds the joint point.
  - With a joint offset the two fight constantly.
- **8 cm boxes.** A 3 cm box has so little inertia that the angular limits throw it around.
- **Step bounce is a force with a per-axis response**: the 3BA `linearX/Y/Z` values, side 0.40, forward 0.21, up 0.57-0.93; butt 1.225 / 0.7 / 1.05.
  - Without it the jog drives the breasts sideways into any limit, at 1.7 Hz resonance.
- **Result** (`bounce` 0.35, limits sized like 3BA, 3.3-3.9 cm):
  - idle sag 0.9 cm straight down;
  - walk breast up −0.1..+2.3 cm;
  - jog −0.3..+1.6 cm, butt down to −1.9 cm;
  - nothing touches a limit.

## Hair and danglers: decisions

- **One node per link, nested base to tip. Not AnimDynamics chain mode.**
  - In chain mode the angular limit of every body after the first is measured against the parent body with an identity frame (`AnimNode_AnimDynamics.cpp:1309`).
  - It ignores the rest rotation between links. On this rig neighbouring hair and ribbon links sit 10-50° apart at rest (`GetRefPoseTransform(i).Rotation`).
  - So every link starts outside its limit, and the chain tears: tips flipped 180° and left their parent by 5-18 cm.
  - A single-body node measures its limit against its own animated bone, which already carries the parent's simulated pose.
- **Free swing limits (170°); the angular spring holds the shape.**
  - The engine always locks twist to zero (`AnimPhysicsSolver.cpp:759-760`).
  - Swing limits combined with an angular spring fight each other. Measured: spring 300 with ±35° limits held a link 11-49° off its rest pose; with free limits, 3-9°.
  - A stronger spring made it worse while the limits were on.
  - Only light jewellery keeps a swing limit (earrings 60°, pendant and hardware 45°), because its spring is too weak to fight it.
- **Links at least 4 cm thick.** A 2 × L × 2 box has about 0.67 inertia around its long axis. The spring and gravity together twist it against the zero-twist lock and the link tears. At 6 cm the same links held.
- **Gravity and inertia are separate knobs** (`gravityScale`, `inertiaScale`, as 3BA separates `gravityBias` from `linear`).
  - Hair with gravity 0.1 against a spring of 600 sagged about 45° per link at idle.
  - Gravity 0.1 with full inertia made the walk push 10× harder than the weight and flipped everything.
  - Stylised hair: gravity 0.02, inertia 0.1, spring 2000, decay 10 /s.
- **The drive acceleration is smoothed over time** (60 ms time constant on velocity and acceleration).
  - The bone positions read on the game thread repeat now and then, and the finite difference spiked frame to frame.
  - Measured: force on `hair_tail_06` went 133, 126, 51, 325, 244 between consecutive frames.
  - The noise alone drove the hair tips to 70-80° on the walk. After smoothing: 52° peak at the tip, 13° at the root.
- **Stiff gear.**
  - Pouches use spring 8000, the pouches fused into the trousers 15000-25000, gravity and inertia 0.3.
  - A pouch on a thigh sees about 2 g on every step, and at spring 400 it flipped.
- **Result** (`TRIPO_GIRL_DANGLERS`):

  | Part | Idle | Walk | Jog |
  |---|---|---|---|
  | Hair tail | 1-9° | 13° root, 33-72° along the tip | 8° root, 28-63° along the tip |
  | Front locks | — | 12° | 8° |
  | Earrings | — | 33-46° | 64-68° |
  | Pendant | 30° hang | 42° | 47° |
  | Pouches | — | 3-8° | 5-11° |
  | Strap | — | 24° | 35° |

  No link leaves its parent: offsets under 0.06 cm. Open: the ribbon tip still reaches 86-93° on walk and jog.

## Engine defect worked around

- `FAnimNode_AnimDynamics` composes the bone-relative sim space as `GetComponentTransform() * RelativeBoneTransform` (`AnimNode_AnimDynamics.cpp:337` and `:1678`). In UE `A * B` applies A first, so the bone's world frame should be `Bone * Component`.
- With the component unrotated the two agree. With it rotated (any character that turns) gravity, `externalForce` and the sim-space angular terms land in the wrong axes.
- Measured: mesh yaw −120 put the idle sag 0.77 cm sideways. Yaw 0 put it 0.87 cm straight down.
- `useInertialDrive` works around it:
  - gravity goes in as `gravityOverride` in sim space, computed from the correct frame;
  - the force is pre-rotated by the engine's own composition (`asTheEngineComposesIt`);
  - `simSpaceAngularAlpha` is 0, and the twist of the space bone reaches the tissue through the force of each bone's animated point.

## Rig requirements

- **A `Root` bone above the pelvis.** Manny's locomotion clips keep `bEnableRootMotion` and `bForceRootLock` (RefPose) after retargeting. On a skeleton whose root is the pelvis that pinned Hips to its ref pose on every frame of walk and jog: no bob, no sway, no butt bounce. Idle has no root motion, which is why the pelvis looked alive there.
- **Bone scale 1, units cm.** An export with UnitScaleFactor 100 gave every child offset ×0.01.

## Kit defects fixed on the way

- **Graph lost on a mesh change.** A `<skeletalMeshComponent>` whose mesh asset changes (a content rebuild) gets a new anim instance from `SetSkeletalMeshAsset`, and the `<animGraph>` stayed on the dead one. `readoptGraphs` in `src/shared/react/anim.ts`, called from the renderer's `update`, submits the graph to the new instance. Before it, telemetry read all zeros after any rebuild.
- **Puerts struct views must not be cached.** A `UE.Vector` taken as `.Translation` of a temporary `FTransform` points into freed memory once the transform is gone. Keeping one across frames crashed the game in `puerts::FScriptStructPropertyTranslator::JsToUE` (`PropertyTranslator.cpp:688`). Copy the numbers out at once.
