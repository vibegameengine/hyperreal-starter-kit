# Multi-Agent Workflow

## Scope
- This file is the source of truth for repository-level agent routing, workflow, memory, handoff, and validation rules.
- These instructions are game-oriented, but they must not depend on one specific game, setting, mechanic, platform, or store.
- After choosing a role, stay in that role until the task is complete or the user explicitly asks to switch roles.

## Available Agent Roles
- Manager: [manager/AGENTS.md](./manager/AGENTS.md)
- Programmer: [programmer/AGENTS.md](./programmer/AGENTS.md)
- System designer: [system-design/AGENTS.md](./system-design/AGENTS.md)
- Product designer: [product-design/AGENTS.md](./product-design/AGENTS.md)
- Game designer: [game-design/AGENTS.md](./game-design/AGENTS.md)
- Narrative designer: [narrative-design/AGENTS.md](./narrative-design/AGENTS.md)
- Motion designer: [motion-design/AGENTS.md](./motion-design/AGENTS.md)
- Platform publishing: [platform-publishing/AGENTS.md](./platform-publishing/AGENTS.md)
- Optimization engineer: [optimization/AGENTS.md](./optimization/AGENTS.md)
- SMM strategist: [smm/AGENTS.md](./smm/AGENTS.md)

## Start Here
- Read [memory.md](./memory.md) before noticeable work.
- Choose the leading role for the task.
- Read the selected role's `AGENTS.md` and local `memory.md`.
- Use [WORKFLOW.md](./WORKFLOW.md) for task lifecycle, handoff, and verification flow.

## Role Selection
- Choose `manager` for routing, coordination, scope, task framing, handoff, and final readiness decisions.
- Choose `programmer` for code, architecture, runtime behavior, bugs, refactors, UI implementation, tests, and validation.
- Choose `system-design` for engineering specs, module boundaries, contracts, edge cases, data flow, and implementation handoff.
- Choose `product-design` for UX behavior, screen states, flows, interaction rules, feedback, and product-facing acceptance criteria.
- Choose `game-design` for game rules, core loop, mechanics, rewards, progression, balance, meta systems, and gameplay invariants.
- Choose `narrative-design` for story, characters, tone of voice, naming, dialogue, lore, onboarding text, and narrative framing.
- Choose `motion-design` for animation intent, timing, easing, feedback, transitions, ceremony, and reduced-motion strategy.
- Choose `platform-publishing` for release readiness, metadata, platform compliance, package requirements, submission, and store blockers.
- Choose `optimization` for frame cost, stutter, dropped frames, memory growth, draw calls, profiling, performance regressions, and any claim that something is slow. The role owns the measurement and the cause; it hands the code change to `programmer` when the fix is larger than the localization.
- Choose `smm` for social-media strategy, audience research, content systems, hooks, attention retention, media publication rules, community loops, and social performance experiments.

## Programmer Role Gate
- Before choosing `programmer` as the leading role, explicitly answer all three questions:
  1. **Is there a design?**
  2. **Is every implementation question settled?**
  3. **Has every UX and UI case been thought through, edge cases included?**
- The `programmer` role is allowed only when every answer is an evidence-backed **yes**.
- If any answer is **no**, uncertain, assumed, or unsupported, the leading role must be one of the relevant design/project roles (`manager`, `system-design`, `product-design`, `game-design`, `narrative-design`, or `motion-design`). Resolve the missing decisions in that role before switching to `programmer`.
- A user request to “implement”, “build”, or “write code” does not bypass this gate when design, realization, UX, or UI decisions are still open.

## No Silent Role Drift
- Do not silently mix roles.
- If a task becomes cross-disciplinary, name the leading role, adjacent roles, and why they are needed.
- If ownership changes, state the switch before using the new role's rules.

## Production-Ready By Default
- Do not frame work as a PoC, MVP, prototype, temporary shortcut, or placeholder unless the user explicitly asks.
- Small steps are acceptable, but each step must fit the final architecture and remain safe to evolve.
- If an asset or implementation detail is temporary, the contract and behavior must still be replaceable without rewriting the feature.

## Scene-Fidelity Invariant
- Never alter the player entity, shared camera contract, or entity scale to fit a scene to a reference.
- Scene composition uses a dedicated DEV-only authoring camera; only after that visual gate passes may the unchanged player be mounted into the scene.
- Final placement is explicit authored world coordinates and source-locked dimensions, verified in rendered game-window frames both before and after player mount.
- Never multiply scene coordinates or transforms to resize/spread a composition. Structures are local-coordinate prefabs moved manually as one unit.
- Every scene entity/prefab/character/building root scale is always `[1, 1, 1]`; dimensions belong to prefab geometry.
- Visual object acceptance is valid only after rendered front/side/back inspection in a DEV-only isolated scene (a lab opened in the dev session's shell, `npm run open -- labs/<id>`). A full-level frame never substitutes for this gate.
- Here: Unreal units are centimetres and Z is up; the shared lab stage (`src/scenes/lab-stage`) owns sun, sky, ground and camera (an orbit camera) for every lab.
- Read `README.md` in full before any work. Change the first layer that can do the job: game TypeScript, then assets and the content pipeline, then the kit's shared TypeScript and tools, and the kit's C++ last, only when shown necessary from the code and agreed with the user (README, "Which layer to change").
- A lab is for people as well as agents: it ships with a HUD that shows the subject's live state and controls every case the lab shows, and a captured preview; no on-screen instructions (skill `dev-lab-authoring`, rule 5).

## Runtime Checks
- The web kit used Playwright for browser/runtime verification instead of HTTP-only checks. Here the three instruments are:
- One dev session: `npm run dev` starts the dev server and the shell together, and the shell is where the human looks. Agents work in that shell: `npm run open -- labs/<id>` (or `-- main`) puts the scene on its screen, and the shell starts its world. Never start a game process of your own by default: `npm run play` is only for what the shell cannot be, a headless (`--headless`) numbers-only run or a release check. Closing the shell ends the session; `npm run shell` opens it again.
  - game state as numbers: `node vge/tools/game.mjs --scene labs/<id> "<expr>"` (from the kit root) in the world on that scene; without `--scene`, in every connected game process. Each answer names its scene and its HUD's DevTools port;
  - the HTML UI: `node vge/tools/ui.mjs text | click <css> | select <css> <v> | eval <js> | console` over CDP: a world's HUD on the port `npm run open` and `game.mjs` print (the shell gives world N the kit's HUD port + N - 1, `VGE_CDP=http://127.0.0.1:<port>`); the shell's page on the kit's shell port (9221 in the main kit);
  - the look: a capture of the rendered world in the shell (AGENTS.md rule 1).
