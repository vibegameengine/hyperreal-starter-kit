# Agent skills

`agents/skills/` is the single source of skills for every agent tool. `.claude/skills`
and `.codex/skills` are directory links to this folder (`agents/link-agent-skills.ts`),
so a skill added here is visible everywhere at once.

The skills come from the web starter kit (three.js / React / Vite). Each one is in
exactly one of three states.

## Ported to this kit

Same name and the same rules as in the web kit; the implementation parts are
rewritten for Unreal 5.8 runtime + TypeScript (`src`), the React UI
(`src/ui`: a game's HUD and the dev shell's page), the Vite dev server, `tools/game.mjs`, `tools/ui.mjs` and the content
pipeline (models imported by the game code, `vge/content`). Where the kit does not yet have a piece
the web skill relied on, the skill says so instead of inventing it.

| Skill | What it maps onto here |
|---|---|
| `dev-lab-authoring` | the lab contract in `src/shared/lib/devLab.ts`, the list of labs `LABS` in `src/app/labs.ts` (read by `src/app/scenes.ts`), the shared stage `src/scenes/lab-stage`, `npm run play -- --lab <id>`, the shell's lab index (`/labs`, `LabCard`s from `src/ui/app/labs/labRegistry.ts`), its captured previews (`npm run labs:previews`, imported in `src/ui/app/labs/previews.ts`) |
| `mixamo-characters` | a character of your own from model and clip files: import lines with `?skeleton=`, `&retarget=`, `?retargetFrom=` (`vge/content/characters.mjs`), the content service's auto-generated IK Rigs and retargeter (`VgeRetargeter.cpp`), `ImportedCharacter`, `<Player look>`, the `mixamo-character`, `mixamo-to-manny` and `custom-player` labs, and what makes imported characters fall apart |
| `rigforge-locomotion` | the character's walk/jog sets from video: RigForge (SpriteForge) Gather and MotionBricks, Mixamo FBX in `src/features/character/assets/mixamo/motion`, import lines with `&retarget=manny`, the motion-matching databases in `mannyMotion.ts` and the `motion-matching` lab |
| `secondary-motion-physics` | breast, butt, hair, jewellery and gear on extra bones: `<animDynamics>` (`VgeAnimInstance.cpp`), `src/features/character/soft-tissue`, `danglers`, `secondary-motion/useInertialDrive.ts`, the `soft-tissue` lab and `vge/tools/soft-tissue-telemetry.mjs`; engine traps measured and worked around |
| `fsd-ecs-architecture` | the FSD layout of `src`, entities as spawn functions, scope ownership in `src/shared/engine/world.ts` |
| `asset-optimization-pipeline` | `import x from '*.glb'` → decode → import (Nanite) → DLC cook → pak/IoStore → `MountContent` → `onAsset`/`onMesh` |
| `ui-kit-architecture` | the UI kit `src/ui/features/ui-kit` (primitives, `preview.tsx`, the `/ui-kit` gallery), the HUD's `bridge.ts` and the `data-hit` input contract |
| `patch9-ui` | the 9-slice technique and its contract; `Patch9Button` / `Patch9Surface` in the UI kit |
| `mobile-ui-scaling` | the one-scaler rule mapped to game window resolutions; Win64 only, no scaler on the HUD yet |
| `blender-web-pipeline` | Blender glTF export into the owning feature's `assets/`; web budgets marked as not applying |
| `visual-verification-gate` | captures of the rendered game window; never a `-nullrhi` process |
| `world-debug-seam` | `node vge/tools/game.mjs` → `src/app/debug-seam.ts`; no named verbs yet |
| `task-kickoff-brief` | unchanged process, verification wording for a game window |

## Copied as is

Renderer-agnostic skills, copied byte for byte from the web kit.

Process, review and critique: `gauntlet-loop`, `grill-me`, `grilling`,
`harsh-critic`, `never-break-the-shared-tree`, `quality-refinement-autoloop`,
`clean-code`.

