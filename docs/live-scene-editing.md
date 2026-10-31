# Live scene editing

A design for editing a running scene in place — pause, fly, select, move, rotate,
scale, change props — with every change written back into the JSX that declares
it, in one scene that stays open for the whole session while people and agents
iterate on it by hot reload.

This is a research document: it records how the kit works today (with
`file:line` from the tree as of 2026-10-27), what the engine offers at runtime,
the proposed architecture, the hard cases and a staged plan in which every stage
is a part of the final system. Paths are those of the restructured root: game
code in `src/` (was `dev/src/`, the HUD page in `src/ui/`, was `dev/ui/`), the
kit's dev tooling in `vge/` (`vge/server.mjs`, `vge/runner/`, `vge/tools/`, was
`dev/`), Unreal in `unreal/` (`unreal/Source/`, `unreal/Typing/`). Line numbers
were read before the move and checked after it. Every file is also named by its
role.

## 1. How it works today

### 1.1 The scene renderer

- **Reconciler** (`src/shared/react/renderer.ts`, the scene renderer). Lower-case
  JSX elements named after engine classes become `HostNode`s (`renderer.ts:20-38`).
  `kindOf` (`renderer.ts:49-53`) makes an actor (`mountActor`, `:101-111`), a
  component (`mountComponent`, `:121-141`, given a holder actor when it has no
  owner), or a *packed* static mesh: one instance in `UVgeInstancePool`
  (`mountPacked`, `:90-94`), grouped by a template component per distinct set of
  mesh props (`templateFor`, `:60-73`).
- **Transforms.** `location`, `rotation`, `scale` are reserved props
  (`apply.ts:10`), turned into a transform by `transformOf` (`apply.ts:142-144`).
  An actor's transform is composed with its parent's world transform and set with
  teleport (`renderer.ts:233-236`); a component's is relative to what it is
  attached to (`setRelativeTransform`, `renderer.ts:143-146`); a packed
  instance's is composed with the parent's world transform, and packed
  descendants follow a moved ancestor (`refreshPacked`, `renderer.ts:208-216`).
- **Prop writes** (`src/shared/react/apply.ts`). `writeProps`
  (`apply.ts:111-130`) skips reserved props and values that are `same` as before
  (`apply.ts:149-153`: tuples and material handles compare by content), writes
  through the Blueprint setter when the class has one, otherwise into the
  property, then re-registers the component. The per-class prop table is the
  generated catalog (`catalog.ts`, `unreal/Typing/ue/ue-jsx.json`).
- **What the renderer does not keep.** `createInstance` (`renderer.ts:281-288`)
  ignores its fifth argument, the fiber (`react-reconciler.development.js:10597-10603`
  passes `workInProgress`), so a `HostNode` knows neither the element that made it
  nor the component that rendered it. Nothing maps an engine object, or a packed
  instance id, back to its `HostNode`.

### 1.2 Where an element came from

- The game's TSX is compiled by `vge:react-refresh-transform` (`vge/server.mjs:370-380`)
  with oxc's development JSX transform. It does emit a source argument —
  `_jsxDEV(Stairs, {...}, void 0, false, { fileName, lineNumber: 41, columnNumber: 7 }, this)`
  (read from `transformWithOxc` output for `src/scenes/main/index.tsx`).
- **React 19.3 drops it.** `jsxDEV` is `function (type, config, maybeKey, isStaticChildren)`
  (`react/cjs/react-jsx-dev-runtime.development.js:327`); the fifth parameter of
  `jsxDEVImpl` is now the debug stack (`:198-205`) and the element has no
  `_source` (`ReactElement`, `:155-196`). What survives is `_debugStack`, an
  `Error` captured at element creation, limited to the first 10 000 elements per
  owner-stack window (`:328-333`), whose frames point into the *transformed* code:
  the game's modules come without sourcemaps (`remoteRunner: { inlineSourceMap: false }`,
  `vge/server.mjs:418`; `sourcemapInterceptor: false`, `vge/runner/bootstrap.ts:135`;
  `devLeanTransportPlugin({ stripSourcemaps: true })`, `vge/server.mjs:402`).
  No source location is read in the game today.
