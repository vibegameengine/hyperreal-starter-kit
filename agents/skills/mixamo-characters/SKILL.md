---
name: mixamo-characters
description: >-
  Bring a character of your own into a game on this kit: a model with its skin and animation-only clips (Mixamo or
  any DCC), each imported with one import line, Manny's animations retargeted onto it or its clips onto Manny, and
  the player's body swapped for it. MANDATORY before importing a character or animations, retargeting, or when an
  imported character stretches, folds, falls apart or stands in its bind pose. Trigger on: "Mixamo", "character
  import", "animation import", "retarget", "IK Rig", "IK Retargeter", "swap the mannequin", "my own character",
  "player model", "the character falls apart", "the character stretches", "T-pose", "bind pose".
---

# Characters from Mixamo

Three labs show the whole path, start from them (`npm run shell`, Labs, character), their files are in
`src/features/character/assets/mixamo`:

- `mixamo-character`: the standard Mixamo mannequin (`default-humanoid.fbx`, With Skin) with Mixamo clips made for it
  (Without Skin), each imported onto its skeleton.
- `mixamo-to-manny`: the same clips retargeted onto Unreal's Manny, beside the originals.
- `custom-player`: the player with Manny swapped for the Mixamo mannequin, Manny's unarmed set retargeted onto it.

## Import lines

```ts
import mixamo from './default-humanoid.fbx';                                                  // the model, With Skin
import idle from './animations/idle.fbx?skeleton=../default-humanoid.fbx';                     // a clip, Without Skin, on its skeleton
import idleOnManny from './animations/idle.fbx?skeleton=../default-humanoid.fbx&retarget=manny'; // that clip retargeted onto Manny
import mixamoMoves from './default-humanoid.fbx?retargetFrom=manny';                              // Manny's unarmed set retargeted onto it
```

- `skeleton` names the model file the clip was made for, relative to the clip. The clip is imported onto that model's
  skeleton (content service `import-animations`). The model is imported first in the same build if it has none.
- `retarget` and `retargetFrom` take `manny` (Manny and his unarmed set in `/Game/Characters/Mannequins`,
  `vge/content/characters.mjs` CHARACTERS) or another model file. The content service generates an IK Rig for each
  skeleton and an IK Retargeter and batch-retargets the animations: the steps the editor's Retarget Animations window
  takes with "Auto Generate Retargeter" (`unreal/Source/VibeGameEngineTools/Private/VgeRetargeter.cpp`, after
  `SRetargetAnimAssetsWindow.cpp` FProceduralRetargetAssets). The retargeted copies keep their names.
- Saving the model rebuilds it and every import built on it.
- In the game: `ImportedCharacter` (`entities/ImportedCharacter.tsx`) shows a model or a project mesh playing a clip
  import; `<Player look={{ mesh, clips }} />` runs the player's locomotion graph on another body;
  `locomotionClipsIn(objects)` picks the locomotion set out of a `retargetFrom` import.

## What breaks characters on import

- **Two scales.** A Mixamo FBX that went through Blender or glTF often carries a 100x or 0.01x scale on the armature;
  the clips' bone translations then stretch or fold the body. Keep the model and its clips in the files Mixamo gave
  (FBX, With Skin and Without Skin), or export both the same way.
- **Two bone namings.** The decode step drops `:` from glTF node names (`mixamorig:Hips` becomes `mixamorigHips`),
  FBX keeps it. A glTF model with FBX clips leaves the unmatched bones in the bind pose. One format for a model and
  its clips.
- **Another skeleton.** Mixamo builds a skeleton for each uploaded character's proportions. A clip made for one
  character played on another stretches it: put it on the other character with `retarget`, never with `skeleton`.

None of this needs the kit's C++ or the importer changed (AGENTS.md, "pick the layer"): a character that imports
wrong is fixed in its files.

## When the rig has to go through Blender

Import the FBX Mixamo gave whenever you can. Blender is unavoidable only when the rig changes after Mixamo: bones
added (soft tissue, hair and strap chains for AnimDynamics), the mesh split into parts (body, head, hair as separate
meshes), weights edited. Then the export goes through one script and nothing else:

```bash
blender -b --factory-startup -P agents/skills/mixamo-characters/scripts/export-mixamo-rig.py -- <rig.blend | mixamo.fbx> <out.fbx>
blender -b --factory-startup -P agents/skills/mixamo-characters/scripts/export-mixamo-rig.py -- --check <some.fbx>
```

It applies every transform, stores bones and vertices in centimetres with `UnitScaleFactor 1` (the way the Mixamo
file itself is written), adds a `root` bone at the floor above `Hips`, saves the textures beside the output so they
are embedded, exports, then reads the written FBX back and exits non-zero unless `UnitScaleFactor` is 1, `Hips` sits
30-300 cm from its parent and that parent is `root`. `--check` runs only the read-back on an existing file.

Two defects this prevents, each with what it looks like in the game:

| In the game | Cause in the file |
|---|---|
| The skeleton is about 1.3 cm tall: `Hips` at a normal height but every child bone within a centimetre of it (the mesh may still draw at full size). | Blender's FBX export with the scene in metres writes `UnitScaleFactor 100` and bone offsets in metres. The factor reaches only the root; every child offset is read as centimetres. `FBX_SCALE_ALL` and `FBX_SCALE_UNITS` only move the 100 between the header and the armature node, so neither fixes it. |
| After `?retargetFrom=manny` the legs walk but the pelvis is frozen: no bob, no hip sway on walk, jog and run. | `Hips` is the skeleton's root. Manny's retargeted clips keep `bForceRootLock`, which on Manny locks his separate `root` bone; on a skeleton without one it locks the pelvis. With a `root` above `Hips` the retargeter keeps its root-motion op on and copies Manny's `root` onto it (`VgeRetargeter.cpp`); the lock then holds `root`, and the pelvis animates. |

After a rebuild of the model, a player or character already spawned with the previous build's clips keeps their deleted
paths and stands still, and one whose mesh is swapped in place under a running graph freezes the same way. The model
and its `retargetFrom` clips arrive as separate builds in either order: key the player on both the mesh path and the
clip path so it respawns when either changes.
