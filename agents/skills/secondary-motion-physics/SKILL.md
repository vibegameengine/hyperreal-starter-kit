---
name: secondary-motion-physics
description: >-
  Physics for extra bones of a character, the way this kit does it: breast and butt (soft tissue), hair locks and
  tails, earrings, pendants, pouches, ribbons, straps. Runs on the engine's AnimDynamics node through <animDynamics>,
  tuned only from telemetry. MANDATORY before adding, tuning or debugging any jiggle, dangle or swing on a skinned
  character, and when a character's extra bones flip, fly off, sag, buzz, pass through the body or move as one lump.
  Trigger on: "breast physics", "butt physics", "jiggle", "soft tissue", "hair physics", "dangle", "earring",
  "ponytail", "ribbon", "pouch swings", "AnimDynamics", "<animDynamics>", "secondary motion", "it flips", "it flies
  off", "it buzzes", "moves like a rigid lump", "passes through itself".
---

# Secondary motion physics

Every rule here was paid for with a measurement in `labs/soft-tissue` on the tripo-girl rig. The numbers are what the
telemetry read, not estimates.

## The pieces

| Piece | Where |
|---|---|
| The physics | the engine's `FAnimNode_AnimDynamics`, bound as `<animDynamics>` with the engine's own property names (`VgeAnimInstance.cpp`, `VgeAnimNodes.h`). No physics of the kit's own |
| Gravity and inertial push, every frame | `src/features/character/secondary-motion/useInertialDrive.ts` |
| Breast and butt | `src/features/character/soft-tissue/` (`presets.ts` `CURVY_BODY`, `SoftTissue.tsx`, `useSoftTissueDrive.ts`) |
| Hair, jewellery, gear | `src/features/character/danglers/` (`presets.ts` `TRIPO_GIRL_DANGLERS`, `Danglers.tsx`) |
| The bench | `labs/soft-tissue`, telemetry: `node vge/tools/soft-tissue-telemetry.mjs` |

## The method: telemetry first, frames last

1. **Measure every change** with `node vge/tools/soft-tissue-telemetry.mjs --motion idle|walk|jog`. It resets the
   dynamics, records N seconds and writes per-frame samples to `wip/soft-tissue/`. For each bone it gives the offset
   from the animated pose in the bone's own rest axes (cm), the rotation away from it (degrees) and the bone scale.
   A frame only says "wrong"; the numbers say which bone, which axis, how far.
2. **Always the same three motions**, plus `--physics off`, which must read about 0. If it does not, the
   measurement is broken, not the physics.
3. **Cut one force at a time** until a single node misbehaves alone:
   - `--only bone,...` keeps only the chains holding those bones;
   - `--gravity off`, `--angular off` and `--drive off` take out one force each;
   - `--bounce`, `--decay` and `--stiffness` scale the tissue.
   Every fault below was found by switching a force off, never by turning numbers up or down blindly.
4. **Reset before every recording.** The tool calls `ResetAnimInstanceDynamics(ResetPhysics)`. Body state survives
   between runs: a tip flipped in the last run stays flipped and fakes 70-85 degrees in the next idle reading.
5. **Read bone axes from the game, never from Blender.** On this rig every extra bone points along local -Y after the
   FBX import. The breast's up is -Z, the butt's up is +Z, side is X. A first preset that assumed +Y put the body
   centre inside the ribcage.
6. **Read your own numbers before trusting them.** The angle metric first read 0 for everything (rotator deltas);
   quaternion angle fixed it. Keep the telemetry honest before tuning against it.

## Rules for every node

- **Simulate in the bone the part hangs from** (`simulationSpace="BoneRelative"`): Spine2 for breasts, Hips for the
  butt, Head for hair, the thigh or calf for gear.
  - Measured in component space: the walk's chest twist carried the breast 6 cm sideways in 0.35 s. A soft spring
    lagged by the whole limit at 2.7-4 Hz. A stiff one (x3 to x12) only buzzed at 5-9 Hz, still at the limits.
- **Damping is decay per second**, converted to `1 - e^-rate`.
  - The engine multiplies momentum by `(1 - d)^dt` (`AnimPhysicsSolver.cpp:869`), so `d = 0.8` keeps 20 % per second.
  - Because `d` is a float, the strongest usable decay is about 16 /s.
- **Feed gravity and push through `useInertialDrive`**, never through the node's own gravity or
  `componentLinearAccScale` (see the engine defect below).
  - The push is `-acceleration` of each bone's animated point, scaled per node.
  - Smooth it over time (60 ms constant on velocity and acceleration). Bone positions read on the game thread repeat
    now and then, and the raw finite difference spiked frame to frame. Measured: force on a hair tip went 133, 126, 51,
    325, 244 on consecutive frames. That noise alone swung the tips to 70-80 degrees; smoothed, 52 at the tip and 13 at
    the root.