- **The maps exist on the server.** With `inlineSourceMap: false` the server
  still keeps each module's map in its module graph (the transform result), and
  Vite's own `ssrRewriteStacktrace(stack, moduleGraph)`
  (`node_modules/vite/dist/node/chunks/node.js:15860`) uses exactly that to turn
  a server-side stack into source positions. A test stand (Vite + ModuleRunner
  with `sourcemapInterceptor: false` and the kit's oxc refresh transform) mapped
  the element's frame of `_debugStack` back to the `<` of each element, two
  elements on one line and elements inside `.map` included; the map's
  `sourcesContent` equals the file text the positions belong to. This is how
  React DevTools finds a component's source in the browser: owner stack plus
  sourcemap. The 10 000 limit resets once per second
  (`react-reconciler.development.js:16338-16340`); the nanite lab renders
  10 000 elements (`src/features/demo/labs/nanite/index.tsx:29`), so elements
  beyond the limit share `unknownOwnerDebugStack`.
- What does survive on fibers: `_debugOwner` (the component fiber that created an
  element, set in `react-reconciler.development.js:4052` and around it) and each
  component fiber's `memoizedProps`. Owner chains are available in the dev build
  the kit runs (`react-reconciler/index.js` picks the development build unless
  `NODE_ENV` is `production`, which only `vge/tools/build.mjs:45` sets).

### 1.3 Hot reload and what restarts the scene

- **Fast Refresh in V8.** `vge:react-refresh-wrapper` (`vge/server.mjs:381-386`) is
  rolldown's `viteReactRefreshWrapperPlugin`; for a module whose transform
  registered components it appends `import.meta.hot.accept(next => …validateRefreshBoundaryAndEnqueueUpdate…; if (message) import.meta.hot.invalidate(message))`
  (strings in `@rolldown/binding-win32-x64-msvc`). The runtime is plugin-react's
  `refresh-runtime.js`, whose preamble `src/app/refresh.ts` installs; the
  renderer registers with it through `reconciler.injectIntoDevTools()`
  (`renderer.ts:403`). Measured: 67 ms median from file write to update
  (`docs/workflow.md:39`).
- **What a refresh keeps.** State of every component whose hook signature did not
  change. The renderer rewrites only props whose value changed (`writeProps`
  with `same`), so a physics box that has fallen keeps its place when its file is
  edited, as long as its own prop values did not change.
- **What a refresh re-runs.** Every effect of a component in the edited module,
  dependencies or not: `ignorePreviousDependencies = current.type !== workInProgress.type`
  (`react-reconciler.development.js:5521-5522`), and a refreshed component has a
  new type. In the kit that re-runs, for example, `Player`'s possess effect,
  `Dominoes`' push timer and `SphereRain`'s drop interval when their own files
  are edited.
- **What forces a full reload today** (the ModuleRunner's `full-reload`:
  `vite/dist/node/module-runner.js:871-884` notifies `vite:beforeFullReload`,
  clears *every* evaluated module and imports the entry again; `world.ts:108-111`
  then disposes both scopes; `program.ts` reopens `app.scene`, rebuilding the
  scene from nothing — React state, physics, player position, camera all lost):
  1. An edit of any module that is not a refresh boundary and whose importer chain
     reaches `src/main.ts` without one: everything in `src/app/` (`scenes.ts`,
     `labs.ts` — the list of labs, imported by `loadLab` in `scenes.ts` —
     `program.ts`, `ui-host.ts`, `debug-seam.ts`), `src/shared/engine/*.ts`
     (`world.ts` is imported by `scenes.ts`), `src/shared/react/*.ts` (the
     renderer itself, `apply.ts`, `anim.ts`, `materials.ts`, `hooks.ts`, reached
     through `shared/react/index.ts` from `scenes.ts`), and
     `src/shared/lib/devLab.ts`.
  2. A component module whose exports stop being refresh-compatible
     (`refresh-runtime.js:630-675`: an export added or removed, or a non-component
     export with a new identity). It invalidates and the update moves to its
     importers; it becomes a full reload when it reaches a non-boundary chain to
     the entry — e.g. a new export in `scenes/main/index.tsx` reaches `scenes.ts`.
     Non-component exports that re-invalidate on every edit exist today:
     `MANNY_LOCOMOTION`, `locomotionClipsIn`, `setLocomotion` in
     `MannequinLocomotion.tsx:18-37`, `useSkeletalMesh`, `useAnimation` in
     `ImportedCharacter.tsx:21-32` (they stop at the `Player` boundary, at the
     cost of re-executing it).
  3. A dev server restart: the reconnecting transport sends itself `full-reload`
     on reconnect (`vge/runner/bootstrap.ts:64-67`), because the new server has an
     empty module graph and could not route updates to the old modules.
  4. A dependency re-optimisation in the `unreal` environment (Vite reloads the
     environment when its optimised deps change).
- **What remounts part of the scene** (not a reload, but the subtree's actors are
  destroyed and spawned again): a hook-signature change in a component
  (Fast Refresh marks its family stale); a render error, which with no error
  boundary unmounts the whole root until the refresh runtime retries it.
- **By design, not hot reload:** opening another scene (`openScene`,
  `scenes.ts:33-51`) and switching scenes from the shell, which ends the game
  process and starts another (`docs/workflow.md:44`).

### 1.4 Frames, input, camera

- `useFrame` and `everyFrame` callbacks run from `UVgeGameInstance::OnWorldTickStart`
  (`unreal/Source/VibeGameEngine/Private/VgeGameInstance.cpp:56-62`), which fires for
  every world tick, *paused or not* (`world.ts:76-78` says so). Pausing the world
  would not stop script-driven motion such as `SpinningCubes` (`useFrame`,
  `SpinningCubes.tsx:20-23`) or the player's input (`Player.tsx`).
- The labs' `OrbitCamera` (`src/scenes/lab-stage/OrbitCamera.tsx`) already is
  an editor viewport camera: orbit, pan, dolly, right-button fly with WASD/Q/E,
  F to reset, with the cursor-hiding fly the editor has (`:117-148`). Left drag
  orbits (`:104-106`), which an editor needs for selection and gizmo drags.
- The player camera is the possessed character's spring arm (`Player.tsx`); the
  player captures the mouse (`useMouseCapture`, `shared/react/mouse.ts`).

### 1.5 The channels

- Game ↔ dev server: the `unreal` hot channel (`vge/server.mjs:31-86`), custom events
  both ways (`import.meta.hot.send/on`), refused to web pages (`fromAPage`,
  `vge/server.mjs:29`). The eval seam (`vge/server.mjs:221-264`, `app/debug-seam.ts`) is
  the precedent for a request/reply protocol over it.
- Game ↔ HUD page: `UVgeUI` `Send` / `OnMessage` (`shared/react/hud.ts`), page
  side `src/ui/bridge.ts` (`post`, `onGameMessage`, `data-hit` rectangles that
  route the cursor to the page).
- Server-side source rewrite precedent: none. The server re-loads a module
  without a file change with `environment.reloadModule(node)` (`vge/server.mjs:166`),
  and a plugin suppresses an HMR update by returning `[]` from `hotUpdate`
  (`vge/vite/materialAssetsPlugin.mjs:26-27`).
- Parsers already installed in `node_modules`: `typescript-api` (TypeScript
  6.0.3 compiler API, used by `.claude/hooks/lib/cleanCode.mjs`), `rolldown/parseAst`
  (oxc), `magic-string`. A probe parsed `scenes/main/index.tsx` with
  `ts.createSourceFile(..., ScriptKind.TSX)`, found `<Stairs at={[-150, 400, 0]}>`
  at offset 2031–2045, replaced that range, and the result differed from the file
  in that one line only.

## 2. What the engine offers at runtime

All paths under `UE_5.8/Engine/Source/Runtime`. The game is a Development
package with `WITH_EDITOR=0`, so only runtime code counts.

### 2.1 Pause that keeps rendering

- `UGameplayStatics::SetGamePaused` (`Engine/Private/GameplayStatics.cpp:572-577`)
  calls the first local player controller's `SetPause` (`PlayerController.cpp:1928-1954`),
  which sets the pauser on the world settings through the game mode
  (`GameModeBase.cpp:219-235`; allowed in standalone, `:323`).
- While paused, `UWorld::Tick` runs no tick group at all: `bDoingActorTicks`
  includes `!bIsPaused` (`Engine/Private/LevelTick.cpp:1650-1656`). Instead
  `RunPauseFrame` (`:1782-1784`, `TickTaskManager.cpp:1574-1640`) runs only tick
  functions with `bTickEvenWhenPaused`, on the game thread, unordered. Physics does
  not step (`SetupPhysicsTickFunctions` sits in the actor-tick block, `:1740`),
  `FTimerManager` and latent actions do not run (`:1793`, `:1812-1817`), FX is
  skipped (`:1947`), skeletal animation does not tick
  (`SkeletalMeshComponent.cpp:440`). Game time stops (`:1608`).
- The world is still drawn: `RedrawViewports` is not gated on pause
  (`GameEngine.cpp:2027-2035`).
- Two flags matter for flying a camera while paused:
  - the camera manager updates during a pause only when the player controller
    asks for a full tick (`LevelTick.cpp:1845`; `bShouldPerformFullTickWhenPaused`,
    `PlayerController.cpp:6599-6604`, default false at `:206`);
  - `UWorld::bIsCameraMoveableWhenPaused` (`World.h:1359`, read by
    `IsCameraMoveable`, `LevelTick.cpp:454-463`); without it the view counts as
    paused (`SceneView.cpp:3128`) and the renderer freezes previous-frame view
    data (`Renderer/Private/SceneVisibility.cpp:5210`, `:5602`).
- Not paused by the engine: the kit's own frame callbacks (`OnWorldTickStart`
  fires on every tick, §1.4) and Puerts timers (`setTimeout` / `setInterval` in
  V8 are not `FTimerManager` timers). The edit session pauses those itself (§3.2).

### 2.2 A runtime fly camera with selection: ADebugCameraController

`Engine/Classes/Engine/DebugCameraController.h` / `Private/DebugCameraController.cpp`
is runtime code (only buffer and view-mode visualisation is under
`!(UE_BUILD_SHIPPING || UE_BUILD_TEST)`). It sets `bTickEvenWhenPaused` and
`bShouldPerformFullTickWhenPaused` (`:49-50`), flies a spectator pawn that ticks
while paused (`:376-394`), and selects with a line trace along the camera's
forward vector, not the cursor (`SelectTargetedObject`, `:1025-1038`, channel
`ECC_Pawn`). It is reached through the cheat manager (`CheatManager.cpp:644-668`,
`DebugCameraManager.cpp:40-96`), which switches the local player to another
controller. The kit does not use it as the edit camera: the labs' `OrbitCamera`
already is the editor camera, and `SwitchController` is not exposed to script.
It shows that a camera flies over a paused world with
`bShouldPerformFullTickWhenPaused` alone: it never sets
`bIsCameraMoveableWhenPaused`, and nothing in the engine does.

### 2.3 Picking

- `APlayerController::GetHitResultUnderCursorByChannel`
  (`PlayerController.cpp:2074-2093`) and `GetHitResultAtScreenPosition`
  (`:2243-2259`): deproject the cursor, `LineTraceSingleByChannel`. Runtime, and
  in the typings (`unreal/Typing/ue/ue.d.ts:23848`), as is
  `DeprojectScreenPositionToWorld` (`:23825`).
- A hit on an instanced static mesh gives the component and `Hit.Item`, the
  instance index (`Collision/CollisionConversions.cpp:164` copies
  `InstanceBodyIndex`, set per instance in `InstancedMeshComponentBodies.cpp:50`,
  `:106`). The pool hands out instance ids (`AddInstanceById`,
  `unreal/Source/VibeGameEngine/Private/VgeInstancePool.cpp:56`); the id-to-index
  conversion (`GetInstanceIndexForId`, `InstancedStaticMeshComponent.h:317`) is
  C++ only, but `GetInstanceTransform(index)` is exposed (`ue.d.ts:66855`), and
  the renderer knows every packed node's transform, so script matches the hit
  instance by its transform (§3.2). Zero-scale instances have no body
  (`InstancedMeshComponentBodies.cpp:95-97`).
- Hit proxies are editor-only: `FScene::RequiresHitProxies` is
  `GIsEditor && bRequiresHitProxies` (`Renderer/Private/RendererScene.cpp:4320-4323`),
  primitive hit proxies are created only `if (GIsEditor)`
  (`PrimitiveSceneInfo.cpp:105`, `:252`), `RenderHitProxies` is inside
  `#if WITH_EDITOR` (`SceneHitProxyRendering.cpp:698`), and the game viewport
  client stores none (`GameplayViewportClient.cpp:17-21`). Picking is by traces,
  and by bounds for what has no collision.

