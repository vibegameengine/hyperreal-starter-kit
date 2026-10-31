# AI motion capture from video and text-to-motion: what exists, what it gives, how it fits the kit

Research date: 2026-10-28. Read-only: nothing was installed, downloaded or run. Facts come from the papers, project
pages, repositories (README, LICENSE, model cards) and vendor pages linked in each section; anything those pages do
not say is marked "not verified". UE facts were read in `C:\GameEngien\UE_5.8\Engine`, kit facts in this repository.

The machine this was judged against: NVIDIA GeForce RTX 4080 SUPER, 16 GB VRAM (`nvidia-smi`), 32 GB RAM.

## The main question: can game-quality animation be made locally?

Yes, on both paths, with the limits below. In both cases the network gives a raw body clip; the steps that make it a
game clip (conversion to FBX on a skeleton the kit imports, root motion, foot plant after retarget, loops, fingers)
are not done by any of the open models and have to be built around them.

**From video (markerless mocap), locally on this GPU:**

- **GEM-X (NVIDIA, 2026)** is the best tool whose code, weights and body model all allow shipping the result:
  world-grounded body motion from a moving-camera video, 77-joint SOMA skeleton with per-frame rotations and root
  translation, separate hand model, optional contact/IK post-processing. Its own reported numbers: foot sliding
  4.22 mm, MPJPE 67.83 mm on EMDB-1, W-MPJPE 267.20 mm on EMDB-2. One person per clip. NVIDIA states no VRAM
  figure (the card lists an A100); the third-party `video2mocap` wrapper reports running it on an 8 GB RTX 3050 at
  about 5 minutes per 10 s of video per person, so it should fit 16 GB (not run here). Its image-feature stage uses
  SAM 3D Body weights under the SAM License; a keypoint-only mode avoids them at a quality cost.
- **ExMR (2026-10, built on GVHMR)** has the most complete pipeline today: SMPL-X body with refined hands and feet,
  gravity-aligned world frame, ground snap, BVH and FBX (through Blender) out, about 8 GB VRAM, a 37 s clip in
  1:01-2:59 on an RTX 4090. It fits this GPU. Its licence is research/non-profit only and it depends on SMPL-X
  (non-commercial), so a shipped game cannot use its output without commercial licences for both.
- **MetaHuman Animator Markerless Motion Capture (Epic, UE 5.8, Fab plugin)** solves body or body + face from one
  camera locally, inside Unreal, and writes a standard animation sequence on the MetaHuman skeleton. Experimental in
  5.8, Windows only, and it needs the editor (Live Link Hub, Capture Manager), which this kit does not use as a
  product. Whether the result may ship in a game is not answered by Epic (forum question open as of 2026-10-12).

What is still missing on this path for game-ready clips: one person per clip, no finger detail from GEM-X without
the gated hand model, no face from the open tools, fast motion and occlusion degrade every method, and the foot plant
the model produces is lost again in retargeting (see "What the conversion loses").

**From text, locally on this GPU:**

- **Kimodo (NVIDIA, v1.2 of 2026-10-15)** is the only open text-to-motion model trained on studio mocap (Bones
  Rigplay, about 700 h) with a commercial weight licence. Root translation plus joint rotations at 30 fps, foot
  contact labels, BVH export, keyframe / root path / hand-and-foot constraints, a multi-prompt timeline. It needs
  about 17 GB VRAM with the text encoder on the GPU, which does not fit 16 GB; with `TEXT_ENCODER_DEVICE=cpu` it
  needs under 3 GB and fits. Hard limits stated by NVIDIA: at most 10 s per prompt, foot skating without its
  post-process, prompts not always followed, weak outside locomotion / gestures / combat / dance / everyday actions,
  no awareness of objects (a chair is not seen), body only: the model animates 30 joints and the 77-joint export
  fills the fingers with one fixed relaxed pose (`kimodo/skeleton/definitions.py`, `to_SOMASkeleton77`).
- **HY-Motion 1.0 (Tencent)** has the best published prompt following, but needs 24-26 GB VRAM (does not fit this
  GPU), has no hands, no loops or in-place clips, and its licence does not apply in the EU, UK and South Korea.

What is still missing on this path: clips longer than 10 s are stitched from prompts with a transition inside each
prompt's time; no sitting on a real chair unless the pelvis is pinned with a keyframe; no fingers or face; loops and
in-place locomotion are not produced by any open model and have to be made after generation.