- Before starting the dev session, check whether one is already running: `node vge/tools/game.mjs "1"` answers from its worlds, and `npm run dev` keeps a shell that is already open.
- Close what you opened in the shell when the task is done (`npm run open -- main` puts the human's main scene back). A `npm run play` process you started is closed with `npm run stop` (this kit's processes only), never by process name: other agents' games run under the same name.
- The main checkout is the stable kit: no development happens in it. It only receives finished, verified work merged from a profile. Every feature, research build or experiment is done in its own profile.
- Assets from Fab: find them with Fab's own search, `npm run fab -- search "<words>" [--free] [--format unreal-engine|gltf|fbx]`, show the user the chosen listing in the shell's Fab window with `npm run fab -- open <listing link>`, and let the user sign in and press Add to Project / Install Plugin there (never press buy, download or sign in for the user); `npm run fab -- installs` then says where it landed: a pack loads by path from `/Game/<Pack>/...` (`onPack`), a model file is imported by its path, a plugin rebuilt the runtime (README, "Fab: assets into the project").
- Work that changes C++ or needs its own build and tests while others keep using the main kit goes into a profile: `npm run profile -- create <name>` gives a checkout on `profile/<name>` with its own ports and runtime (README, "Profiles"). Run every command from that profile's root; the ports and the dev server are its own. It goes into the main kit by merging the branch and `npm run build:cpp` there.

## Validation
- Before final delivery after code changes, run the repository's standard validation commands when feasible (from the kit root):
  - `npm run typecheck`
  - `npm run build:cpp` — when C++ under `Source/` changed (it also regenerates `unreal/Typing/ue`)
  - `npm run test:agent-tools` — when `.claude/hooks` changed
- `npm run build` exists and is the release build (`vge/tools/build.mjs`: a Shipping game in `Build/Release` with only the imported models; it needs this kit's dev server stopped), run when the task concerns the release. The kit defines no lint, game test or knip script yet (`package.json`); the web kit's `npm run lint`, `npm run test` and `npm run knip` join this list when the kit adds them.
- If validation is blocked or red, report the exact blocker.
- Do not call a task complete while known failures from the current work remain unresolved.

## Repository Rules
- Runtime assets must live near their owning feature/component or shared primitive.
  - Here: 3D source assets (`.glb`, `.gltf`, `.fbx`) are modules. A model reaches the game only when game code imports it (`import flightCase from '../assets/flight-case.glb'`, `vge/vite/contentAssetsPlugin.mjs`); nothing is picked up from a folder, and the release build (`npm run build`) contains only imported models. The import's default export is the handle that `useContentMesh` / `onAsset` / `onMesh` (`src/shared/engine/content.ts`) take.
  - Materials are modules too: a plainly named `.tsx` beside its feature (`lava.tsx`) describes the graph in JSX and is a material because it calls `defineMaterial`/`defineInstance` from `src/shared/material` (`defineMaterial(<material ...>)`, the engine's expressions as elements, `param()`, `<custom>` HLSL; README, "A material"); game code imports its exports and passes them where a material prop goes (`overrideMaterials={[lava]}`, `instance(lava, {...})` for runtime values). Declare only the `usage` the meshes need; read the result in the game (`[material] ... needs usage`, `[content] ... error:` lines), never by comparing frames.
  - UI images stay beside the `src/ui` component that imports them.
- Do not import production assets directly from a root `assets/` staging folder. Here: never load cooked content by a hard-coded path into `unreal/Plugins/VgeLive`; subscribe with the model import's handle.
- Keep external references, experiments, and throwaway examples out of committed production paths.
- Use CSS Modules for new component UI unless the project has a stronger local convention. Here: the shell page and the UI kit (`src/ui/features`, `src/ui/app`, `src/ui/shell`) use CSS Modules; the HUD page (`src/ui/hud.tsx`) has one global `styles.css`.
- Prefer isolated features with clear public boundaries for non-trivial product behavior.

## Memory Policy
- Repository-level agent memory lives in [memory.md](./memory.md).
- Role-specific memory lives in `agents/<role>/memory.md`.
- Memory stores durable decisions, constraints, user preferences, source-of-truth changes, and cross-role conflicts.
- Do not duplicate canonical rules from `AGENTS.md` into memory.

## Geometry Invariant
- Final scene assets never ship as bare primitives. Use intentional faceted or
  compound silhouettes with readable cuts and notches.
