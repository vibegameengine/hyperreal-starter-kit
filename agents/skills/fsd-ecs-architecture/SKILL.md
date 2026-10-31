---
name: fsd-ecs-architecture
description: >-
  Where every file goes in this kit's src (game TypeScript run by Puerts
  inside Unreal) and src/ui (the React UI: a game's HUD and the dev shell's
  page), and how to work in it. The
  game code is Feature-Sliced Design (FSD) layers + an ECS-style split inside
  each feature: an ENTITY is a mount function that spawns engine actors through
  shared/engine/world (features/<slice>/entities/*.ts); a COMPONENT is
  per-frame behaviour attached to an entity (everyFrame/every); a SYSTEM is pure
  logic with no `ue` import. MANDATORY before adding, moving, or renaming any
  file under src or src/ui — new entity, behaviour, system, scene, lab,
  feature, shared helper, UI panel, or asset. Enforces: correct layer placement,
  relative imports, the app/scenes/features/shared layering, scope ownership of
  every engine object, and labs for inspection code. Trigger on: "where do I
  put", "add a feature", "add an entity / component / system", "new scene",
  "new lab", "new UI panel", "folder structure", "FSD", "ECS", "how is src
  organized", "import from another feature".
---

# FSD + ECS architecture — what goes where

`src/` is **Feature-Sliced Design layers** on the outside, an **ECS-style
split** inside each feature — the same layout as the web starter kit (README),
with the web kit's React/three.js pieces replaced by engine actors spawned from
TypeScript. `src/ui/` is separate: the HTML/CSS UI, built by the same Vite server
as a normal browser client and shown in the game through CEF.

## The ECS mapping

| ECS term | In this kit | Lives in | Example today |
| --- | --- | --- | --- |
| **entity** | a React component that declares a game being (`features/<slice>/entities/*.tsx`), or a function that **spawns** one imperatively and returns its handle (`*.ts`) | `features/<slice>/entities/` | `<Player>`, `<Stairs>`; imperative: `mountFlightCase`, `mountSpinningCubes`, `mountModularCharacter` |
| **component** | per-frame or periodic behaviour attached to an entity through `everyFrame` / `every` | inside the entity while it has one user; `features/<slice>/components/` once reused in the slice; `shared/lib/` once a second feature needs it | the turntable in `labs/flight-case`, the spin in `spinningCubes.ts` (both inline today) |
| **system** | **pure** logic — no `ue`, no `puerts` import | `features/<slice>/systems/*.ts`; generic → `shared/lib/` | none yet |

The web kit's analogy carries: an **entity** is the GameObject, a **component**
is a behaviour you bolt on, a **system** is the pure math the component calls.
Behaviour is **composed by attaching**, never by inheritance. A component or
system starts inside its feature and is **promoted to `shared/lib` once a second
feature needs it** (YAGNI before that).

`components/` and `systems/` folders do not exist in this kit yet; the table
says where they go when the first one is written. Keep a system free of `ue` so
it can be tested and reasoned about without an engine.

## Engine ownership (this kit's invariant)

Everything script code creates in the engine is owned by a scope
(`src/shared/engine/world.ts`):

- `spawn(cls, location, rotation?, scale?, setup?)` and `meshActor(...)` record
  the actor in the **scene** scope;
- `every(ms, fn, scope?)`, `everyFrame(fn, scope?)` and `own(dispose, scope?)`
  record timers, per-frame callbacks and any other hookup (delegates, UI
  handlers) in the **scene** scope by default, or in the **app** scope for things
  that live across scenes (nothing in the kit uses it today);
- opening a scene clears the scene scope; a full reload clears both.

An engine object created any other way survives a scene switch and a hot reload
and becomes a ghost. Gameplay that engine systems consume every frame runs in
`everyFrame` (README, "Engine notes": a wall-clock timer skips frames).

Content from a model file is never loaded by a cooked path: import the file and
subscribe with its handle through `onAsset` / `onMesh`
(`src/shared/engine/content.ts`) or `useContentMesh` / `useContentAsset`
(`src/shared/react/content.ts`), which call back with every new build.

## The FSD layers (outer structure)

```
src/
  main.ts             # dev entry: React Fast Refresh, the debug seam, then the program
  release.ts          # release entry (`npm run build` -> unreal/Content/JavaScript/vge/game.js): globals, then the program
  app/
    program.ts        # the program: UI host, then the scene named by -Scene= (default main)
    scenes.ts         # scene router: "main" + every lab from LABS in labs.ts (dev only); openScene()
    labs.ts           # LABS: one defineLab entry per lab, whose load imports features/<slice>/labs/<id>
    ui-host.ts        # game side of the HUD page (shows src/ui/hud.html through UVgeUI)
    debug-seam.ts     # expression evaluation for agents (tools/game.mjs)
  scenes/
    main/             # the main scene: the composition root, deep-imports feature entities
    lab-stage/        # the shared stage every lab mounts (sun, sky, ground, camera)
  features/
    <slice>/          # a vertical slice: entities/ labs/<id>/ assets/ + optional index.ts
  shared/
    engine/           # world.ts (scopes, spawn helpers, viewFrom), content.ts (content builds)
    lib/              # cross-feature primitives; devLab.ts (the lab contract)
src/ui/               # HTML/CSS UI (React): a game's HUD (hud.html, hud.tsx, bridge.ts, styles.css)
                      # and the dev shell's page (main.tsx, App.tsx, app/, features/, shell/, shared/)
```

A slice has no screens: the web kit's screens are the HTML UI in `src/ui` here.
Labs are registered in one list, `LABS` in `app/labs.ts`, not by files in the
slice.

Content modules under `assets/` have plain names (`lava.tsx`, `forest.ts`,
`car.ts`), never a kind postfix. A module's kind is known from its code: it calls
a define function imported from `src/shared/<kind>` (`defineMaterial`/
`defineInstance` → material, `defineSystem` → niagara, `defineTerrain`,
`defineMotionMatching`, `defineCompute`, `defineGraph` → pcg, `defineFracture`,
`defineVehicle`, `defineGroom`), detected by `vge/content/contentKind.mjs`. No
file name or folder decides anything.

**Dependency direction (never violate):** `app → scenes → features → shared`.
`shared/` imports nothing above it. Scenes may deep-import feature entities (they
are the composition root). Features do not import other features except through a
public barrel, and do not import the app layer. **The one upward import in the
tree** is a lab body importing `scenes/lab-stage` — the stage exists to be
mounted by labs (`dev-lab-authoring`); nothing else in a feature imports a scene.

## Decision table — "I want to add X"

| You are adding… | Put it in | Notes |
| --- | --- | --- |
| A thing that exists in the world (character, prop, building) | `features/<slice>/entities/x.ts` | A `mountX(...)` that spawns through `world.ts` and returns its handle. |
| Per-frame behaviour (spin, follow, health drain) | inside the entity; `features/<slice>/components/` once reused; `shared/lib/` for 2+ features | Attached with `everyFrame` / `every`; takes the actor it drives. |
| Pure game/math logic (layout, damage, pathing) | `features/<slice>/systems/x.ts`, or `shared/lib/` if generic | No `ue`, no `puerts`. **This is the layer you unit-test.** |
| An isolated inspection scene | `features/<slice>/labs/<id>/index.ts` + one `defineLab` entry in `LABS` in `app/labs.ts` + its preview import in `src/ui/app/labs/previews.ts` | See `dev-lab-authoring`. |
| A playable scene | `scenes/<name>/index.ts` (default export builds it) + an entry in `loadScene` in `app/scenes.ts` | `main` and `world` are listed there; labs come from `LABS` in `app/labs.ts`. |
| An engine-facing helper every layer needs | `shared/engine/` | Spawning, scopes, content, views. |
| A primitive used by ≥2 features | `shared/lib/` | Only promote once a second consumer exists. |
| An in-game HUD element | the HUD page, `src/ui/hud.tsx` (empty today), composed from `src/ui/features/ui-kit` primitives | Hears the game through `onGameMessage`, acts through `post()` (`src/ui/bridge.ts` ↔ `UVgeUI`); elements that take the mouse carry `data-hit`. The game side is `app/ui-host.ts`, which handles no message yet. |
| A 3D source asset | `features/<slice>/assets/<name>.glb` (`.gltf`, `.fbx`), beside the feature that owns it | A module: reaches the game only when code imports it (`import model from '../assets/<name>.glb'`); its default export is the handle `useContentMesh` / `onAsset` take. Never a detached asset bucket. |
| A UI image | beside the `src/ui` component that imports it | Never a detached asset bucket. |
| A C++ type the scripts need | `unreal/Source/VibeGameEngine`, then `npm run build:cpp` | Regenerates `unreal/Typing/ue`, which the scripts compile against. |

## Import rules

- **Relative imports only** — there are no path aliases (`@/…`).
- Engine modules: `import * as UE from 'ue'` and `puerts` (`$ref`, `$unref`), typed
  by the generated `unreal/Typing/ue` (`npm run typings`, git-ignored) and
  `unreal/Plugins/Puerts/Typing/puerts` (`tsconfig.json`).
- **Cross-slice imports are deep and explicit or through the barrel.** A scene
  imports a feature's public entities from its `index.ts`
  (`scenes/main` imports `mountFlightCase`, `mountSpinningCubes` from
  `features/demo`); a lab body imports its own feature's entity by file
  (`../../entities/flightCase`).
- **Barrels (`index.ts`) are minimal** — they re-export only what another layer
  consumes (today: the entity mount functions and their handle types). Never
  re-export a lab body from a barrel (`dev-lab-authoring`
  rule 1).

## Adding a new feature (recipe)

1. `features/<slice>/` with the subfolders you actually need (`entities/` first;
   `systems/` and `components/` when they have content; `labs/` and `ui/` for its
   lab).
2. Write **systems** first (pure, testable) → then **components** (behaviour that
   calls systems) → then **entities** (mount functions that spawn and attach) →
   then a **lab** that shows the entity in isolation.
3. If a scene needs the entities, export them from the slice's `index.ts` and
   import them in the scene.
4. Spawn and hook up only through `shared/engine/world.ts`, so the scope owns it.

## Dead code & inspection code

Do not delete unused or WIP code without permission (AGENTS.md rule 2). Give it a
home instead: preserve it in place unwired, and turn salvageable inspection code
into a **lab** rather than a branch of the main scene.

## Verify

Never trust a typecheck alone (AGENTS.md rule 1). During the work let hot reload
apply each change to the running game (`npm run dev`, one server, any number of
game processes) and look at the affected scene or lab in a rendered window
(`npm run play`, `-- --lab <id>`). Before final delivery run
`npm run typecheck` from the kit root; it compiles `src` and `vge/runner` against the
generated typings, so run `npm run typings` first if `unreal/Typing/ue` is missing or
the C++ changed (`npm run build:cpp` regenerates it). A red typecheck may be
pre-existing: confirm an error is not yours (unchanged file ⇒ pre-existing)
before acting on it.