### 2.4 A runtime gizmo: InteractiveToolsFramework

- `Runtime/InteractiveToolsFramework` is a runtime module; its `WITH_EDITOR`
  blocks are cosmetic (`CombinedTransformGizmo.cpp:1554`, `HitTargets.cpp:57`,
  `GizmoRenderingUtil.cpp:20-24`). Runtime gizmos: `UCombinedTransformGizmo`
  (`Public/BaseGizmos/CombinedTransformGizmo.h`) and its parts
  (`UAxisPositionGizmo`, `UPlanePositionGizmo`, `UAxisAngleGizmo`,
  `URepositionableTransformGizmo`). `UTransformGizmo` (GizmoElement-based) is in
  an Editor module and is not available.
- A host provides `IToolsContextQueriesAPI`, `IToolsContextTransactionsAPI` and
  `IToolsContextRenderAPI` (`Public/ToolContextInterfaces.h:299`, `:405`, `:479`),
  initialises `UInteractiveToolsContext` (`InteractiveToolsContext.h:81`), posts
  input with a world ray to `UInputRouter::PostInputEvent` (`InputRouter.h:61`),
  and calls the gizmo manager's `Tick` and `Render` (`InteractiveGizmoManager.h:174`,
  `:177`) and `UGizmoViewContext::ResetFromSceneView` every frame
  (`GizmoViewContext.h:69`). Gizmo handles hit-test analytically in their own
  `LineTraceComponent` (`HitTargets.cpp:51-70`, `GizmoArrowComponent.cpp:187`),
  so they need no collision setup.
- The engine has a runtime host to copy: the `XRCreativeFramework` plugin
  (`Engine/Plugins/Experimental/XRCreativeFramework`, module type Runtime),
  `XRCreativeITFComponent.cpp` (queries `:42`, render `:135-170`, transactions
  `:174`, gizmo registration `:555`, per-frame view and input `:700-800`) and its
  PDI scene proxy (`XRCreativeITFRenderComponent.cpp:131`, `:177`).
- The gizmo's transactions map one to one onto the editor's protocol:
  `BeginUndoTransaction` is the drag start (preview begins), `EndUndoTransaction`
  the release (commit to source), `CancelUndoTransaction` Escape (preview
  reverted).
- Why the kit does not host it: the tools context is driven through C++
  interfaces that are not UFUNCTIONs (the typings show only properties,
  `ue.d.ts:29864-32603`), `VibeGameEngine.Build.cs` does not depend on the module,
  and its meshes and materials (`/Engine/InteractiveToolsFramework/...`,
  `CombinedTransformGizmo.cpp:384-708`) would have to be packaged. What a gizmo
  is — handles drawn over the scene, a ray hit-tested against them analytically,
  a drag projected onto an axis or a plane — is written in TypeScript on the
  kit's own renderer instead (§3.2), the way the gizmo components do it in
  `LineTraceComponent` (`GizmoArrowComponent.cpp:187`).

### 2.5 Physics under the gizmo

- A simulated body detaches from its parent when simulation starts
  (`PhysicsEngine/BodyInstance.cpp:2669-2687`; also at `BeginPlay`,
  `PrimitiveComponent.cpp:4378-4391`, and on a later attach,
  `SceneComponent.cpp:2440-2459`): its props are a spawn transform only.
- A teleport (`ETeleportType::TeleportPhysics`) sets the body pose
  (`BodyInstance.cpp:2767-2840`) and keeps its velocity; the edit session zeroes
  linear and angular velocity after moving a simulated body
  (`SetPhysicsLinearVelocity`, `SetAllPhysicsAngularVelocityInRadians`,
  `PrimitiveComponentPhysics.cpp:385`, `:518`).

### 2.6 Selection highlight

- The editor's selection outline does not exist in the game: the pass is
  compiled only `#if WITH_EDITOR` and gated on `GIsEditor`
  (`Renderer/Private/PostProcess/PostProcessing.cpp:637-655`).
- Custom depth works at runtime (`PrimitiveComponent.cpp:5147`, `:5163`), but a
  stencil needs `r.CustomDepth=3` (`SceneUtils.cpp:14-22`; default 1).
- `UMeshComponent::SetOverlayMaterial` (`MeshComponent.cpp:359`) draws a second
  material over one mesh with no project setting. The first highlight used it
  with a translucent fresnel rim; the rim was about 13% opaque on faces turned to
  the camera and was not seen. The Nanite proxy draws no overlay at all
  (`Rendering/NaniteResources.cpp` has no overlay path), and on packed instances
  the material needs the `instancedStaticMeshes` usage. The highlight is now an
  outline (§7).

## 3. Architecture

The rule for every part: use what the platform already does natively — React
DevTools' mechanisms, Vite's module graph and HMR, the engine's pause and
gizmos — the way the web starter kit uses stock Vite and Fast Refresh in the
browser (§3.6). Nothing is added to the scene's code or props for the editor's
sake, and nothing keeps a second copy of the source.

| Part | Lives in | Owns |
|---|---|---|
| Source locations | the dev server, from its own module graph | which JSX element, in which text of which file, made a node |
| Edit session | the game (`src/app/edit/`, plus the host config's DevTools hooks) | pause, edit view, selection, gizmo, preview through `overrideProps` |
| Source writer | the dev server (`vge/edit/`, a plugin of `vge/server.mjs`) | reading TSX, deciding what is editable, writing, undo, conflicts |
| Editor UI | the HUD page (`src/ui/edit/`) | outliner, inspector, toolbar; a view, never an authority |

The files are the only source of truth. The game holds only what is transient
(selection, the props overridden during a drag); the server holds only its undo
history; the page holds nothing.

### 3.1 Source locations: owner stacks and the server's sourcemaps

This is the browser's own path, the one React DevTools follows to "view source".

- **Host node to fiber.** The host config's `getInstanceFromNode`
  (`renderer.ts:394`, `() => null` today) returns the node's fiber, kept from the
  fifth argument of `createInstance`. Reads always go through the reconciler's
  current-fiber resolution (`getCurrentFiber` / `findCurrentFiberUsingSlowPath`,
  `react-reconciler.development.js:127`, `:21272`), never through the fiber object
  saved at creation, whose `_debugOwner` and `memoizedProps` can be one render
  behind (`_debugOwner` is set on the work-in-progress fiber,
  `react-reconciler.development.js:4045-4052`).
- **Fiber to source.** The fiber's `_debugStack` (copied from the element,
  `react-reconciler.development.js:18300`) holds the frame of the JSX call. The
  game sends that frame to the server; the server maps it through the module's
  map in its own module graph, as `ssrRewriteStacktrace` does (§1.2), to file,
  line and column, and from the map's `sourcesContent` to an offset in the exact
  text the game runs. No transform, no extra prop, no maps shipped to the game.
- **Owner chain.** `_debugOwner` walks from the host element to the components
  above it; each component fiber's own `_debugStack` is its call site. The chain
  `Scene > Colonnade (scenes/main/index.tsx:40) > staticMeshComponent (Colonnade.tsx:25)`
  is read, not built.
- **Beyond 10 000 elements a second.** Elements past the limit share
  `unknownOwnerDebugStack` (§1.2). When such a node is selected, the session
  asks React to render its owner again with the DevTools `scheduleUpdate`
  (`react-reconciler.development.js:20793`, `:21265`) after the window has reset;
  the elements are created again with their own stacks and, their props being
  equal, nothing is written to the engine (`same`, `apply.ts:149-153`).
- **Version.** The server compares `sourcesContent` with the file on disk. Equal:
  the offset is valid. Different (the file changed after the game got this
  module, and the update is on its way or failed): the element is found again by
  its structural path (enclosing function, tag, `key` literal, index among JSX
  siblings) in the disk text; no unique match, the request is refused and the UI
  asks for a reselect.
- **Release.** Nothing of this runs in the release build: `_debugStack` and
  DevTools internals exist only in the development builds of React.

### 3.2 Edit session (game)

- **Edit mode** is a state of the game process, held on the bootstrap global
  (`__vge.edit`) like the scopes, so a full reload re-enters it.
Everything below is TypeScript in the game process, on functions the typings
already expose; no C++ changes.