Gameplay and world design: `fixed-tick-gameplay`, `gameplay-space-composition`,
`session-threat-world-authoring`, `internationalization`, `audio-event-markup`,
`orbital-hud-motion`.

Blender family: `blender-animation`, `blender-cameras`, `blender-export`,
`blender-lighting`, `blender-materials`, `blender-mcp-hand-modeling`,
`blender-modeling`, `blender-pro-workflow`, `blender-rendering`,
`blender-skill-harmonizer`, `blender-uv-texturing`, `closed-surface-uv-coverage`,
`text-to-blender`.

Content and asset generation, fitting and reconstruction: `alpha-atlas-semantic-slicing`,
`animation-quality-gate`, `atlas-uv-fitting`, `codex-asset-generation`,
`contour-to-mesh`, `fit-repair-optimizer`, `humanoid-take-authoring`,
`landmark-fit-repair`, `mascot-logo-reconstruction`, `multiview-constraint-solver`,
`multiview-fit-loop`, `orthographic-registration`, `physics-manikin-fitting`,
`reference-analysis-validator`, `reference-look-calibration`, `reference-to-3d`,
`rig-socket-fitting`, `source-part-segmentation`, `spriteforge-pipeline`,
`texture-driven-mesh-fitting`, `texture-state-animation`, `tripo-asset-generation`,
`tripo-blender-fast-handoff`, `tripo-to-mixamo`, `wireframe-to-3d`.

Shared conventions (not a skill): `_conventions/`.

**Copied unchanged, so they still name web-kit paths or tools** in examples:
`fixed-tick-gameplay` (`src/shared/lib/simulation/`, React keys),
`internationalization` (React screens under `src/`, browser locale),
`tripo-to-mixamo` (`src/features/...` asset paths, three.js clip names),
`gauntlet-loop` (its three.js / WebGL lessons section),
`gameplay-space-composition` (points at the stubs `img2threejs` and
`threejs-scene-authoring`), `blender-mcp-hand-modeling`, `reference-to-3d`,
`alpha-atlas-semantic-slicing`, `spriteforge-pipeline`. Their method holds here;
read a web path in them as "the equivalent place in `src` / `src/ui`", and a
headed browser as a rendered game window (AGENTS.md rule 1). `clean-code`'s
numbers were measured on the web kit's 229 files and say so.

## To port

Web renderer versions (three.js / WebGL / WebGPU). Each folder holds only a short
`SKILL.md` stub that says it is not ported, what it covered in the web kit, and
what its Unreal equivalent would cover. Their content was deliberately not
copied and no Unreal content was invented for them.

| Skill | Unreal equivalent would cover |
|---|---|
| `threejs-scene-authoring` | hand-authored placement in `src/scenes`, step by step with window captures |
| `threejs-scene-architecture` | frame cost: mobility, cached shadows/Lumen invalidation, Nanite, per-frame script work |
| `threejs-instancing-materials` | instanced meshes, shared material instances |
| `threejs-image-pipeline` | post-process, exposure, tone mapping, scalability owned by the stage |
| `threejs-authored-vegetation` | authored foliage, wind, foliage shading, distance behaviour |
| `threejs-precipitation-surfaces` | one weather state driving particles and surface wetness |
| `threejs-procedural-architecture` | plan-first architecture made in Blender, delivered as a model the owning feature imports |
| `threejs-procedural-fields` | single-cause fields as material functions / global parameters |
| `threejs-procedural-materials` | Unreal material look development and acceptance |
| `threejs-procedural-vfx` | event-driven particle effects owned by the scene scope |
| `threejs-water-optics` | water on the engine's water shading and translucency |
| `img2threejs` | reference image → Blender/generation → the owning feature's `assets/` (use the reconstruction skills meanwhile) |
| `webgl-dropped-draw-audit` | silent material-usage and shader-library substitutions |
