# Animation clip contract

This is what a locomotion clip must satisfy before it goes into the kit. The kit uses motion matching (PoseSearch),
blend stack, FootPlacement and LegIK. Each of those nodes silently depends on properties of the data. When a property
is missing, nothing fails loudly: the node just does the wrong thing. Every defect found on 2026-10-29 was a broken
item of this contract, not a bug in a node.

The producer (RigForge) satisfies the "clip" items, and the kit's import satisfies the "kit" items. Each item has a
number, so it can be checked on every clip.

## Clip side (RigForge export)

1. **Skeleton and units.** Every clip is on the kit's Mixamo rig (`src/features/character/assets/mixamo/default-humanoid.fbx`):
   - same bone names, bind pose identical (0.00 cm / 0.00 deg);
   - centimetres, 30 fps.
2. **A root bone that carries the travel.** A `root` bone is the parent of `Hips`, at the floor under the body.
   - Its translation is the character's travel, and its yaw is the character's facing. Z stays 0.
   - Pitch and roll stay zero: lean and crouch live in `Hips` and the spine, never in the root.
   - Why: when the kit has to build a root from the pelvis, the root inherits the pelvis sway. Measured: 19 cm of
     lateral arc and 46 deg of yaw swing per jog cycle. Motion matching then sees a curved, wobbling trajectory against
     the capsule's straight one and jumps three times per cycle. Those jumps blend different step phases into a
     half-crouch with floating feet.
3. **Loops.**
   - The root moves in a straight line at constant velocity, and the facing is constant. The travel direction equals
     the facing within 2 deg.
   - The loop holds a whole number of gait cycles, two or more.
   - First and last frame match: root-relative pose within 1 deg per bone, and the same root velocity.
4. **Feet on the floor.**
   - In stance, the planted toe (`ToeBase` head) is at its rest height (3.3 cm on this rig), within 1 cm.
   - Nothing goes below the floor.
5. **Planted feet do not slide.** With root motion applied, a planted toe moves less than 2 cm over its whole stance.
   Turns on the spot pivot around the ball of the foot.
6. **Starts and stops.**
   - A start begins with at least 0.2 s standing still: both feet planted, root speed 0.
   - A stop ends with at least 0.5 s standing still.
   - Root speed rises and falls smoothly, with no stride-rate wobble.
7. **No side tilt.** The head stays over the planted feet, within 2 cm laterally on every frame. The forward lean is
   the source's.
   - A pendulum loop (cycle 1 leans to one side, cycle 2 mirrors it) is checked per loop instead: the lean averages to
     0 and the cycles are symmetric.
8. **Metadata, one sidecar JSON per clip** (`<clip>.fbx.json`):
   - `kind`: loop, start, stop, pivot or turn;
   - `gait`: walk or jog;
   - `direction`: deg, for starts, pivots and turns;
   - `speed`: cm/s of the root on loops;
   - `cycles`: on loops.

   The kit builds its databases and sets the capsule gait speeds from this, not from hand-typed numbers.

## Kit side (import, `vge/content` and the content service)

9. **Retarget to Manny** keeps the source root as the root. RootMotionSource copies it from the source root instead of
   generating it from the pelvis.
10. **IK bones** (`ik_foot_l/r`, `ik_hand_*`, `ik_foot_root`) are pinned to the FK bones in every retargeted clip.
    - At runtime, the FK feet are copied into the IK bones before FootPlacement. Measured: blending several poses left
      the IK feet 2-4 cm above the FK feet, and LegIK lifted the whole body by that much.
11. **Foot speed curves** `contact_l` and `contact_r` hold the world speed of the ball of each foot, in cm/s with root
    motion included, on every frame.
    - FootPlacement runs in Manual mode and plants a foot below 60 cm/s.
    - Why: in Graph mode it measures speed with the root motion delta of the graph. The kit's capsule drives the
      character, so no root motion reaches the graph, a planted foot reads as running backwards, it never plants, and
      the feet are lifted 2.6 cm.
12. **Databases of one `.motion.ts` share one normalization set** with `NormalizeWithCommonSchema`, so costs compare
    across idle, starts, loops, stops and pivots.
    - Continuing-pose bias: loops, starts and idle -0.01; pivots -0.05; stops -0.3.
    - Interrupt only on a change of core state (standing or moving) or of gait.
13. **Every number above is settable from TypeScript**, with no C++ rebuild.

## Checks in the lab (`labs/motion-matching`)

| Check | Measure | Pass |
| --- | --- | --- |
| Pose jumps inside a loop | non-continuing searches per second while the input is steady | 0 |
| Feet on the floor | lowest toe above the real floor (line trace), per stance | rest height ± 1 cm |
| Planted slide | toe travel over one stance, world space | < 2 cm |
| IK vs FK | distance `ik_foot_*` to `foot_*` after the blend | 0 |
| Root straightness (loops) | lateral deviation of the root path | < 1 cm |
| Gait speed | loop root speed vs capsule speed | within 5 % |