- **Pause.** Entering edit mode calls `UGameplayStatics.SetGamePaused(world, true)`
  (`ue.d.ts:142372`): physics, actor ticks, engine timers and animation stop
  while the frame is rendered (§2.1). The player controller's
  `bShouldPerformFullTickWhenPaused` (a property, `ue.d.ts:23479`) is set so its
  camera manager keeps updating the view (§2.1). Script work follows the engine's
  rule, under the engine's name: the kit's frame dispatch (`useFrame`,
  `useFixedStep`, `everyFrame`, today straight on `UVgeGameInstance.OnTick`,
  `shared/react/hooks.ts:7-22`, which fires paused or not, §1.4) skips every
  callback while `UGameplayStatics.IsGamePaused(world)` (`ue.d.ts:142162`) unless
  it was registered with `tickEvenWhenPaused`, as the editor's own are. Scope
  timers (`every`, `world.ts:58-65`) count game time from that dispatch, so they
  stop with it. The scene code that uses bare `setTimeout` / `setInterval` today
  (`Dominoes.tsx:20`, `SphereRain.tsx:33`, `features/character/labs/mannequin/index.tsx:27`)
  moves to scope timers; a bare V8 timer is not paused by anything.
  `UWorld::bIsCameraMoveableWhenPaused` is not exposed to script, and nothing in
  the engine sets it, not even the debug camera that flies while paused
  (`grep` over `Engine/Source/Runtime`: only `World.h:1359` and
  `LevelTick.cpp:456`); what it changes is the renderer's previous-frame view
  data while paused (§2.1), and its effect on a moving edit camera is measured,
  not assumed, before anything is done about it.
- **Edit view.** The edit camera is a `cameraActor` the edit session renders,
  moved by `OrbitCamera`'s controls (the kit's editor camera, §1.4) with left
  click and left drag given to selection and the gizmo and Alt + left drag to
  orbit; the scene's controller views through it with `SetViewTargetWithBlend`.
  An effect re-run by a commit's refresh that possesses a pawn
  (`Player.tsx:52-54`) moves the view target to that pawn; the edit session's
  paused-aware frame callback puts it back on the edit camera every frame, before
  the camera manager reads it. Mouse capture (`wantMouseCapture`,
  `shared/engine/mouse.ts:33`) is a frame callback too, so it does not run while
  paused. Leaving edit mode restores the scene's view target.
- **Picking.** `GetHitResultUnderCursorByChannel` (`ue.d.ts:23848`): deproject
  the cursor, line trace (§2.3). The hit component maps to its `HostNode` through
  the renderer's object → node map (filled at mount, cleared at unmount). A hit
  on a pool group's instanced component gives `Hit.Item`, the instance index;
  `GetInstanceTransform(Item, out, true)` (`ue.d.ts:66855`) gives that
  instance's transform, which is matched against the packed nodes of that group,
  whose transforms the renderer computed. Two packed elements of one group at the
  same transform are the same picture; both are listed and the user picks one in
  the outliner. Elements without collision (lights, fog, sky, cameras, Niagara)
  are picked by the ray against their bounds, and from the outliner.
- **Preview, React DevTools' own.** While a gizmo is dragged or an inspector
  value is scrubbed, the session writes the new value into the selected level's
  fiber with DevTools `overrideProps(fiber, path, value)`
  (`react-reconciler.development.js:20771-20776`, `:21262`): the fiber renders
  again on the sync lane with the overridden prop, through the same
  `commitUpdate` → `update` path as any prop change. That path already teleports
  actors and components, moves packed instances and their packed descendants
  (`renderer.ts:218-241`, `refreshPacked`), and for a component level re-renders
  every element that reads the prop (all twenty columns of a colonnade). The
  session zeroes the velocity of simulated bodies it moved (§2.5). Nothing is
  written to disk during a drag, and nothing in the renderer is bypassed.
- **Gizmo.** A TypeScript component the edit session renders through the kit's
  own renderer: three arrows, three plane squares, three rings, three scale
  cubes, as `staticMeshComponent`s placed at the selection and scaled each frame
  to a fixed size on screen, with an unlit material that ignores depth (a
  material module; `bDisableDepthTest` is a property of `UMaterial`,
  `ue.d.ts:2715`, to be confirmed among the `<material>` element's settings).
  Hit testing is analytic, as the engine's gizmo components do it: the cursor
  ray's distance to each axis segment, plane square and ring in screen pixels.
  A drag projects the ray onto the axis line or the handle's plane (move), onto
  the ring's plane for the angle (rotate), or along the axis (scale); local or
  world space, snapping in the same math. Each drag step becomes prop values
  (§4.2) and goes to `overrideProps`. Drag start, release and Escape are begin,
  commit and revert.
- **Highlight.** An overlay material (`SetOverlayMaterial`, §2.6) on the selected
  component. A packed element has no component of its own; while it is selected
  the renderer itself moves it out of its group and back on deselect (its own
  unmount / mount, as `commitUpdate` does on a kind change, `renderer.ts:356-363`)
  — selection is not a prop, so this is not a React commit.
- **Commit.** On release the session sends `vge:edit-commit` with the source
  locations of the edited level, the prop and the value. The server writes the
  file; Vite's HMR and Fast Refresh deliver it like any save. The new props
  equal the overridden ones, so the engine gets the same transform again (the
  renderer compares old and new props, `apply.ts:111-117`, `:155-156`, and does
  not read the engine) and the override is superseded by the source.
- **Revert.** Escape restores the fiber's props from source (`overrideProps` with
  the value the source holds) and nothing is written.

### 3.3 Source writer (dev server)

One module owns every write to a `.tsx` under `src` made by the editor or the
editor CLI.

- **Read.** From a source location (§3.1) it reads the file, checks it against
  `sourcesContent`, parses it with the TypeScript compiler API, and finds the
  element.
- **Analyse.** Each attribute's initializer becomes a tree of *slots*:
  - editable: number (with unary minus), string, boolean (a bare
    `simulatePhysics` is `true`), array and object literals of these, enum
    members (`UE.EComponentMobility.Movable`, options from the typings), the
    literal arguments of a call (`colored([0.35, 0.35, 0.38])`);
  - followed: an identifier bound by `const` to a literal in the same module
    (`CUBE`, `STONE`), or an imported `export const`, with the number of other
    uses shown before the edit;
  - passed through: a parameter of the enclosing component (`location={at}`,
    `Player.tsx:100`, `LiveAsset.tsx:25`), resolved to the call site through the
    owner chain;
  - computed: anything else, read-only, labelled with its expression.
- **Write.** Offsets from the TypeScript API are UTF-16 code units of the
  decoded text; the writer splices that string and encodes it back as it was read
  (UTF-8, BOM and line endings kept). Only the changed literal's range is
  replaced; every other character stays. Numbers are written in the shortest form
  that round-trips the value. A missing prop is added as one attribute after the
  last one.
- **No lost update.** There is no lock between processes, so the write is
  compare-and-swap: write a temporary file, read the target again, and rename
  only if it still holds exactly the text that was parsed; otherwise parse again
  and resolve again, or refuse. The window left is between that last read and
  the rename; a writer that bypasses it (another tool's raw write) can still race,
  and git shows both versions.
- **Slots inside expressions.** A value that `overrideProps` cannot preview —
  an argument of `colored([...])` — is previewed by writing the file, at most one
  write in flight, and letting Vite's HMR apply it (median 67 ms, §1.3). There is
  no in-memory copy of a file: what the game shows is always what is on disk.
- **Undo.** The server keeps the history of its own writes per game process (the
  game that committed): file, range, text before, text after. Undo applies the
  inverse only if the range still holds the text after; otherwise it reports the
  conflict. It restores the source, not the runtime: a body that had fallen
  goes back to its spawn transform.

### 3.4 Editor UI (HUD page)

- A panel set in `src/ui/edit/` shown in edit mode, built from the UI kit:
  toolbar (play/pause, move/rotate/scale, local/world, snapping, undo/redo),
  outliner (the `HostNode` tree with source labels and instance counts),
  inspector (the slots of the selected level, live engine values beside source
  values).
- The page talks to its own game only (`bridge.ts`). The game sends source work
  to the server over the `unreal` channel; the server answers that game alone
  with `client.send`, as `vge:content-sync` does (`vge/server.mjs:193`) — not by
  broadcasting, as the eval seam does (`vge/server.mjs:221-264`).
- To check before building our own: whether the React DevTools backend runs in
  the engine's V8 against this renderer (the reconciler already injects
  everything it needs, §3.1). If it does, the Components tree and props panel are
  the outliner and inspector the browser has, and the HUD panels carry only what
  DevTools has no notion of: slots, the gizmo, the engine values.

