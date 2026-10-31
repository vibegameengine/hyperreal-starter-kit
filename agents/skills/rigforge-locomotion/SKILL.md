---
name: rigforge-locomotion
description: >-
  Make the character's locomotion for a game on this kit from a video: capture it in RigForge (SpriteForge),
  cut the gait, generate the full set of loops, starts, stops, pivots and turns with MotionBricks, export it as
  Mixamo FBX into src/features/character/assets/mixamo/motion, and feed it to motion matching
  (manny.motion.ts, defineMotionMatching). MANDATORY before adding or replacing walk/jog/run clips, building a
  motion-matching database from our own clips, or when a gait in the game does not look like the video it came
  from. Trigger on: "locomotion", "walk cycle", "jog", "run from video", "mocap", "RigForge", "motion matching",
  "starts/stops/pivots", "the run looks upright", "legs look wrong in the game", "стилизованный бег".
---

# Locomotion from video, through RigForge

The clips are made in RigForge (the `rigforge` skill in SpriteForge: `E:\Projects\AIGamess\SpriteForge\.claude\skills\rigforge`)
and consumed here from TypeScript only: no C++, no editor, no recompiling. Read the kit README, "Which layer to
change", first: a wrong clip is fixed in RigForge or in the file (layer 2), never patched in the game.

## The chain

1. **Video** of one person doing the gait: several even strides of the style you want, the whole body in frame.
   Walk and jog for one character come from the same person, or the two gaits will not match.
2. **RigForge, Gather** (in a RigForge project of its own): the video becomes a take; the agent marks the steady
   stretch of each gait as a `cycle` select named `walk` or `jog` and runs `selects.locomotion` on it. The clips
   can then be corrected in RigForge's other modes (Override keys on any frame, Refine IK anchors). The **Export**
   node at the end of RigForge's node graph bakes every edit in and writes each clip as a Mixamo FBX on the kit's
   rig into `src/features/character/assets/mixamo/motion/` (`export.run()` in the agent API):
   `<gait>_loop`, `<gait>_idle_loop`, `<gait>_start_a/b`, `<gait>_stop_a/b`, `<gait>_start_90/180_left/right`,
   `<gait>_pivot_90/180_left/right`, `<gait>_turn_90/180_left/right`.
3. **The files**: Mixamo hierarchy exactly as `mixamo/default-humanoid.fbx`, root motion on `mixamorig:Hips`,
   centimetres, bind pose = the rig's T-pose, starts and stops open/close on the Mixamo idle
   (`mixamo/animations/idle.fbx`).
4. **Import lines**: each clip is imported onto the Mixamo skeleton and retargeted to Manny in the same line, e.g.
   `./mixamo/motion/jog_loop.fbx?skeleton=../default-humanoid.fbx&retarget=manny` (see the `mixamo-characters`
   skill for the query parameters).
5. **Motion matching**: `src/features/character/assets/manny.motion.ts` builds the databases with
   `defineMotionMatching` from those import paths: loops, starts, stops and pivots per gait, each with its own
   continuing-pose cost bias. The `motion-matching` lab (`src/features/character/labs/motion-matching`) runs a
   fixed scenario (idle, walk, run, stop, 90 and 180 degree turns) and lists the clips in each database.

## Choosing what to capture

The loop is the style. Everything else in the set is generated from it, so the select must be the stretch that
looks the way the game should look:

- it holds at least one full gait cycle: a strike of one foot to the next strike of the same foot, at an even
  speed, with no landing, crouch or turn inside;
- if the stylised part of the video is shorter than a full cycle (a low, leaning run of a few frames before the
  person straightens up), there is no loop to cut from it: say so and decide with the user how to build the cycle
  from it before taking a different, upright stretch of the same video;
- check the select with `gather.frames` before running the set: the frames at the select's start and end show
  what the clip will be.

## Checks, in numbers

Read them off the files (Blender import of the FBX, the take BVH in RigForge's capture folder), not off
screenshots:

- **Posture**: pelvis height over the lowest foot (% of the rig's standing hip height), head height above and
  distance ahead of the hips, mean knee bend. Take over the select range, `<gait>_loop.bvh` and
  `motion/<gait>_loop.fbx` must agree. If the loop is more upright than the take, the cleanup changed the
  posture: the take's ground was tilted (moving camera) and must be levelled by rotation, never by moving the
  body down.
- **Ground**: the lowest foot joint touches 0 on planted frames and never goes below it.
- **Loop seam**: the first and last frame of `<gait>_loop` are equal.
- **Bind pose**: each FBX's bind pose equals `default-humanoid.fbx`'s rest (0 cm / 0 deg).
- **In the game**: after import the kit reproduces the FBX's numbers on the Mixamo skeleton and on Manny; if
  the game shows something the FBX does not, the import line or the retarget is wrong, not the clip.

## What not to do

- Do not edit clips in the game code to fix a posture, a foot or a seam: regenerate them in RigForge.
- Do not mix gaits from different people or different videos in one set.
- Do not hand-edit FBX files in `motion/`; RigForge rewrites them on the next export.