- **Boxes at least 4 cm thick, soft tissue 8 cm.** A 2 x L x 2 box has about 0.67 inertia around its long axis.
  Spring and gravity together twist it against the engine's zero-twist lock, and the link tears.

## Chains (hair, ribbons, straps, breast)

- **One node per link, nested base to tip. Never AnimDynamics chain mode.**
  - In chain mode the angular limit of every body after the first is measured against the parent body with an
    identity frame (`AnimNode_AnimDynamics.cpp:1309`). It ignores the rest rotation between links, which on this rig
    is 10-50 degrees.
  - Every link starts outside its limit and the chain tears: tips flipped 180 degrees and left their parent by 5-18 cm.
  - A single-body node measures against its own animated bone, which already carries the parent's simulated pose.
- **Free swing limits (170 degrees); the angular spring holds the shape.**
  - The engine always locks twist to zero (`AnimPhysicsSolver.cpp:759-760`).
  - Swing limits plus an angular spring fight each other. Measured: spring 300 with +-35 degree limits held a link
    11-49 degrees off its rest pose; with free limits, 3-9 degrees. A stronger spring made it worse while limits were
    on.
  - Keep a limit only where the spring is weak (earrings 60, pendant and hardware 45).
- **Gravity and inertia are separate knobs** (`gravityScale`, `inertiaScale`; 3BA separates `gravityBias` from
  `linear` the same way).
  - Hair with gravity 0.1 against spring 600 sagged about 45 degrees per link at idle.
  - Reduced gravity with full inertia made the walk push 10x harder than the weight and flipped everything.
  - Stylised hair: gravity 0.02, inertia 0.1, spring 2000, decay 10 /s.
- **Gear on a thigh sees about 2 g every step.** Pouches need spring 8000, pouches fused into the clothes 15000-25000.
  At spring 400 a pouch flipped.
- **Serial offsets add up toward the tip.** Three translating breast bones drove the tip through the mound. Put the
  swing at the base (a pinned pivot with the body centre in the mass) and keep later bones to small, stiff shifts.

## Soft tissue (breast, butt)

- **A translating tissue bone keeps its body centre on the bone** (`centerAlong` 0).
  - The engine anchors the linear spring at the body centre (`AnimNode_AnimDynamics.cpp:1367`), while the linear
    limit holds the joint point. With a joint offset the two fight constantly.
- **A swinging tissue bone is pinned** (linear limits 0, linear spring off), with the body centre out in the mass and
  an angular spring.
- **Cap a soft swing in force, not with angle limits.** A spring soft enough to show the walk throws the tissue out
  on any sustained push.
  - Measured on `labs/girl-player`: a jump is a free fall, and the push holds about 1 g (900-1000) for the whole
    flight, 1700 at take-off. The breast swung 6 to 110 degrees and stayed there; the butt reached 65. A fast 180
    degree turn gave 54 / 25.
  - 3BA solves this with `maxoffset`. Here, angle limits fight the spring, so the push is soft-saturated instead:
    `maxPush * tanh(|F| / maxPush)`.
  - `maxPush` comes from the wanted largest swing: `maxPush = angularSpring * radians(maxSwingDegrees) / centerAlong`,
    because the equilibrium angle is about push x lever / stiffness.
  - With breast 20 and butt 18 degrees: walk 14 / 10, run 10 / 8, 180 turn 12 / 8, jump 19 / 20.
- **"Slow motion" means the swing frequency is too low.** Raise the spring and raise `bounce` by the same factor, so
  the size stays the same; `maxPush` follows the spring by itself.
  - The user called breast spring 750 / butt 1500 with 60 ms drive smoothing "slow-mo".
  - Spring 1500 / 3000 with bounce 2 and 30 ms smoothing kept the size (walk 13 / 14, turn 16 / 16, jump 17 / 17) and
    rings at about 2.4 Hz after landing.
  - Measure jumps and turns from script, in the player lab: `pawn.Jump()` and `AddMovementInput` each frame, then read
    the peak angle.
- **Weight the push per bone axis** with the 3BA `linearX/Y/Z` values: breast side 0.40, forward 0.21, up 0.57-0.93;
  butt 1.225 / 0.7 / 1.05.
  - Without it the jog drove the breasts sideways into any limit at 1.7 Hz resonance.