### 3.5 Agents

A CLI next to `vge/tools/game.mjs` over the same server endpoints: list the
nodes of a running scene with their source locations, read a node's slots, set
a slot, undo. It names the game it talks to (by process, as the dev server's
clients are listed); without a name it refuses when more than one game is
connected. An agent's change goes through the same writer as a drag.

### 3.6 What the web starter kit does, and what follows from it

The reference is the web starter kit (b21b100). It has no scene editor, gizmo or source write-back. What it has is the
native browser loop this design copies:

- stock Vite with `@vitejs/plugin-react` and Fast Refresh (`vite.config.ts`),
  per-module HMR with no reload (`README.md:96`), and not one hand-written
  `import.meta.hot` in its `src`;
- labs (`src/app/labs/devLab.ts`, `labRegistry.ts`, `DevLabRouter.tsx`);
- the rule that keeps Fast Refresh working, as a lint rule:
  `eslint-plugin-react-refresh` with `reactRefresh.configs.vite`
  (`eslint.config.js:4`, `:16`; off only for `ui-kit/**/preview.tsx`, `:52-54`);
- a pause for its own simulation as a prop of the clock
  (`src/shared/lib/simulation/FixedTick.tsx:30-48`).

So: source positions come from React's owner stacks and Vite's maps (§3.1),
previews from React DevTools' override (§3.2), hot reload is stock Fast Refresh,
and a change Fast Refresh cannot apply reloads, as it does in the browser (§5).

## 4. Hard cases

### 4.1 A value that is an expression

The slot tree (§3.3) decides. A location is editable per axis: each component of
a vector moves independently. A rotation is not: Euler angles are not separable
and the gizmo's axes are not Euler axes (a 90° turn about world X of an object at
yaw 45 changes yaw and pitch). A rotation edit is accepted only at a level where
all three components are literal slots; otherwise it is offered at the next level
up (§4.2). The new rotator is the one equal to the dragged rotation that is
closest to the old values, so 270 does not become −90 in the file.

### 4.2 Elements made inside components, loops and maps

Most host elements in the kit are made by components from their props:
`Colonnade` places twenty columns from `at` (`Colonnade.tsx:22-26`), `Stairs`
its steps (`Stairs.tsx:28`), `BoxPyramid` its boxes (`BoxPyramid.tsx:20-31`).
The selected *level* is chosen in the outliner's breadcrumb, built from the owner
chain (§3.1): the host element, or any component call site above it.

- **Translation through a placement prop.** When a location slot is `P + E`,
  `E + P` or `P − E`, where `P` reads a component parameter (`at[0]`) and `E`
  does not depend on it, the parameter is a translation in the frame the
  element's location is in: the world transform of its attach parent. A drag by
  world vector `d` becomes a change of `P` by that parent's inverse rotation and
  scale applied to `d` — exact under rotated and scaled parents. The writer
  follows `const` bindings of the render function
  (`const [x, y] = [at[0] + …, …]`, `Colonnade.tsx:24`). It moves every element
  that reads the parameter: dragging one column moves the colonnade, and the
  preview, being `overrideProps` on the component's fiber, moves all twenty.
- **Full transforms of a component.** Rotation and scale cannot pass through
  `at`. The kit's placing components take the same `location` / `rotation` /
  `scale` props as an element (`ActorElement`, `props.ts`) and render their
  content under a root `<sceneComponent location rotation scale>`; the renderer
  already composes children, actors and packed descendants with a parent scene
  component (`renderer.ts:92`, `:109-110`, `:132-136`, `:208-216`). A gizmo edit
  of such an instance is a plain literal edit of its call site. This is a
  convention of the kit's own components, the way an element is placed already;
  it adds nothing to the renderer.
- **Several instances from one element.** A literal in a component's file is
  shared by every instance of that component and every iteration of a map. The
  editor counts the nodes with the same source location (and the same
  owner-chain prefix for component levels) and shows the count before the edit;
  `overrideProps` on that level previews it on all of them. Per-instance values
  that are not in the source are not created.

### 4.3 Runtime-owned transforms

Physics bodies, characters moved by `CharacterMovement`, actors turned in
`useFrame` (`SpinningCubes.tsx:20-23`) are where the runtime put them, not where
their props say. The inspector shows both. An edit changes the *start* value in
the source and teleports the object to it (`renderer.ts:144`, `:235` pass
teleport `true`); leaving edit mode lets the runtime continue from there.
Simulated components detach from their parent when they simulate (§2.5), so their
props are a spawn transform only.

### 4.4 Effects re-run by the commit's refresh

A commit refreshes the components of the edited file, and every effect of those
components runs again (§1.3). What that does in edit mode:

- a re-run `Possess` (`Player.tsx:52-54`) moves the view target to the pawn, and
  the edit session puts it back on the edit camera in the same frame (§3.2);
  mouse capture does not run while paused;
- frame callbacks and scope timers re-armed by it stay still, because the world
  is paused and the frame dispatch skips them (§3.2);
- effects that spawn engine objects must clean up in their cleanup — the rule
  Fast Refresh already imposes, now exercised on every commit.

### 4.5 Conflicts with an agent editing the same file

- Compare-and-swap writes (§3.3); a target that changed between parse and
  rename is parsed and resolved again, or refused.
- A commit whose element moved is resolved again by structural path (§3.1); an
  ambiguous or missing match is refused with the reason.
- A drag's override lives in the game only; when the file changes under it, the
  HMR update renders the fiber from the new source and the override is gone. The
  UI says so.
- Undo refuses when the range no longer holds what the writer wrote.

### 4.6 Values the source does not hold

A prop absent from the element shows the engine's current value (read from the
object; the prop table gives the property). Editing it adds the attribute. A
nested component prop (`lightComponent={{ intensity: 8 }}`, `LabStage.tsx:22`) is
an object-literal slot; a missing key is added to it.

### 4.7 Materials and what a scrub leaves behind

- A material made by a kit function from a literal (`colored(...)`,
  `surface(...)`, `world.ts:126-162`) is edited through the call's literal
  arguments, previewed by file writes (§3.3).
- Every distinct colour makes a new material instance that is never released
  (the caches on `__vge`, `world.ts:125-135`, `:147`), a new template component
  (`renderer.ts:59-73`, never evicted) and a new pool group (the pool's group list
  only grows, `VgeInstancePool.cpp`). A slider scrub makes dozens. This is a leak
  of today's hot reload as well — any saved colour change adds one — and is fixed
  where it lives: the caches and the pool release what no node uses.
- A material module (a module that calls `defineMaterial`/`defineInstance`,
  detected by `vge/content/contentKind.mjs` and built by the content pipeline,
  `vge/server.mjs:96-123`) is edited in its own file by the same writer; a change
  of its description is cooked as today and arrives through `vge:content`.

### 4.8 Several games on one dev server

Every connected game runs the same modules, so a commit reaches all of them by
HMR, as an edit reaches every open tab in the browser. Selection, edit mode,
overrides and the undo history belong to the game that made them (§3.3, §3.4).

## 5. Keeping one scene open

The browser's rule, kept: Fast Refresh applies what it can, and a change it
cannot apply reloads. The work is in making sure the changes people and agents
make every day are ones Fast Refresh can apply, not in teaching kit modules to
hot-swap themselves.

1. **Game code lives in refresh boundaries.** Component modules export
   components only; constants, hooks and helpers live in `.ts` modules beside them
   (`MannequinLocomotion.tsx:18-37`, `ImportedCharacter.tsx:21-32` today). The
   rule is the web kit's lint rule, `eslint-plugin-react-refresh`
   `only-export-components` (§3.6); a deliberate exception uses plugin-react's
   own `__getReactRefreshIgnoredExports` hook (`refresh-runtime.js:636`).
2. **Kit runtime edits reload, as in the browser.** An edit of the renderer,
   `apply.ts`, `world.ts` or `src/app/*` reloads the program, as an edit of
   react-dom or an app shell reloads a page. No hot swapping of the reconciler,
   no "listen once" tricks: Vite's `HMRContext` already removes a re-executed
   module's old listeners (`module-runner.js:389-398`), so plain re-registration
   is correct. These are edits of the kit, not of a game, and are rare in a game
   session.