**What the people on X are building.** Almost every "animation generator" shown in 2026 is a chain of the same few
open models, not a new network. AssetFurnace (assetfurnace.com, `Bingeljell/image-to-3dlab`, Apache-2.0) is
Qwen-Image to Pixal3D / TRELLIS.2 / Hunyuan3D to a SkinTokens rig to Kimodo motion; prompt2rig is a cloud video
model to GVHMR to a Mixamo rig; video2mocap is GEM-X to foot-locked BVH/FBX to Unreal. On the text side the open
engine underneath is Kimodo (commercial weights) or HY-Motion (territory-limited); on the video side GEM-X
(commercial) or GVHMR (research only). Section 6 lists the whole field found.

"NVIDIA Bricks" was taken to be **MotionBricks** (NVIDIA, SIGGRAPH 2026): it is the NVIDIA motion-generation work
with "Bricks" in its name, and it belongs to the same SOMA family as Kimodo and GEM-X. It is not a text or video
tool; it is a real-time generator driven by velocity, heading, style and keyframes (section 3).

## 1. Licences that decide most options

- **SMPL / SMPL-X / MANO** (the body models almost every academic method outputs): non-commercial research,
  education or artistic use only; "production of other artefacts for commercial purposes" is excluded
  ([SMPL](https://smpl.is.tue.mpg.de/modellicense.html), [SMPL-X](https://smpl-x.is.tue.mpg.de/modellicense.html),
  [MANO](https://mano.is.tue.mpg.de/license.html)). After Epic's acquisition of Meshcapade (announced 2026-02-18),
  Max Planck Innovation licenses SMPL commercially ([MPG](https://www.mpg.de/26082348/max-planck-spin-off-draws-epic-games-to-tubingen));
  price not verified.
- **AMASS** (the source of HumanML3D, KIT-ML, BABEL): forbids using the data "to train methods/algorithms/neural
  networks/etc. for commercial use" ([AMASS](https://amass.is.tue.mpg.de/license.html)). Every model trained on it
  (MoMask, T2M-GPT, MDM, MotionLCM, MotionGPT, DART, CLoSD, OmniControl, MaskControl, MotionStreamer, ...) is a
  research reference, whatever its code licence says. Whether a game may ship clips such a model generated is not
  stated anywhere primary: treat it as no.
- **SOMA** (NVIDIA's unified body model, 77 joints): Apache-2.0, "ready for commercial use"
  ([model card](https://nvlabs.github.io/SOMA-X/stable/model_card.html)).
- **NVIDIA Open Model License** (Kimodo SOMA/G1 weights, GEM-X weights, MotionBricks weights): commercial use
  allowed, "NVIDIA claims no ownership rights in outputs"
  ([licence](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/)).

Consequence: the NVIDIA SOMA family (GEM-X, Kimodo SOMA, MotionBricks) is the only open set whose code, weights,
training data and body model all allow a shipped game to use the output.

## 2. Motion capture from an ordinary video

### Ranked short list

1. **GEM-X (NVIDIA).** Verdict: the open choice for a shipped game. World-grounded, moving camera, body + hands,
   everything Apache / Open Model. Gaps: `.pt` output only (no BVH/FBX; a SOMA-to-FBX step is ours to write), one
   person, VRAM on a 16 GB card not stated, hand weights gated (EgoHand), rendering documented for Linux.
2. **ExMR.** Verdict: best quality features and fits this GPU, but research-only (code and SMPL-X). Usable to
   prototype and to judge what video mocap gives, not for shipped clips without licences.
3. **MetaHuman Animator Markerless (UE 5.8).** Verdict: closest to Unreal, body + face, local and free, but
   experimental, editor-bound, MetaHuman skeleton, and shipping rights unanswered.
4. **GVHMR.** Verdict: the proven world-grounded baseline ExMR builds on; non-commercial plus SMPL.
5. **SAM 3D Body + MHR (Meta).** Verdict: licences allow commercial use and MHR has FBX rigs, but it is per image:
   no temporal model, no world trajectory, no foot contact (a video wrapper, SAM-Body4D, exists; not verified).
6. **Paid services (Move One, DeepMotion, Plask, QuickMagic, Rokoko Vision).** Verdict: FBX/BVH out with no setup,
   cloud only, commercial rights tied to paid plans (confirmed for DeepMotion only).
7. **WHAM, TRAM, PromptHMR, GENMO/GEM, SMPLest-X, Multi-HMR, 4D-Humans, CoMotion.** Verdict: superseded or
   non-commercial; WHAM unmaintained since 2024-04.

### Facts

| Tool | Output | Hands / face | Root, feet | Limits | Hardware | Licence (code / weights / body model) | Code state |
|---|---|---|---|---|---|---|---|
| [GEM-X](https://github.com/NVlabs/GEM-X) ([card](https://huggingface.co/nvidia/GEM-X)) | SOMA 77 joints, axis-angle rotations, world root rotation + translation (m), `.pt` | hands via separate gated EgoHand model; face not mentioned | world-grounded, moving camera; optional contact/IK post-process; foot sliding 4.22 mm (README) | one person per clip; needs person box (detector bundled); clip length not stated | tested on A100 80 GB; VRAM not stated; rendering Linux x86 | Apache-2.0 (a few OpenMDW files) / NVIDIA Open Model / SOMA Apache-2.0 | news 2026-10-21 (hand pose); no tagged release |
| [ExMR](https://github.com/twehrbein/ExMR) | SMPL-X params, AMASS npz, BVH, FBX through Blender | hands (HandMR), feet (FootMR); no face | gravity-aligned world frame; `--snap_to_ground` (flat floor); static-camera mode best | online demo 20 s; local no stated cap | ~8 GB VRAM; 37 s clip 1:01 / 1:17 / 2:59 on RTX 4090; tested on Linux | research / non-profit only; YOLO AGPL-3.0; SAM licence; SMPL-X non-commercial | v0.1.4, 2026-10-26; demo code only |
| [GVHMR](https://github.com/zju3dv/GVHMR) | SMPL, world-grounded | body only | gravity-view frame; static-camera flag | single person | single RTX GPU (not quantified) | non-commercial ZJU licence / SMPL | commits 2026-09; 35 open issues |
| [MetaHuman Markerless](https://dev.epicgames.com/documentation/metahuman/metahuman-animation-from-mono-video-capture-in-unreal-engine) | UE animation sequence, MetaHuman skeleton | body or body + face | not stated | experimental in UE 5.8; 29.97/30 fps footage failures reported on the forum | Windows only; GPU spec on a separate page (trade press: ~RTX 3070 8 GB) | free plugin; bundles SMPL-X data; shipping rights unanswered | Fab, UE 5.8 |
| [SAM 3D Body](https://github.com/facebookresearch/sam-3d-body) + [MHR](https://github.com/facebookresearch/MHR) | MHR rig mesh per image; MHR to SMPL/SMPL-X converter; FBX rigs | body, hands, feet | none (single image) | no temporal model | not stated | SAM licence (commercial not forbidden) / gated weights / MHR Apache-2.0 | released 2025-11-19 |
| [WHAM](https://github.com/yohanshin/WHAM) | SMPL, world via SLAM | body | world-grounded | | | MIT / SMPL | last commit 2024-04 |
| [TRAM](https://github.com/yufu-wang/tram) | SMPL, world via DROID-SLAM | body | world-grounded | | | MIT / SMPL | last commit 2025-06 |
| [PromptHMR](https://github.com/yufu-wang/PromptHMR) | SMPL-X, world video mode | body + hands | world | | | Meshcapade non-commercial | |
| [Move One](https://docs.move.ai/knowledge/move-one-pricing) | FBX, USD, .blend | not verified | not verified | 30 s free, 60 s paid per clip | cloud | paid plans $18-490/mo; rights per plan not verified | service |
| [DeepMotion Animate 3D](https://www.deepmotion.com/pricing-animate3d) | FBX, BVH, GLB | hands, face (+0.5 credit/s each) | not verified | multi-person supported | cloud | free tier non-commercial; licensed animation on paid plans | service |
| [Plask](https://plask.ai/pricing) | FBX, GLB, BVH | hands | not verified | multi-person | cloud | $18 / $50 per month; rights not stated | service |
| [Rokoko Vision](https://www.rokoko.com/products/vision) | FBX, BVH; Mixamo / UE5 Manny skeletons | no fingers | not verified | monocular upload only | cloud | free 30 s/month, paid from $10/mo; rights not verified | service |

RADiCAL is discontinued (its domain redirects to Autodesk Flow Studio). Cascadeur's video mocap gives single poses
per chosen frame, not a clip.

## 3. Animation from text

### Ranked short list

1. **Kimodo SOMA-RP v1.2 (NVIDIA).** Verdict: the one to use. Commercial weights, studio mocap data, BVH with root
   motion, foot-contact labels and a skate-cleanup post-process, constraints for keyframes, root path and hands/feet,
   runs on this GPU with the text encoder on the CPU. Limits: 10 s per prompt, body only, no objects.
2. **HY-Motion 1.0 (Tencent).** Verdict: best measured prompt following, but does not fit 16 GB, no hands, licence
   void in the EU/UK/South Korea, outputs may not train other models.
3. **Uthana (API).** Verdict: closed model, FBX/GLB/BVH with a UE5 preset, $0.02-0.10 per generated second,
   commercial use included in paid usage.
4. **DeepMotion SayMotion.** Verdict: FBX/GLB/BVH plus extend and blend; price and rights not verified.
5. **MotionMillion 3B/7B.** Verdict: Apache code and weights, but dataset licence not verified and it scored below
   HY-Motion in HY-Motion's evaluation.
6. **Rokoko Create.** Verdict: free, commercial use allowed, idles and simple locomotion only.
7. **DART, MoMask, MotionLCM-V2, MaskControl, MotionStreamer, MDM, T2M-GPT, MotionGPT/3, CLoSD.** Verdict: research
   references (AMASS / SMPL); most output joint positions only and need IK to become rotations.

### Facts

| Tool | Output | Hands / face | Root, feet | Length, composition | Hardware | Licence (code / weights / data) | Code state |
|---|---|---|---|---|---|---|---|
| [Kimodo](https://github.com/nv-tlabs/kimodo) ([card](https://huggingface.co/nvidia/Kimodo-SOMA-RP-v1.2), [formats](https://research.nvidia.com/labs/sil/projects/kimodo/docs/user_guide/output_formats.html), [limits](https://research.nvidia.com/labs/sil/projects/kimodo/docs/key_concepts/limitations.html)) | 30-joint SOMA rotations + root at 30 fps; NPZ (positions, local/global rotations, `foot_contacts` heel/toe, root) and BVH in 77-joint SOMA, cm, optional standard T-pose | body only; fingers held in one relaxed pose | root motion; foot skating without post-process; post-process enforces contacts | max 10 s per prompt; multi-prompt sequence with transitions; < 20 constrained frames per type | ~17 GB VRAM all on GPU; < 3 GB with text encoder on CPU; tested RTX 3090/4090/5090; Linux, Windows (Docker suggested) | Apache-2.0 / NVIDIA Open Model (SMPL-X variant is R&D non-commercial) / Bones Rigplay or BONES-SEED | v1.2 2026-10-15; 10 open issues |
| [HY-Motion 1.0](https://github.com/Tencent-Hunyuan/HY-Motion-1.0) | SMPL-H 22 joints, root + 6D rotations, 30 fps; FBX if FBX SDK present | no hands | RL stage penalises foot sliding and root drift | default 100 frames; LLM prompter estimates duration; no loops / in-place | 26 GB (1.0B), 24 GB (Lite) without the prompter | Tencent community licence, not valid in EU/UK/KR, > 1M MAU needs licence; SMPL-H files need not verified | released 2025-12-30; news 2026-01-29 |
| [MotionBricks](https://github.com/NVlabs/motionbricks) ([page](https://nvlabs.github.io/motionbricks/), arXiv 2604.24833) | real-time generation on SOMA or Unitree G1 from context and target poses; output format not documented | not stated | "no foot-locking, no blending" in the UE5 demo; driven by velocity, heading, style, keyframes; no text input | real time, 15,000 FPS / 2 ms claimed (hardware not stated) | TensorRT, NVIDIA GPU; tested on RTX 4090, Windows and Linux; ONNX bundled | Apache-2.0 / NVIDIA Open Model Agreement / sample motions evaluation-only | 2 commits, no release tag |
| [MotionMillion](https://github.com/VankouF/MotionMillion-Codes) | 272-dim features (not verified) | not verified | not verified | not verified | not verified | Apache-2.0 code and weights / dataset licence not verified | weights 2025-07 |
| [DART](https://github.com/zkf1997/DART) | SMPL-X params | body | autoregressive, waypoint control | minutes-long rollouts, > 300 fps on RTX 4090 | single RTX | Apache-2.0 / AMASS-BABEL / SMPL-X | ICLR 2025 |
| [MoMask](https://github.com/EricGuo5513/momask-codes) | 22 joint positions, 20 fps; BVH via "naive foot ik" | body | positions only | max 196 frames (~9.8 s) | CPU WebUI possible | MIT / HumanML3D (AMASS) | news 2024-08 |
| [Uthana](https://uthana.com/pricing) | FBX, GLB, BVH, UE5 preset | not verified | not verified | not verified | cloud | pay per second; paid usage includes commercial use | service |
| [Rokoko Create](https://www.rokoko.com/products/studio/rokoko-create) | not verified | not verified | not verified | idles, simple locomotion | cloud | free; commercial use under Terms | service |

The kit's own example prompt, "a tired soldier limps forward and sits down": Kimodo and HY-Motion both handle the two
actions as a sequence of prompts; neither knows the chair, so the sit lands where the model puts it unless a Kimodo
keyframe or root path pins the pelvis at seat height and position.

## 4. How it fits the kit

### The kit's path today

A clip reaches the game as an FBX next to the model it was made for, imported with
`clip.fbx?skeleton=../model.fbx` and optionally `&retarget=manny` or `&retarget=../other-model.fbx`
(`agents/skills/mixamo-characters/SKILL.md`, `vge/content/characters.mjs`). The content service imports the clip onto
the model's skeleton and runs `VgeRetargeter` (`unreal/Source/VibeGameEngineTools/Private/VgeRetargeter.cpp`), which
auto-generates an IK Rig for each mesh and an IK Retargeter the way the editor's auto retarget does. The dev server
accepts `.glb`, `.gltf`, `.fbx` for models (`vge/vite/contentAssetsPlugin.mjs`); there is no BVH importer in the
kit and none in UE 5.8's Interchange plugins. UE 5.8 does ship one in the experimental AnimDatabase plugin:
`UAnimDatabaseFunction_ImportBVH` ("Import from BVH Function",
`Engine/Plugins/Experimental/Animation/AnimDatabase/Source/AnimDatabase/Public/AnimDatabase.h:1124`), editor-only
(`WITH_EDITOR`), which writes AnimSequences from a folder of BVH files, can remove the root axis-change rotation and
skips files with a `_mirrored` suffix, the naming BONES-SEED uses for its mirrored clips. The content service runs
editor code, so this is a second route to the Blender conversion; it has not been tried.

The IK Rig's retarget chains come from `FAutoCharacterizer`
(`Engine/Plugins/Animation/IKRig/Source/IKRigEditor/Private/RigEditor/IKRigAutoCharacterizer.cpp`). It picks the
known skeleton template whose bone names and parents match best (UE4, UE5, Mixamo, Meshcapade, Move One, Rokoko,
Rigify and others) and needs more than 10 % of the template matched; there is no fallback yet for an unknown
skeleton (`// TODO` after the template check). Raw SMPL/SMPL-X joint names (`Pelvis`, `L_Hip`, ...) are not in any
template; the "Meshcapade" template is SMPL's skeleton under UE-style names (`pelvis`, `thigh_l`, `calf_l`, ...).

SOMA's joint names (`kimodo/skeleton/definitions.py`) are Mixamo-like but not Mixamo: `Hips`, `Spine1`, `Spine2`,
`Chest`, `Neck1`, `Neck2`, `Head`, `LeftShoulder`, `LeftArm`, `LeftForeArm`, `LeftHand`, fingers `LeftHandIndex1..4`,
and legs `LeftLeg` (the thigh), `LeftShin`, `LeftFoot`, `LeftToeBase`. Read against the code above, the Mixamo
template would win on name count, and two of its chains would not map as on a Mixamo body: `Neck` has no bone of
that name, and `LeftLeg` means the calf in Mixamo but the thigh in SOMA. This is a reading of the code, not a run;
the conversion step below removes the question by renaming the bones before import.

### Which tools can go through it

| Tool | Gets to an FBX the kit imports by | Notes |
|---|---|---|
| Kimodo (SOMA) | BVH (cm, `--bvh_standard_tpose`) into Blender, export FBX | SOMA body mesh and skeleton are Apache-2.0, so a SOMA "model" FBX with skin can live in the repo and each clip imports with `?skeleton=../soma.fbx&retarget=manny` or `&retarget=../<character>.fbx` |
| GEM-X (SOMA) | `.pt` rotations to BVH or straight to an FBX writer (our code; Kimodo's BVH exporter writes the same 77-joint skeleton) | same SOMA model as Kimodo, so both feed one import line |
| ExMR / GVHMR / HY-Motion / DART (SMPL family) | ExMR writes BVH and FBX through Blender; the others need an SMPL to FBX step | SMPL licence applies to the output; prototyping only |
| Paid services | FBX on Mixamo or UE5 Manny skeletons (Rokoko, QuickMagic, Uthana presets) | drop-in: `?skeleton=` onto the matching model, or straight onto Manny |
| MetaHuman Markerless | animation sequence inside an editor project | not an FBX in our pipeline; it would have to be exported from the editor |

### What the conversion loses

- **Foot plant after retarget.** `VgeRetargeter` disables the IK Rig op (`FIKRetargetRunIKRigOp ... SetEnabled(false)`)
  and maps chains with FK; pelvis translation follows the target's proportions. A clip whose feet were planted on
  the SOMA body (Kimodo post-process, GEM-X contact/IK) can slide again on a body with other leg lengths. Kimodo's
  `foot_contacts` and GEM-X's contact output are exactly the data a foot-lock pass needs, but nothing in the kit
  reads them today.
- **Fingers.** Kimodo's fingers are one fixed pose; GEM-X's need the gated hand model. Mixamo and Manny have finger
  chains, so they will hold whatever the source gives, which for Kimodo is a static relaxed hand.
- **Face, jaw, eyes.** SOMA has `Jaw`, `LeftEye`, `RightEye`; no tool here animates them, and Mixamo has no such bones.
- **Spine and neck count.** SOMA has three spine bones and two neck bones; Mixamo has three and one, Manny five and
  two. The FK chain op spreads rotation over the chain, so the curve of the back is approximated, not copied.
- **Root.** SOMA's root is `Hips`. The kit's export script adds a `root` bone above `Hips`
  (`export-mixamo-rig.py`); with it, `VgeRetargeter` generates root motion from the target pelvis and snaps height to
  the ground. Without it, a Manny clip's root lock freezes the pelvis (the defect described in the skill).
- **Rest pose.** Kimodo's BVH rest pose is the BONES-SEED one by default; `--bvh_standard_tpose` gives a T-pose,
  which `AutoAlignAllBones` in the retargeter expects to align against.

## 5. Recommended pipeline for the kit

One body model for both jobs: SOMA, because it is the only skeleton whose generators (Kimodo for text, GEM-X for
video) and body model are all licensed for a shipped game.

1. **A SOMA character file in the kit.** The SOMA body mesh (its own SOMA-shape identity backend, not the SMPL or
   SMPL-X backends, which carry their own licences) skinned to the 77-joint skeleton, bones renamed to one
   UE template the characterizer knows (Mixamo names, or the UE5 mannequin names), a `root` bone above the pelvis,
   exported in centimetres through `agents/skills/mixamo-characters/scripts/export-mixamo-rig.py` and checked with
   its `--check`. Whether that script accepts a SOMA rig unchanged is not verified.
2. **A converter from SOMA motion to an FBX clip on that file**, run by the dev tooling: reads Kimodo NPZ/BVH or
   GEM-X `.pt`, renames joints the same way, writes an animation-only FBX (Blender headless, as the kit already runs
   Blender for rigs). It also carries `foot_contacts` forward (as curves or a side file) for step 4. Existing open
   code to read before writing it: Kimodo's own BVH exporter (`kimodo_convert`, `--bvh_standard_tpose`);
   AssetFurnace's `scripts/kimodo_retarget.py` (Apache-2.0), which plays Kimodo's SOMA motion on an arbitrary
   humanoid rig by finding bones by tree shape, applying each SOMA joint's world-space turn from the T-pose to the
   bone's rest orientation and scaling hip travel by the hip-height ratio, with no foot IK; video2mocap (Apache-2.0),
   which goes GEM-X to foot-locked BVH to FBX through Blender and ships Unreal Editor Python retarget helpers.
3. **Import through the existing line:** `clip.fbx?skeleton=../soma.fbx&retarget=manny` or
   `&retarget=../<character>.fbx`. No change to the content service or the retargeter is needed for this part.
4. **Foot plant on the target body.** Either enable an IK pass in the retargeter for clips that carry contacts, or a
   foot-lock pass on the retargeted clip driven by the source contacts. This is the part that decides whether the
   result reads as game animation or slides.
5. **Generation:** Kimodo locally with `TEXT_ENCODER_DEVICE=cpu` on the RTX 4080 SUPER, post-process on, prompts
   starting "A person ...", one or two behaviours per prompt, root path or keyframes for anything that must land in
   a place (a chair, a door). **Capture:** GEM-X locally; if it does not fit 16 GB, that is the first thing to find
   out when the user asks for a run.
6. **After generation:** loops and in-place locomotion are made from the clip (trim to matching poses, remove root
   translation); no open model outputs them.

ExMR is the tool to compare GEM-X against on the same videos, as a research reference only. MotionBricks is not a
clip source; it is a candidate for runtime locomotion (ONNX weights, and UE 5.8 ships `NNERuntimeORT` in
`Engine/Plugins/NNE`), which is a separate question from this pipeline.

## 6. The wider field: everything else found (second pass)

The first pass covered the strongest models. This pass swept the products, the newer open models and the community
chains people show on X. Sources are the products' own pages and repositories; "not verified" where they were not
reachable or did not say.

### 6.1 Commercial generators (cloud)

| Product | Does | Output, skeleton | Rights to output | Notes |
|---|---|---|---|---|
| [Cartwheel](https://getcartwheel.com) | text to motion; video to motion for 1-4 performers with face; pose/path editor; auto-rig | BVH via API/MCP; rigged characters FBX/GLB; retarget to your uploaded characters | ToS 3.1: "internal business purposes and lawful commercial use"; no explicit ownership clause | official UE plugin for UE 5.6, Windows ([plugins](https://getcartwheel.com/plugins)); API + 32-tool MCP; 1 credit/s |
| [Viggle PINOC](https://viggle.ai/pinoc) | text to 3D motion (up to 4 takes), video to motion | FBX or GLB on a 65-bone Mixamo-named skeleton | "Paid users own their inputs and outputs"; free tier non-commercial | $12.99/mo for 300 s, $39.99/mo for 1,200 s; mocap API returns FBX |
| [Motorica](https://motorica.com) | locomotion and style synthesis from licensed mocap; motion-matching datasets | formats not stated | governed by order/MSA | UE, Unity, Maya, MoBu, Blender plugins; free motion-matching dataset 2026-01-19 |
| [Meshy](https://docs.meshy.ai/en/webapp/guides/animate) | text to motion for humanoids, 600+ presets, auto-rig | FBX, GLB, USDZ; Mixamo default skeleton | not verified | |
| [Sloyd](https://sloyd.ai/animations) | text and video to animation, auto-rig | GLB, FBX, USD, BLEND | not verified | |
| [Avatar SDK Move](https://avatarsdk.com/mixamo-alternative/) | text to animation, 5-10 s with root motion | FBX/GLB, Humanoid rig | not verified | about $1 per 5 s clip; beta 2026-07 |
| [Reallusion Video Mocap](https://www.reallusion.com/iclone/video-mocap) | video to motion with fingers (QuickMagic inside) | through iClone | not verified | 60 s per task, $0.05/s, needs iClone |
| [Text2Motion.ai](https://github.com/text2motion/blender-integration) | text to motion API | Mixamo-named rig, GLB | generated clips CC-BY-4.0 | early preview |
| Autodesk MotionMaker | path/keyframe-driven motion | inside Maya 2026.1+ | Maya licence | Maya only |

Uthana, DeepMotion SayMotion, Rokoko Create, Move One, Plask and QuickMagic are in sections 2 and 3. Pivoted, closed
or not motion generators: Tripo (auto-rig plus preset clips only), Mootion and Kinetix (moved to video), Ready Player
Me (shut down 2026-01-31 after Netflix's acquisition), Meshcapade (Epic), RADiCAL (Autodesk), Rodin, Roblox 4D,
ByteDance/Alibaba/Kuaishou (2D video only). Genaimo and Motifect could not be verified on their own sites.

### 6.2 Open models released 2025-2026 not in the first pass

None of these has commercially usable weights: each is non-commercial, unlicensed, trained on AMASS/HumanML3D,
LAFAN1 or AIST++, or needs SMPL. ARDY is the exception on licence, but it is a real-time research model.

| Model | Task | What stands out | Licence |
|---|---|---|---|
| [UniMate](https://github.com/Friedrich-M/UniMate) (SIGGRAPH Asia 2026) | text to motion, in-betweening, editing, expansion on any rig | takes any rigged GLB/glTF/FBX incl. Mixamo, writes animated GLB + FBX; 60-frame clips | MIT code, CC BY-NC 4.0 weights |
| [MoLingo](https://github.com/hynann/MoLingo) (CVPR 2026) | text to motion | rotations directly (no IK), 30 fps, `text#seconds`; runs on one RTX 3090 | Apache code, HumanML3D data |
| [ViMoGen](https://github.com/MotrixLab/ViMoGen) (ICLR 2026) | text to motion | 1.3B DiT initialised from the Wan2.1 video model, trained with generated video | no licence |
| [MotionLab](https://github.com/Diouo/MotionLab) (ICCV 2025) | text, trajectory, in-between, style, editing | one model for all tasks, SMPL | no licence |
| [Human3R](https://github.com/fanegg/Human3R) (ICLR 2026) | video to 4D humans + scene, online | SMPL-X family | CC-BY-NC-SA weights |
| [JOSH3R](https://github.com/genforce/JOSH) (ICLR 2026) | video to human + scene | long videos in chunks; tested on 24 GB | no licence |
| [GestureLSM](https://github.com/andypinxinliu/GestureLSM), [SemTalk](https://huggingface.co/X-Zhang/SemTalk), [EchoMask](https://huggingface.co/X-Zhang/EchoMask), [GlobalDiff](https://huggingface.co/X-Zhang/GlobalDiff) | speech to body + hands gesture | SMPL-X, BEAT2 data (licence status unresolved) | research |
| [FlowerDance](https://github.com/XulongT/FlowerDance), [DuetGen](https://github.com/snap-research/duet-gen) | music to dance (solo, duet) | AIST++/FineDance; DD100 | no licence / Snap non-commercial |
| [MotionReFit](https://github.com/emptybulebox1/motionRefit), [AnyMoLe](https://github.com/kwanyun/AnyMoLe) | text editing of motion; any-character in-betweening | AnyMoLe tested on a 48 GB A6000 | research |
| [ARDY](https://github.com/nv-tlabs/ardy) (NVIDIA, 2026-07) | real-time autoregressive text to motion | 27-joint skeleton, 20 fps, max 8 s, Linux, tensors only | NVIDIA Open Model (commercial) |

Announced without code or weights: Motion-R1, Being-M0.5, OmniMotion, HumanMM, Motion Anything, AtomicDance weights,
SILK. HY-Motion has nothing newer than 1.0 / 1.0-Lite.

### 6.3 Community chains and tools

| Tool | Chain | Licence, state | Use for the kit |
|---|---|---|---|
| [AssetFurnace](https://github.com/Bingeljell/image-to-3dlab) | text/image to mesh to SkinTokens rig to Kimodo motion, GLB out; MCP server | Apache-2.0, pushed 2026-10-28; NVIDIA 24 GB tested | its `scripts/kimodo_retarget.py` is reference code for the SOMA conversion |
| [video2mocap](https://github.com/freddysae0/video2mocap) | video to GEM-X to smoothing, contacts, foot-lock IK to BVH/FBX; UE Python retarget helpers | Apache-2.0, v0.2; static camera only, fingers not yet | the licence-clean video route to copy or use |
| [prompt2rig](https://github.com/blendi-remade/prompt2rig) | prompt to cloud video model to GVHMR (+ WiLoR fingers) to Mixamo GLB | Apache code, HQ path research-only (GVHMR, SMPL-X, MANO) | prototyping only |
| [mixamo-llm-mocap](https://github.com/squall01337/mixamo-llm-mocap) | video to GVHMR to Mixamo FK in Blender via MCP, QA for foot skate and hip pops | licence unstated; built on an RTX 4080 | prototyping only (GVHMR) |
| [Kimodo_Blender_Bridge](https://github.com/lewdineer/Kimodo_Blender_Bridge) | Kimodo inside Blender, retarget to any armature | no licence file (store says GPL); 8 GB+ VRAM | a Blender route to Mixamo FBX |
| [ComfyUI-HyMotion](https://github.com/Aero-Ex/ComfyUI-HyMotion), [ComfyUI-HY-Motion1](https://github.com/jtydhr88/ComfyUI-HY-Motion1) | HY-Motion to FBX on Mixamo / UE5 with in-place option | HY-Motion licence (EU/UK/KR excluded) | only for a game never sold there |
| [Kimodo Importer](https://help.zenblink.com/kimporter) (Fab) | Kimodo SOMA BVH into UE with a ready SOMA-to-Manny IK retargeter | paid plugin; needs a T-pose first frame; "finger motion may be limited" | editor plugin, not our runtime path |
| [VRM4U](https://github.com/ruyo/VRM4U) | BVH import with auto IK Rig/Retargeter for the mannequin | MIT; UE 5.8 support since 2026-06-22 | reference for BVH import in UE |

Text to video to mocap: open video models that fit 16 GB are Wan2.2 TI2V-5B (Apache, outputs unclaimed) and
HunyuanVideo 1.5 (14 GB with offload, Tencent territory clause). Kling's user policy (4.6) bars commercial use of
outputs without written permission; Veo, Sora and Runway leave outputs to the user. The mocap step afterwards is the
same as for real video, so the quality ceiling is GEM-X's, plus whatever physics the video model got wrong.

### 6.4 What this changes in the verdicts

Nothing in the ranking at the top: the commercially clean local stack is still Kimodo for text and GEM-X for video,
and the wider field confirms that the community tools are built on exactly these two (or on research-only GVHMR and
HY-Motion). What it adds: open reference code for the conversion step (AssetFurnace, video2mocap), a UE 5.8 BVH
importer on disk, and two cloud products that write Mixamo-named FBX directly (Viggle PINOC, Meshy) for clips that
do not need to be made locally.