- **Size limits like 3BA**: 2.3-2.76 Skyrim units, so 3.3-3.9 cm; the butt goes down -6.4 cm and up 2.1 cm.
- **The rig must give the pelvis something to do.**
  - Manny's locomotion clips keep `bEnableRootMotion` and `bForceRootLock` (RefPose) after retargeting.
  - On a skeleton whose root is the pelvis, that pinned Hips on every frame of walk and jog: no bob, no sway, no butt
    bounce. Idle has no root motion, so the pelvis looked alive there.
  - The rig needs a `Root` above the pelvis, bone scale 1, units cm.

## Engine defect, worked around in useInertialDrive

- `FAnimNode_AnimDynamics` composes the bone-relative sim space as `GetComponentTransform() * RelativeBoneTransform`
  (`AnimNode_AnimDynamics.cpp:337`, `:1678`). In UE `A * B` applies A first, so it should be `Bone * Component`.
- Unrotated component: no difference. Rotated (any character that turns): gravity, `externalForce` and the
  sim-space angular terms land in the wrong axes.
  - Measured: mesh yaw -120 put the idle sag 0.77 cm sideways; yaw 0 put it 0.87 cm straight down.
- The workaround:
  - gravity goes in as `gravityOverride` in sim space, from the correct frame;
  - the force is pre-rotated by the engine's own composition (`asTheEngineComposesIt`);
  - `simSpaceAngularAlpha` is 0, and the space bone's twist reaches the part through the force of each bone's
    animated point.

## Kit traps met on the way

- **A mesh swap kills the graph.** A `<skeletalMeshComponent>` whose mesh asset changes (every content rebuild) gets a
  new anim instance from `SetSkeletalMeshAsset`. `readoptGraphs` (`src/shared/react/anim.ts`) resubmits the graph.
  Before it, telemetry read all zeros after a rebuild. Read the graph from `component.GetAnimInstance()`, never from a
  ref kept since mount.
- **Never cache a Puerts struct view.** `.Translation` of a temporary `FTransform` points into freed memory once the
  transform is gone. Keeping one across frames crashed the game in `FScriptStructPropertyTranslator::JsToUE`. Copy
  the numbers out at once.
- **Lab APIs on `globalThis` must read the latest render** (a proxy over a ref). A plain object registered once
  served first-render values, such as clip paths from a deleted build.

## Results this skill reached (tripo-girl, content build 159+)

| Part | Idle | Walk | Jog |
|---|---|---|---|
| Breast (up) | 0.9 cm sag, straight down | -0.1..+2.3 cm | -0.3..+1.6 cm |
| Butt (down) | — | to -1.9 cm | — |
| Hair tail | 1-9 degrees | 13 at the root, 33-72 along the tip | 8 at the root, 28-63 along the tip |
| Earrings | — | 33-46 degrees | 64-68 degrees |
| Pendant | 30 degrees (hangs) | 42 | 47 |
| Pouches | — | 3-8 degrees | 5-11 degrees |

No link leaves its parent: offsets under 0.06 cm.

Then the rig's weights were reworked (content build 162): peak breast weight about 0.6, butt weight only out of Hips.
The tissue moved to a pinned swing at the base, breast_02/03 to small stiff shifts, and tissue gravity to 0.05 (the
rest pose already carries the shape; 0.2 sagged the pinned swing 26 degrees at idle).

Then the breast weights were copied from VRoid (`VRM1_Constraint_Twist_Sample.vrm`): breast_01 carries 92-100 %,
breast_02 carries nothing, breast_03 about 8 % at the nipple only.
- The user saw the nipple buzz. That was breast_03's own 0.5 cm shift at 2.6-3.4 Hz, on a bone that touches the
  nipple only. The fix is to simulate only the bone that carries the weight (breast_01); 02 and 03 follow it rigidly.
- The motion was then invisible at the default values. The pinned swing only moved about 5 degrees beyond its idle
  sag, so the user cranked the lab sliders to 300 % and the decay to 1 /s, and the result buzzed.
- Retuned:
  - gravity 0.02, kept separate from the push;
  - bounce 1;
  - breast spring 750, decay 5 /s;
  - butt spring 1500, decay 6 /s, its 3BA axis response scaled by 0.35. At the 3BA values above 1 the butt swung 66-87
    degrees.

| Part | Idle | Walk | Jog |
|---|---|---|---|
| breast_01 swing | 9 degrees | to 22 degrees | to 23 degrees |
| butt swing | 3 degrees | to 16.5 degrees | to 17 degrees |

Open:
- A ribbon tip still reaches 86-93 degrees.
- This tissue layout has not been judged in a frame yet.