3. **Data-only modules that sit on the reload path stop being on it.** The lab
   list (`LABS` in `src/app/labs.ts`, imported by `loadLab` in `scenes.ts`) is
   read from the shell's lab index and loaded by id; an edit of one lab's entry
   need not reach `scenes.ts`. How to cut that import edge is decided in the
   code, with the list's importers listed first.
4. **Render errors stay local.** The scene root renders each top-level child under
   an error boundary; a failing component renders nothing and logs, the rest of
   the scene keeps running, and the next refresh retries it.
5. **Restarts that stay, named:**
   - a hook-signature change remounts that component — the whole scene when it
     is `Scene` itself (`scenes/main/index.tsx`), so state that must survive that
     lives below `Scene`;
   - a dev server restart reloads the program, as Vite's browser client reloads
     the page (`vge/runner/bootstrap.ts:43-45` says so);
   - a dependency re-optimisation reloads; the `unreal` environment's
     dependencies are listed up front (`optimizeDeps.include`,
     `vge/vite/environments.mjs:14-15`, lists React and the reconciler today),
     and the list grows with every dependency game code imports, so that a
     session does not discover new ones;
   - opening another scene, switching scenes from the shell, editing
     `src/main.ts`.

## 6. Staged plan

Every stage is part of the final system and lands complete; later stages build
on earlier ones and replace nothing.

1. **Source locations.** `getInstanceFromNode` and the object → node map in the
   renderer; the server endpoint that maps an owner-stack frame through the module
   graph; the owner-chain query on the eval seam. Checked by numbers: every node
   of the main scene resolves to an element of its tag, and the nanite lab's
   nodes past the 10 000 limit resolve after `scheduleUpdate`.
2. **Source writer.** Read, slots, compare-and-swap write, refusals, structural
   resolution, per-game undo, the CLI. Checked on the kit's scenes: an edit of
   every slot kind changes only its range, including in a file with non-ASCII
   text (`features/demo/labs/nanite/index.tsx:13`), and the game's props equal the
   new values after the refresh.
3. **Hot reload that keeps the scene.** §5 items 1, 3, 4: the lint rule and the
   moves it asks for, the lab-manifest edge, the error boundary; and the
   material, template and pool-group release (§4.7). Checked with
   `vge/tools/measure-hmr.mjs`-style runs: an edit of every game module applies
   without `vite:beforeFullReload`, and a physics body's position and the actor
   and group counts are unchanged across them.
4. **Pause.** `SetGamePaused`, the paused-aware frame dispatch
   (`tickEvenWhenPaused`), scope timers on game time, the kit's bare timers moved
   to scope timers.
5. **Edit session.** Edit camera and view target, picking (traces, packed
   instances by transform, bounds), preview by `overrideProps`, the TypeScript
   gizmo, highlight, commit and revert.
6. **Editor UI.** The HUD panels, or the DevTools backend plus the panels
   DevTools lacks (§3.4), decided by the check there.
7. **Placement convention.** The kit's placing components move from `at` to
   `location` / `rotation` / `scale` under a root scene component; the
   `dev-lab-authoring` skill and the README's scene section say so.

## 7. What is built (2026-10-28)

Pause, the edit camera, picking, selection with an outline, a Blender-style
gizmo for move, rotate and scale, write-back into the TSX through HMR, and undo.
All TypeScript; no C++ was changed.

The editing UI is contextual and made for people: a Play / Edit switch in the
shell's title bar, the gizmo and the outline in the view, and nothing else — no
panels, no object list, no hint bar. Agents do not use it; they edit the JSX.

### Using it

In a dev game (`npm run dev`, then the shell):

| Input | Does |
|---|---|
| Play / Edit in the shell's title bar, or F8 | enter / leave edit mode, as Unreal's eject from the player: the world keeps running, the player's input is held (the character stands, the mouse is not captured, the lab camera stays), the view moves to the edit camera; leaving gives the view and the input back and resumes a paused world |
| Pause / Resume in the title bar (shown in edit mode), or the Pause key | pause or resume the world while editing, as Unity's and Unreal's pause button; edits to props show at once in a running world, and in a paused one only once something evaluates them again |
| G, R, S | choose the move, rotate or scale tool; they move nothing by themselves |
| left click | select the object under the cursor (actors, components, packed instances) |
| Shift + left click | add the object to the selection, or take it out |
| left drag on a gizmo part | move along an axis or in a plane, rotate about an axis, the view or freely, scale on an axis, a plane or uniformly; on release the edit is written into the source |
| during a drag: Ctrl, Shift, digits, Enter, Escape or right button | snap (1 m, 5°, 0.1), precision, a typed value, confirm, cancel |
| Alt + left drag, middle drag, wheel, right button + WASD/Q/E | orbit, pan, dolly, fly (`OrbitCamera`, as in Unity) |
| Ctrl + Z, Ctrl + Shift + Z | undo, redo the last write this game made |

`globalThis.vgeEdit.state()` reads the session's state through the eval seam
(`node vge/tools/game.mjs`); it changes nothing.

### Input layers

`src/shared/input/` is the kit's keymap, written as React components:

```tsx
<InputLayer name="Edit">
  <KeyBinding keys="G" label="Move tool" run={() => setTool('move')} />
  {gizmoHovered && (
    <InputLayer name="Gizmo">
      <KeyBinding keys="LMB" label="Drag the gizmo" run={dragGizmo} />
    </InputLayer>
  )}
</InputLayer>
```

- A layer is live while its component is mounted. Which layers exist is decided
  by the React tree: while the camera flies, `EditBindings` renders only the
  exclusive `Navigate` layer, so no edit key can fire.
- A nested layer is asked first; among siblings the last mounted is asked first.
  An `exclusive` layer cuts every layer below it.
- A running modal operation (the gizmo drag, `transform.ts`) takes every event
  before any layer, with its own keymap (`defineModalKeymap`).
- Events are Blender's: PRESS, RELEASE, CLICK, CLICK_DRAG (3 px), DOUBLE_CLICK
  (350 ms), key repeat (`events.ts`). A binding can be rebound or turned off by layer and label
  (`setBindingOverrides`).

### The prop card

With one object selected, a card appears beside it in the game's HUD with the
props of the component that rendered it, and goes when the selection does.
Every prop of the component is there; nothing has to be registered for it.

- **Which component.** The selection's owner chain (`ownerChainOf`, the host
  element and every function component above it that has a source location).
  The card opens on the component nearest the scene, the call the scene or lab
  itself writes (for the girl player: `TripoGirl`, not the `Player` it
  renders); when more than one is located, a row of buttons at the top switches
  to another.
- **Picking.** A click is traced by object type (WorldStatic, WorldDynamic,
  Pawn, PhysicsBody, Vehicle, Destructible), not by the Visibility channel: a
  character's capsule and mesh ignore Visibility (`CharacterMesh` profile), so a
  Visibility trace went through her and the click selected nothing.
- **Which props.** The attributes written at the component's call site and the
  names destructured in its first parameter, with their literal defaults
  (`vge/edit/propSource.mjs`, `componentProps`), merged with the props the
  component holds at run time. Props whose values are not plain data (engine
  objects, functions, elements) are left out.
