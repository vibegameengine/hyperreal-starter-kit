---
name: dev-lab-authoring
description: >-
  Build and maintain isolated DEV labs in this Unreal kit (scenes that exercise
  one asset, system or mechanic in isolation, each openable in its own game
  process). MANDATORY before creating a new lab, giving a feature "somewhere to
  look at it", or touching an existing lab's stage, manifest, or registration.
  Enforces the four rules: a lab exports nothing but its manifest
  (src/features/<slice>/ui/<id>.lab.ts), a lab mounts the shared lab stage
  (src/scenes/lab-stage) instead of spawning its own sun/sky/ground/camera,
  every lab is found by the glob registry in src/app/scenes.ts, and the lab
  index shows every lab. Trigger on: "add a lab", "isolated demo", "somewhere to
  test this", "tuning bench", "inspection scene", "--lab", "-Scene=labs/",
  "lab stage", "defineLab", "why does every lab look different".
---

# DEV lab authoring

A **lab** is a scene that shows ONE system working, in isolation, with nothing
else in the frame that could explain the result. It is the surface the visual
gate is satisfied on before a feature is integrated, and the bench a system is
tuned on afterwards.

In this kit a lab is opened two ways: from the dev shell (`npm run shell`, the
C++ shell in `vge/shell/src`), whose page lists the labs at `/labs` and shows one at
`/labs/<id>` as its own game process under `<GameWorld>`
(`src/ui/features/world`); or in its own process from the command line —
`npm run play -- --lab <id>` (same as `--scene labs/<id>`, a window on the real
GPU) or `npm run play -- --lab <id> --headless` (`-nullrhi`, numbers only;
AGENTS.md rule 1). Every one of them is a game process started with
`-Scene=labs/<id>`, which opens the scene through `openScene` in
`src/app/scenes.ts`.

Labs are the most-copied code in a game repo: the next lab is always written by
opening the last one and changing the middle. That is fine — and it is exactly
why the *outside* of a lab must be fixed and boring. If every author invents the
lighting, the ground and the camera, the copy carries the invention forward, and
within a dozen labs no two are the same shape.

## The contract (src/shared/lib/devLab.ts)

```ts
// features/<slice>/ui/<id>.lab.ts — the manifest, and the only file outside the lab that names it
import { defineLab } from '../../../shared/lib/devLab';

export default defineLab({
  id: 'flight-case',
  title: 'Flight case',
  description: 'features/demo/assets/flight-case.glb on a turntable; saving the .glb swaps the mesh live.',
  category: 'gear',
  load: () => import('../labs/flight-case'),
});
```

```tsx
// features/<slice>/labs/<id>/index.tsx — the body, loaded only when the lab opens
import flightCase from '../../assets/flight-case.glb';
import { LabStage } from '../../../../scenes/lab-stage/LabStage';
import { LiveAsset } from '../../entities/LiveAsset';

export function Scene() {
  return (
    <>
      <LabStage groundSize={10} camera={{ location: [-260, 0, 140], rotation: [-15, 0, 0] }} />
      <LiveAsset asset={flightCase} at={[0, 0, 45]} />
    </>
  );
}
```

`DevLabCategory` is `'ai' | 'character' | 'combat' | 'gear' | 'meta' | 'render' | 'world'`.
`load` resolves to a `SceneModule`. A lab exports `Scene`, a React component the scene renderer
(`src/shared/react`) turns into actors and components; edits to it apply with React Fast Refresh, and
everything it declares is removed when another scene opens. A module that exports `default` instead builds
the scene imperatively through `src/shared/engine/world.ts` (`spawn`, `every`, `everyFrame`, `own`); new
labs are React.

## The four rules

### 1. A lab is a leaf — it exports NOTHING

**Nothing outside a lab may import anything from inside it.** A lab consumes the
feature it demonstrates; it never becomes a dependency of that feature, of
another lab, or — worst of all — of the shipped game.

The single permitted export is the lab's **registration manifest** (rule 3),
consumed only by the registry glob. Everything else a lab contains — its arena,
its demo props, its camera placement, its fixtures — stays private in
`features/<slice>/labs/<id>/`.

Why this is a hard rule and not a preference:

- A lab is *allowed to be wrong*. It is where you park a half-tuned material and
  an arena with the walls in the wrong place. The moment production imports it,
  that freedom is gone and the lab starts being maintained as a shipping asset —
  it just doesn't look like one to whoever changes it next.
- In the web kit a lab route was stripped from production builds, and an import
  from production code defeated the stripping. This kit now has a release
  bundle of game code (`npm run build` bundles `src/release.ts` into
  `unreal/Content/JavaScript/vge/game.js`), but it does not strip labs yet: the
  registry glob in `scenes.ts` is not gated. The rule holds anyway, because
  whatever production imports from a lab ships with it, and so does every model
  that lab imports.
  - The web kit's one sanctioned exception was a **showcase deployment** — a
    build whose whole point is the labs — switched on by an explicit flag, off by
    default. It changes what ships, never what may import what: production code
    importing a lab stays banned either way, and a lab still exports nothing but
    its manifest.