- **Metadata**, in the form of Storybook's `argTypes`, attached to the component
  with `defineEditable` from `src/shared/react`:

  ```tsx
  defineEditable({
    component: SpinningCubes,
    title: 'Spinning cubes',
    argTypes: {
      count: { control: { type: 'range', min: 1, max: 10, step: 1 }, description: 'How many cubes stand in the row' },
      degreesPerSecond: { name: 'Spin', control: { type: 'range', min: -360, max: 360, step: 5 } },
    },
  });
  ```

  The fields are Storybook's: `control` (a type, or `{ type, min, max, step,
  labels }`, or `false` to hide the prop), `name`, `description`, `options`,
  `table.readonly`, `table.disable`. The call stays in the component's module
  and is not exported, so the module stays a React Refresh boundary.
- **Controls.** A number with `min` and `max` (or `control: 'range'`) is a
  slider; another number is a Blender-style field: drag sideways, Shift for
  precision, click to type, Enter, Escape. A vector of 2-4 numbers is a row of
  such fields, a boolean a toggle, `options` a choice, a string a text field. A
  plain object is a group of its entries.
- **Dictionary keys.** `keys` on an `argType` (a list, or a function of `{ props, object }`) names every entry the card shows for a dictionary prop, written or not; an entry without its own value shows `template` (also a function of `{ props, object }`), which for `TripoGirl` is the clip-wide `armSpace` / `legSpace`, so each row shows the value that applies. `TripoGirl` lists the clips of its built PoseSearch databases (`useDatabaseClipNames`, `entities/motionClip.ts`): a motion-matching module (one that calls `defineMotionMatching`) reaches the game only as its `defineMotionMatching` exports, so a clip list exported beside them does not.
- **Live key.** A prop whose value is a dictionary can name the entry that
  matters now: `liveKey: ({ props, object }) => string | undefined` on its
  `argType`, called every frame with the component's props and the selected
  engine object. The card shows only that entry, marked "current clip", and
  writes into it; its fields are `template` merged with the entry, or the first
  entry when there is no `template`, each shown with the control from
  `fields[name]`; the first write to a missing entry adds it. This is for
  settings per animation clip, where the prefab knows which clip is playing:
  `TripoGirl` has `clipPosture={{ walk_loop: { arm: 6 } }}`, its `liveKey` is
  the clip motion matching selected (`currentClipOf`,
  `src/features/character/entities/motionClip.ts`, from
  `VgeScriptLibrary.DescribeMotionMatching`), and its posture eases to the
  playing clip's arm and leg space, falling back to `armSpace` / `legSpace`.
- **Layout.** The card sits beside the selection's screen-space bounds (32 px
  right of its right edge, or left of its left edge when the right has no
  room) and in the middle of the screen vertically, no taller than the screen;
  longer content scrolls. The place is worked out again only when the view
  changes (camera location to 1 cm, rotation to 0.1°, field of view, viewport
  size) or the selection does; an animated pose that widens the bounds under a
  still camera does not move the card.
- **Traffic to the HUD.** The card's content (`edit/card`) is sent only when it
  changes and its place (`edit/card-place`, snapped to 4 px) separately; the
  HUD sets the place on the element's style without a React render. Sending
  the whole card each frame was measured at 44 messages a second of 3.1 KB,
  each re-rendering the card, and the card lagged; after the split, with the
  girl selected and idle: 0 content and 0.3 place messages a second.
- **Why every HUD felt slow, and what the HUD's frame rate is.** The HUD page
  itself ran at 60 frames a second with no long tasks (`vge:hud-probe` in
  `src/ui/bridge.ts`: the game asks, the page counts its `requestAnimationFrame`
  frames and long tasks and posts `vge:hud-probe-result`; with `repaint: true`
  it repaints a 2 px marker every frame). Its frames reach the screen once per
  game frame: the engine pumps CEF from the game thread
  (`external_message_pump`, `WebBrowserSingleton.cpp:340`,
  `FCEFBrowserApp::TickMessagePump`) and copies each frame with a GPU sync
  (`CopySharedTextureSync`, `CEFWebBrowserWindowRHIHelper.cpp:295`); measured,
  a page repainting every frame cost the game 1 ms (22.5 to 23.5 ms). The lag
  was the data: `useHudState` sent a lab's state every 200 ms, and the lab
  sliders showed the value the game sent back, so a dragged slider moved five
  times a second. Now `useHudState` sends each frame the state changed (else
  every 500 ms, inside `useGameState`'s 1 s staleness), and `ControlSlider`
  shows the dragged value until the game's value follows.
- **The HUD presented at 15 frames a second.** Even so the user saw every part
  of the HUD (a dragged slider, hover, the card following the object, the
  numbers) at about 15 frames. The engine runs CEF on an external message pump
  driven from the game thread and forces that pump at most
  `[Browser] MaxForcedMessageLoopHertz` times a second, default 15, clamped to
  60 (`WebBrowserSingleton.cpp:880-935`); input to the page and the page's
  frames to the screen both wait for a pump. `unreal/Config/DefaultEngine.ini`
  sets it to 60. A game message answered by the page took 14-26 ms (median 17)
  round trip (`vge:hud-echo` in `src/ui/bridge.ts`), which a reply pumps on its
  own and so did not show the limit.
- **Preview and write.** Dragging a control previews through the renderer's
  DevTools `overrideProps` at the prop's path (`overridePath`); releasing it
  writes the literal at that path through the dev server (`commit` with a
  `path`): a number, a boolean, a string, an array or an object, inside nested
  object literals and inside a `const` of the same file; a missing attribute is
  added at the call site, a missing key is added to its object. Escape, or a
  refused write, puts the value back. Undo and redo are the same as for the
  gizmo.
- **Where it lives.** `src/shared/react/editable.ts` (`defineEditable`),
  `src/app/edit/propCard.ts` (rows), `src/app/edit/propCardSession.ts` (sends
  `edit/card` to the HUD, takes `edit/prop` and `edit/level` back),
  `src/ui/hud/EditPropCard.tsx` (the card), the kit's `ControlNumber` and
  `ControlText` (new) and `ControlSlider` (its `onCommit`, new),
  `vge/edit/propSource.mjs` (reading and writing literals at a path).

### Selection outline

The editor's selection outline is editor-only (§2.6), so the session draws its
own, as a game would:

- The selected meshes are drawn again, alone, by two depth captures spawned for
  edit mode (`selectionLook.ts`): one `SceneCapture2D` for the selection
  without the active object, one for the active object. Each has
  `PRM_UseShowOnlyList`, `SCS_SceneDepth` into an `RTF_R32f` target the size of
  the viewport, is attached to the view camera, captures every frame and ticks
  while paused.
- A capture's field of view is horizontal over its target. The game view's is
  not: the local player keeps the vertical angle (`AspectRatio_MaintainYFOV`,
  `BaseEngine.ini:2900`), computed from the camera's 90° at the camera's aspect
  1.78 and widened to the viewport (`CameraStackTypes.cpp:286-333`), 93.1° on
  1280 x 682. With 90° the capture drew the selection 1.056 times larger about
  the screen centre, so the outline slid off the object more the farther it was
  from the centre: a right edge at 1016 px in the view read 1036 in the capture.
  The capture now gets the view's horizontal angle by the same rule. Read again,
  the edges agree to 0-4 px; the view's side of that check is a line trace
  against the collision mesh.
- The captures exist because the stencil cannot give a steady line. Custom
  depth and stencil are drawn at render resolution with the temporal jitter of
  TSR; a post-process material after tonemapping runs after TSR
  (`PostProcessing.cpp`, TSR around :1109-1190, the after-tonemapping chain at
  :1676), so an edge read from the stencil moved by a fraction of a pixel each
  frame and the 2 px line shimmered. Unreal's own editor draws its selection at
  the unscaled output size with the jitter off
  (`PostProcessCompositeEditorPrimitives.cpp:26`). A capture has no jitter when
  its view has no temporal anti-aliasing: the view's method is none when the
  family's `AntiAliasing` or `TemporalAA` show flag is off (`SceneView.cpp:1176`),
  and jitter needs a temporal method (`SceneVisibility.cpp:5249`). Both flags are
  off in the captures, with the lighting, shadow, fog and post flags a depth
  image does not need.
- The selected meshes still get `renderCustomDepth` and a custom depth stencil
  value (1 selected, 2 active) as a preview prop override; leaving the selection
  puts the source's values back. This is what moves a selected packed instance
  into its own instance group, and the capture shows only the instance
  components whose stencil is the one asked for.
- An unbound post-process volume spawned for edit mode blends a dynamic instance
  of `outline.tsx` with the two targets as `selectedDepth` and
  `activeDepth`, after tonemapping, one texel of the target per output pixel
  (`PostProcessInput0`'s `InvSize`). A pixel holds the active object where its
  depth is captured and not behind the selection's, otherwise the selection
  where captured (depth below 1e7 cm; an empty pixel reads 1e13). It follows
  Blender's outline detection
  (`draw/engines/overlay/shaders/overlay_outline_detect_frag.glsl`): a pixel is
  on the outline when one of its four neighbours holds a different id, on both
  sides of the silhouette, so the line is 2 px wide. Its colour is the pixel's
  own id, or the neighbour's outside the object, in Blender's theme colours
  (selected `#f15800`, active `#ffaa40`) at alpha 254/255. Where the captured
  depth is behind scene depth the line is drawn at alpha 0.35, as Blender draws
  an occluded outline (`overlay_outline.hh`, `alpha_occlu`).
- Blender doubles the line when `U.pixelsize > 1` (`do_thick_outlines`). The
  game cannot read that factor from TypeScript (UMG's viewport scale is a DPI
  curve over the window size, 0.63 here, not the screen's scale), so the 2 px
  line is the only one.

Read in the running game with the flight case selected, 864 cm from the camera:
both targets 1280 x 682 as the viewport, attached to the edit camera's
`CameraComponent` at the camera manager's location, field of view 90; the
active capture showed one component, the other none. Read through a
temporary `RTF_RGBA32f` target (`ReadRenderTargetRawPixel` does not read
`R32f`): 766 cm at the case's centre, 749-782 across it, 1e13 outside it. The
volume blended `MID_Outline` of
`/VgeLive/Materials/Outline_bbebf7096b81/Outline.Outline`.

### Where it lives

- Edit mode and pause: `src/app/edit/editPause.ts` (`setEditPaused`), `src/shared/engine/gameInput.ts` (`holdGameInput`, `isGameInputHeld`: `Player`, `wantMouseCapture` and a lab's `OrbitCamera` read no input while it is held). Pause: `src/shared/engine/pause.ts` (`pauseWorldKeepingCamera`, `resumeWorld`,
  `isWorldPaused`). The frame dispatch in `src/shared/engine/world.ts`
  (`onFrame`, `everyFrame`) and `useFrame` in `src/shared/react/hooks.ts` skip
  callbacks while the game is paused unless they pass `tickEvenWhenPaused`.
  `useEvery` / `useAfter` are game-time timers built on it; `SphereRain`,
  `Dominoes` and the mannequin lab use them instead of bare V8 timers. `every`
  in `world.ts` stays a V8 interval (the fixed-step lab shows its stutter on
  purpose) and is not paused.
- Renderer: `createInstance` keeps the fiber on the `HostNode`; the renderer
  keeps engine object → node and the shown packed nodes
  (`nodeOfObject`, `shownPackedNodes`, `packedWorldTransformOf`,
  `parentWorldTransformOf`); `getInstanceFromNode` returns the fiber.
- DevTools hook: `src/app/refresh.ts` makes the refresh preamble's hook keep
  `renderers` as React DevTools' own hook does, so the edit session reaches the
  scene renderer's `overrideProps`.
- Shell: `src/ui/shell/EditModeToggle.tsx` in the title bar; the dev server
  relays `vge:edit-mode` to the game on the shown scene and `vge:edit-mode-state`
  back.
- Game side, `src/app/edit/`:
  - `editSession.ts` — mode, the frame loop, the gizmo's placement and hover.
  - `EditOverlay.tsx`, `EditBindings.tsx`, `KitBindings.tsx` — the edit camera,
    the bindings, the F8 binding that lives outside edit mode.
  - `editActions.ts` — select, tools, gizmo drag, undo and redo.
  - `transform.ts` — the modal transform: Blender's axis and plane projection of
    the cursor's motion in the view plane, rotation, trackball, scale, snap,
    precision, typed values.
  - `propPlan.ts` — which prop at which level receives a delta, fixed at the
    start of a drag; preview, revert, commit.
  - `TransformGizmo.tsx`, `gizmoParts.ts`, `gizmoView.ts`, `gizmoMath.ts`,
    `gizmo.tsx` — the gizmo's parts, sizes and colours from Blender's
    source (75 px, 2 px lines, `#ff3352` / `#8bdc00` / `#2890ff`).
  - `selectionLook.ts`, `outline.tsx` — the outline.
  - `picking.ts`, `devtools.ts`, `channel.ts`, `editState.ts`.
- Server side: `vge/edit/` — `plugin.mjs` (operations `inspect`, `commit`,
  `undo`, `redo`, `stats`, replies to the asking game with `client.send`),
  `sourceLocator.mjs`, `tsxSource.mjs` (TypeScript 6 API: element at an offset,
  the vector analysis of §4.2, literal edits), `writer.mjs` (compare-and-swap
  write, per-game undo).

### The source locator is one replaceable part

`createSourceLocator` in `vge/edit/sourceLocator.mjs` turns an element's creation
stack (React's `_debugStack`) into file, line, column and offset, through the
module map the dev server keeps (§3.1). Everything else calls only its
`locate(stack)`. To try a way without sourcemaps, replace this module; the
inspector, writer and undo do not change. When it cannot locate a frame it says
at which step (no module, no map, no original position, no source text), and
`inspect` returns that as a reason.

What the module runner needed for it: its code runs through `new AsyncFunction`
with no module name, so stack frames carried none. `sourceUrlPlugin` (same
file) appends `//# sourceURL=<module id>` to every `src/**/*.tsx` module in the
`unreal` environment, the line Vite itself writes when it inlines maps
(`node_modules/vite/dist/node/chunks/node.js:36321`). The line offset of the
function wrapper is computed the way the runner computes it
(`module-runner.js:25-27`, `:819`).

The map is the one of the code the game executed. When a module changes, Vite
invalidates its importers as well (`invalidateModule`,
`node_modules/vite/dist/node/chunks/node.js:36805-36826`) and sets their
`transformResult` to null, but only the HMR boundary is executed again. A soft
invalidation keeps the previous result in `invalidationState`, and the locator
reads it from there.

Measured in the main scene (`vgeEdit.locatorStats()`, earlier slice):
26 lookups, 10.2 ms in total, 0.39 ms on average, 0.047 ms for the last one
(the first lookup of a module builds its decoder). Maps held by the dev server:
53 modules, 2.74 MB of mappings and source text; the decoded consumers kept per
map are on top of that and are not measured.

### Checked in the running game

All numbers read from the game with `vge/tools/game.mjs`, the file compared with
a copy taken before:

- Enter edit mode: `IsGamePaused` true, view target `CameraActor`. Leave with F8:
  paused false, view target `Character`.
- The edit camera moves while paused: mouse wheel over the game window moved it
  from (-851, 38, 275) to (-537, 16, 221).
- Select the flight case: `<staticMeshActor> src/features/demo/entities/LiveAsset.tsx < <LiveAsset> src/scenes/main/index.tsx`;
  the location is passed through `at` to the call site, rotation and scale are
  written on the host element.
- A real mouse drag on the Z arrow wrote the new `at` on the call site, the only
  changed line; Ctrl + Z restored the file byte for byte.
- A real click on a colonnade column selected the packed instance:
  `<staticMeshComponent> src/features/world/entities/Colonnade.tsx < <Colonnade> src/scenes/main/index.tsx`.
- Layers, dispatched in the shell's main world: with the right button held only
  `Navigate` was live and S did not change the tool; after release G, R and S
  switched it.

### Found on the way

- **The eval seam could deadlock the game's HMR.** The module runner handles
  HMR messages one at a time and waits for each custom-event listener
  (`node_modules/vite/dist/node/module-runner.js:829-869`). The seam's
  `vge:eval` listener awaited the evaluated expression; an expression that
  waits for another message (here `vge:edit-reply`) waited behind itself, and
  every later message, HMR updates included, queued forever. The listener now
  starts the evaluation and returns (`src/app/debug-seam.ts`).
- **A drag compounded.** The plan was rebuilt each frame from props the preview
  had already changed, so each frame added its delta to the last one. The values
  a drag starts from are now fixed when it starts (`propPlan.ts`, `resetPlan`).
- **Moves stopped after a rotation or scale was written.** Writing
  `LiveAsset.tsx` invalidated `index.tsx` as its importer; its `transformResult`
  was null, so the call site holding `at` was not located and every move was
  refused. Fixed in the locator (above).
- **The overlay highlight was not seen** (§2.6); replaced by the outline. The
  first outline was 1 px on the outside only and hid occluded parts; it read as
  dim and was rebuilt to Blender's detection above.
- **A move reset a rotation the game had set.** The renderer's `update` wrote
  location, rotation and scale from the props whenever any of them changed, so
  writing `at` put the flight case back to the JSX rotation its `useFrame` had
  turned away from. It now writes only the parts whose props changed
  (`src/shared/react/renderer.ts`, `writeChangedActorTransform`,
  `writeChangedRelativeTransform`). Read in the game: yaw set to 77, `at` raised
  by 10 cm and back, yaw stayed 77.
- **The outline slid off the object away from the screen centre**: the
  capture used the camera's 90° as a horizontal angle (above).
- **The 2 px outline shimmered.** It was read from the custom stencil, drawn
  at render resolution with TSR's jitter, after TSR; it is now read from the
  unjittered depth captures above.

### Not built yet

Structural re-resolution when the file changed under a selection (today the
commit is refused with a request to reselect), the lab-manifest and
error-boundary items of §5, and an HTTP endpoint for agents outside the game.