- The same leak happens through a **shared barrel**. A feature's `index.ts`
  (`features/demo/index.ts` re-exports `LiveAsset`, `SpinningCubes`)
  must never re-export anything from `labs/` or `ui/*.lab.ts`. The lab body
  imports the feature's entity from its own file
  (`../../entities/LiveAsset`), never the other way round.

When production genuinely needs something a lab has, that thing was never a lab
concern: **move it into the feature it belongs to (`entities/`) and let the lab
import it from there.** The direction is always lab → feature, never
feature → lab. Moving it is a real edit with a real visual check, not a
re-export.

The smell, in order of how often it happens: a scene imports a "demo" prop out
of a lab folder because it was the only one that existed; a second lab imports
the first lab's arena; a feature barrel re-exports the lab body "so the scene
list can find it"; a test imports a lab fixture.

### 2. A lab starts from the SHARED lab stage

There is one shared stage, `<LabStage>` in
`src/scenes/lab-stage/LabStage.tsx`, that owns the parts every lab needs and no
lab should be choosing: the sun (a movable `DirectionalLight` driving the
atmosphere), the `SkyAtmosphere`, the `ExponentialHeightFog` that fills the sky
below the horizon, the real-time-capture `SkyLight`, the collidable ground (a thin
box, so characters and physics bodies stand on it), and the inspection camera (a
`CameraActor` with the 16:9 constraint off, made the player's view; `camera={null}`
when the lab's own player camera takes the view).

**A lab renders that stage and puts its subject on it.** It does not declare its
own sun, sky, fog, sky light, ground or view camera.

- The stage is **parameterized, not copied.** Today's props are `ground`,
  `groundSize`, `camera` (`location`, `rotation`, or `null`), `sunPitch` and `sunYaw`. If a
  lab needs something else — a darker key, no sky, a reference grid — that is a
  new OPTION on the stage, added once, available to all, not a private
  re-implementation. Adding the option is usually a smaller diff than the copy
  would have been.
- **A ruler is not a personal expression.** The stage has no reference grid yet;
  its ground is one uniform grey. When a grid or scale reference is added, it is
  added to the stage, so one metre reads the same in every lab. A lab that
  brings its own grid spacing and colours has silently changed the ruler.
- The stage is the only place that knows the project's lighting and camera
  conventions — light mobility, atmosphere sun, sky capture, the camera's aspect
  constraint (README, "Engine notes": `ACameraActor` constrains to 16:9 by
  default). Every hand-rolled light rig is a place those conventions are already
  out of date and nobody knows it.
- **A lab that legitimately cannot use the stage** — because the stage IS its
  subject (a sky or fog setup that owns the whole atmosphere, a renderer
  experiment) — says so in its manifest description, naming what it replaces and
  why. That sentence is the whole exemption process; without it, the next author
  copies the deviation believing it was considered. (The web kit used a code
  comment for this; this repository bans comments that explain, CLAUDE.md, so
  the manifest carries it.)

The failure this rule exists to stop is not ugliness, it is **incomparability**.
When each lab lights its subject differently, two labs cannot be held next to
each other, a material tuned in one is wrong in the other, and "does this look
right?" has no answer that survives the trip to the game.

### 3. Every lab is REGISTERED, and the registry generates the scene list

Each lab declares one manifest — a stable id, a title, a one-line description of
what the lab proves, its category, and a lazy loader for its body. The registry
collects those manifests automatically —
`import.meta.glob('../features/*/ui/*.lab.ts', { eager: true })` in
`src/app/scenes.ts`, not a hand-maintained list — and **the scene list is
built from the registry**: every lab becomes the scene `labs/<id>`. The shell
page reads the same manifests with its own glob
(`src/ui/app/labs/labRegistry.ts`), so the lab index and the `/labs/<id>` routes
come from them too, never from a hand-written list.

- **No hand-registration.** A per-lab entry copied into `scenes.ts` is how a repo
  ends up with scenes nobody remembers, labs with no scene, and two names for one
  lab. If adding a lab means editing the router, someone will add a lab without
  editing the router.
- **The registry is the only list.** A lab that is not in it does not exist —
  there is no second place to look.
- **Gate the whole registry in one place.** The web kit DEV-gated its registry in
  one place so labs could not leak into production one forgotten guard at a
  time. This kit's release bundle (`npm run build`) does not gate it yet; when
  the gate is added, it goes on the glob in `scenes.ts`, once. (The shell page
  already gates its lab subtree in one place: the `__SHOWCASE_SURFACES__`
  dynamic import in `src/ui/app/router/AppRouter.tsx`.)
- **The manifest is metadata, not an API.** It carries strings and a loader. It
  must not export the lab's entities, systems, or fixtures — that would be rule 1
  with extra steps.

The description field is not decoration: it is what makes the index usable — the
lab index shows it on the lab's card and searches it. Write what the lab lets you
SEE ("features/demo/assets/flight-case.glb on a turntable; saving the .glb swaps
the mesh live"), not what it contains ("flight case lab scene").

### 4. The lab index shows every lab — and the web kit's index was PREVIEW CARDS

In the web kit there was one index route listing every lab as a **card with a
preview image** of that lab's actual rendered frame, plus its title and
description, because nobody remembers which of thirty kebab-case names is the
one with the ragdoll; you remember what it *looked like*. The picture was the
index, the words the caption, and the preview was mandatory, captured by a
script that drove the index's own registry, committed with the lab, and
re-captured when the lab's look changed. A missing picture had to look missing.

**Here:** the index is the shell page's `/labs` route (`npm run shell`; the
title bar's "Labs"), `LabsScreen` in `src/ui/app/ui/labs/LabsScreen.tsx`: the
labs grouped by category, one `LabCard` (`src/ui/features/ui-kit`) per lab with
its title and description, and a filter. A card links to `/labs/<id>`, which
shows the lab as its own game process under `<GameWorld>`. `labRegistry.ts`
attaches a preview by file name from `src/ui/app/ui/labs/previews/<id>.webp`,
and a card without one shows that it is missing. `npm run labs:previews [<id>...]`
(`vge/tools/lab-previews.mjs`, with `npm run dev` running) walks the same
manifests (`src/features/*/ui/*.lab.ts`), starts each lab as a rendered
1600×900 game window, waits for its scene, lets it settle (`--settle <s>`, 6 by
default), takes `HighResShot` and writes the 960 px webp. The web kit's rule holds
unchanged: a real captured frame of that lab from a rendered window (never a
`-nullrhi` process, never a hand-drawn icon), committed with the lab, re-captured
when its look changes, and a missing one visibly missing.

**Enforced.** A lab is not finished without its preview: creating a lab means capturing it in the same change.
`.claude/hooks/lab-previews-guard.mjs` (a Stop hook in `.claude/settings.json`) refuses to end an agent's turn while
any `src/features/*/ui/<id>.lab.ts` has no `src/ui/app/ui/labs/previews/<id>.webp`, and names the command that
captures the missing ones. Written on 2026-10-30, when sixteen labs (pcg, destruction and vehicle among them) had
been added without a preview while this rule stood here unchecked.

### 5. A lab is for a PERSON as much as for an agent

A lab ships with the kit: people open it from the shell's index to see what the
kit can do and to play with it. A lab that only an agent can read through
`node vge/tools/game.mjs` is unfinished, however correct its numbers are. Before
writing the lab, decide what a person needs to understand the subject in a minute
and to control it:

- **See what is happening.** The state that explains the subject is on screen,
  live: for an animation graph the shape of the running graph, the active state,
  the blend weights; for a material its parameters; for physics the counts and
  speeds that matter. Read it from the real system (the engine's own report), not
  from what the lab believes it set.
- **Control it.** Every variable the lab exposes to `globalThis.<lab>` for agents
  has a control in the lab's HUD as well: a choice for modes, a slider for
  weights and distances, a toggle for on/off. The person reaches every case the
  lab exists to show, without a console.
- **One line of meaning per mode.** A short sentence saying what the current mode
  shows and what to try. Nothing more.
- **No clutter.** No instructions for things a person learns in two minutes on
  their own (how the camera moves, what a slider is). The screen belongs to the
  subject.

How: the lab sends its state to the HUD a few times a second with `sendToHud`
and takes commands with `useHudMessages` (`src/shared/react/hud.ts`); its
panels live in `src/ui/hud/<Lab>Hud.tsx`, are mounted in `src/ui/hud.tsx`, read
the state with `useGameState('<lab>/state')` (they leave when the lab does), and
are built from the UI kit's `ControlPanel`, `ControlChoice`, `ControlSlider`,
`ControlButton`. The animation graph lab (`AnimGraphLabHud.tsx`) is the example.

The stage's camera is an orbit camera (`src/scenes/lab-stage/OrbitCamera.tsx`,
the editor viewport camera of Unity's Scene view): drag orbits around the
subject, middle drag pans, the wheel zooms, holding the right button flies with
WASD. A lab gives it a starting view with `LabStage camera={{ location, rotation,
focus? }}`; only a lab with its own camera (a player's) passes `camera={null}`.

## What a lab owns, and what it must not

**A lab owns:** its subject on the shared stage; the drivers that move it
(a turntable in `useFrame`, a clip cycle in a `useEffect` timer); a readout of whatever
numbers the tuning produces (the game log, or a value `node vge/tools/game.mjs` can
read); its own fixture data (an arena, a pose, a sample set); and the manifest
copy that explains it.

**A lab must not own:** a second copy of the feature's logic (drive the REAL
system — a lab that reimplements what it demonstrates proves nothing); a private
fork of a shared entity; lighting or camera conventions (rule 2); its own
registration (rule 3); or any engine object outside the scene scope, which would
outlive it.

**Tune the real thing, then hand the numbers back.** A tuning lab's output is
values the feature's own definition file will hold. Give it a readout that
prints those values in the exact shape the source expects. The alternative — a
lab whose values diverge from what ships — is worse than no lab, because it
certifies a configuration nobody runs.

**Initialize from the feature's real current values, never from zero.** A bench
that opens at zero cannot show you what is wrong with what ships; it only shows
you what happens when you move a value away from nothing.

**Content in a lab is live.** A lab that shows a model imports the file
(`import flightCase from '../../assets/flight-case.glb'`) and reads the handle
with `useContentMesh` / `useContentAsset` (`src/shared/react/content.ts`), so
saving the source file rebuilds it and re-renders the running lab with the new
version (the `flight-case` lab does this). Never load a cooked path by hand.

## Build a lab

1. **Name what the lab proves**, in one sentence, before writing anything. That
   sentence becomes the manifest description and decides everything else. If it
   is more than one sentence, it is more than one lab.
2. **Check the registry first** (`features/*/ui/*.lab.ts`). If a lab already
   exercises this system, extend it — add a mode, another subject — rather than
   opening a second lab onto the same thing. Two labs onto one system means
   neither is authoritative, and the newer one silently rots.
3. **Render the shared stage.** Props only; no private light rig, ground or
   camera.
4. **Mount the REAL subject** — the feature's own entity, system, material.
5. **Add the drivers and the readout**, initialized from the real values.
6. **Write the manifest** in `features/<slice>/ui/<id>.lab.ts` and let the glob
   register it.
7. **Confirm it in the index**: the lab is listed in the shell's lab index
   (`npm run shell`, "Labs") and opens from it (rule 4 as this kit can satisfy
   it today).
8. **Satisfy the visual gate in a rendered window** —
   `npm run play -- --lab <id>`, capture the window, look at it. The lab is the
   isolated proof surface, so a lab that has not been looked at has not been
   built.

## One lab per subject — and one scene per lab

Two anti-patterns, both of which look reasonable on the day:

- **Several labs onto one body.** A lab that takes a parameter (which asset,
  which sample, which clip) does not need one manifest per value. It needs ONE
  lab and a selector inside it. A family of near-identical lab ids each passing a
  different constant into the same body is a registry pretending to be a router.
- **Several labs onto one subject.** Where a system has grown a second lab
  because the first was inconvenient to change, the fix is to fix the first one.

## Naming and automation

- One kebab-case id per lab, used as its manifest file (`ui/<id>.lab.ts`), its
  body folder (`labs/<id>/`), its manifest `id`, its scene id (`labs/<id>`) and
  its `--lab <id>` argument. One name, everywhere — never a folder that disagrees
  with its id.
- Name a lab for its SUBJECT, not for the study that produced it. A lab called
  after a one-off investigation is unfindable six weeks later.
- **Renaming a lab breaks the automation pointed at it** (`--lab` invocations,
  `-Scene=labs/<id>` in scripts and notes, a scene remembered across a full
  reload). Grep the repository for the old id in the same change.
- Labs are driven by scripts more than any other surface. Any UI control a lab
  adds to `src/ui` carries a `data-testid` — see `ui-test-ids` — so
  `node vge/tools/ui.mjs click '[data-testid="…"]'` finds it by identity, not by
  label text.

## Acceptance

A lab is done when all of these are true:

- [ ] Nothing outside it imports anything from inside it (grep for its folder).
- [ ] It spawns no sun, sky, sky light, ground or view camera of its own — or its
      manifest description names why the stage cannot serve it.
- [ ] Its manifest is present and its scene came from the registry glob, not a
      hand edit of `scenes.ts`.
- [ ] It is listed in the shell's lab index (`/labs`) and opens from it.
- [ ] Its preview is captured (`npm run labs:previews <id>`), looked at, and
      committed with it — rule 4.
- [ ] It drives the real system, and its readout matches the shape of the file
      the values belong in.
- [ ] A person who opens it sees what is happening and controls every case it
      shows from its HUD, with no console and no on-screen instructions — rule 5.
- [ ] Every UI control it adds has a `data-testid`.
- [ ] It has been opened with `npm run play -- --lab <id>` in a rendered window,
      captured, and looked at.
