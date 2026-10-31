---
name: visual-verification-gate
description: Define and execute visual acceptance before, during, and after any task that can change what the running Unreal game shows — scenes, labs, 3D assets, materials, lighting, animation, or the in-game HTML UI. Use before editing a visual surface, for redesigns that must be proven in an isolated lab before integration, after visual feedback, and before claiming a visual result complete.
---

# Visual Verification Gate

Treat visual verification as part of implementation, not as a final optional check. Define the evidence and pass criteria before changing files, prove redesigns in isolation, then repeat the proof in the integrated product.

## Non-negotiable rules

- Write a visual test contract before the first edit.
- Never use a non-rendering or software-rendered surface as visual evidence: a `-nullrhi` game process (`npm run play -- --headless`), a log line, an HTTP response, or a `src/ui` page opened in a desktop browser instead of inside CEF (the game's HUD, or the shell's page in `npm run shell`). (The web kit's form of this rule: never headless browsers, software GL or SwiftShader.)
- Never claim visual success from `npm run typecheck`, `npm run build:cpp`, a `node vge/tools/game.mjs` number, `node vge/tools/ui.mjs text`, DOM inspection, or console output alone.
- Never claim a capture was checked until it was opened and visually inspected.
- Never skip visual verification because a preferred tool is absent. Discover what can capture the game window, then use it.
- Use the already-running dev server (`npm run dev`). Never start, stop, kill, or restart it to get a change in; rely on hot reload — game modules re-run in every connected process, `src/ui` reloads in CEF, a saved model file that the game code imports is rebuilt and mounted.
- Save temporary reviewable evidence under the local Git-ignored
  `wip/<task-slug>/`; never commit captures or place them under `docs/` unless
  the user explicitly asks for a durable documentation artifact.
- Block integration until the isolated visual gate passes.
- Re-run the visual gate after every fix that changes the rendered result.

## 1. Write the visual test contract

Before editing, state this contract in the working plan or commentary:

```text
Visual test contract
- Surface: scene, lab, entity, asset, material, animation, or UI panel being changed
- Baseline/reference: current frame, supplied design, screenshot, or explicit invariant
- Isolated proof: lab (`npm run play -- --lab <id>`) and the states to inspect
- Integrated proof: real scene (`npm run play`, or `-- --scene <id>`) and surrounding systems to inspect
- Coverage: window sizes, camera views, interaction states, content extremes, and motion samples
- Tool path: how the rendered game window is captured; `node vge/tools/ui.mjs` for UI state; `node vge/tools/game.mjs` for the numbers behind the frame
- Evidence: local `wip/<task-slug>/` paths for baseline, isolated, and integrated captures
- Pass criteria: concrete visual properties that must be true
```

Do not use “looks good” as a criterion. Name observable properties: alignment, hierarchy, silhouette, spacing, cropping, contrast, occlusion, state feedback, layout at each window size, animation continuity, or reference drift.

Mark visual verification `N/A` only when the scoped task cannot alter any rendered surface or visual artifact. Tool unavailability is never a valid `N/A` reason. When uncertain, treat the task as visual.

## 2. Resolve the verification tool path

Use this order:

1. Inspect the tools already available in the current session.
2. Use `tool_search` to discover deferred desktop-capture, computer-use, Blender, or other relevant MCP tools.
3. Prefer a tool that captures the real `VibeGameEngine` game window on the real GPU (the kit ships no capture tool of its own; any screen capture of that window is valid evidence).
4. Start the surface with `npm run play` (windowed; `-- --width`/`--height` set the window size, 1280×720 by default) or `npm run play -- --lab <id>`; `vge/tools/play.mjs` prints the pid and the log path.
5. For the in-game UI, drive state with `node vge/tools/ui.mjs click | select | eval` over CDP (`npm run play` passes `-cefdebug=9222`), then capture the game window — the page inside CEF over the rendered game, not the page alone. For the dev shell's page (`npm run shell`), point the same tool at its DevTools port (`VGE_CDP=http://127.0.0.1:9221`) and capture the shell window.
6. Prefer repository-defined tools under `vge/tools/` or `package.json`; do not substitute a `-nullrhi` process or a desktop browser for the rendered game.

Do not answer “visual verification is impossible because no tool is available.” Continue down the ladder. If authentication or another external dependency blocks one path, try the next in-scope path and report only the concrete remaining blocker after exhausting the ladder.

## 3. Capture the baseline

- Open the current target in a rendered, GPU-backed game window.
- Reproduce the exact state that the change will affect (through the debug seam — `world-debug-seam` — not by playing to it).
- Capture the current frame before editing.
- Open and inspect the capture; record existing defects separately from the requested change.
- If a reference exists, establish the same crop, window size, camera, state, and lighting before comparing.

The baseline prevents accidental regressions and makes before/after evidence meaningful.

## 4. Prove the change in isolation

For a redesign or new visual element:

1. Use an existing lab (listed in `LABS` in `src/app/labs.ts`).
2. If none exists, create the smallest production-representative lab before integrating the feature (`dev-lab-authoring`).
3. Render real entities, assets, materials, effects, and state logic; do not approve a disconnected mock.
4. Exercise all relevant states and boundary content.
5. Capture and inspect each required window size/camera/state.
6. Fix failures in the lab and repeat the capture.
7. Integrate only after every isolated hard gate passes.

For 3D scenes, use the dedicated DEV authoring camera (the lab stage's camera, `<LabStage camera={...} />`) and inspect rendered front, side, and back views before mounting the unchanged player. Never alter player scale, entity root scale, or the shared camera to make the composition pass. During authored placement work, inspect a new rendered frame after each placement step.

For motion, inspect representative key frames plus the transition in real time in the window. A still frame alone cannot approve timing, easing, flicker, popping, or continuity.

## 5. Run the isolated gate

Require all applicable checks:

- Composition and hierarchy match the stated intent.
- Alignment, spacing, sizing, and typography are stable.
- Colors, contrast, materials, lighting, and effects are intentional.
- No clipping, overflow, texture stretch, missing asset, z-fighting, or occlusion defect is visible.
- Default, hover, focus, pressed, selected, disabled, loading, empty, error, and overflow states are checked when applicable.
- Smallest supported, representative, and largest supported window sizes are checked (one window per size, `npm run play -- --width <w> --height <h>`).
- Long text, localization, extreme values, and safe-area constraints are checked when applicable.
- Motion has no flicker, pop, discontinuity, or unintended layout shift.
- The inspected capture is saved under `wip/<task-slug>/`.

Any failed hard gate returns the task to the isolated lab. Change one visual cause at a time, capture again, and keep the failed evidence available for comparison unless the user authorizes deletion.

## 6. Integrate and verify in context

After isolated acceptance:

1. Mount the accepted result in the real scene without changing the accepted contract.
2. Reproduce the same states, window sizes, cameras, and interactions.
3. Check surrounding layout, world composition, z-order, occlusion, input hit areas (`data-hit` regions of the UI against the game's own input), transitions, and neighboring features.
4. Confirm real data, localization, assets, lighting, camera, player, and window sizes do not change the result unexpectedly.
5. Check adjacent states likely to regress.
6. Capture and inspect integrated evidence.

An isolated pass is not an integrated pass. Both are required for a redesign.

## 7. Close the verification loop

Report visual acceptance only when the evidence supports it. The handoff must include:

- the lab and the integrated scene that were inspected;
- the capture tool path used;
- window sizes, camera views, states, and interactions covered;
- local `wip/<task-slug>/` paths to baseline, isolated, and integrated evidence;
- pass/fail status against the original criteria;
- any remaining visual risk or exact blocker.

Use “compiled but not visually verified” when only static checks ran. Use “visually verified” only after inspecting captures of the rendered game window.

## Checklists

### Before editing

- [ ] Visual test contract is written.
- [ ] Baseline/reference and concrete pass criteria are fixed.
- [ ] Isolated (lab) and integrated (scene) verification surfaces are identified.
- [ ] Relevant states, window sizes, cameras, content extremes, and motion samples are listed.
- [ ] A way to capture the rendered game window was found (session tools or `tool_search`).
- [ ] Existing dev server will be reused.
- [ ] Evidence directory `wip/<task-slug>/` is selected.

### Isolated acceptance

- [ ] Real production entities/assets are rendered in a lab.
- [ ] Baseline and reference conditions are reproducible.
- [ ] All applicable visual and interaction states were exercised.
- [ ] Window-size boundaries or required camera views were inspected.
- [ ] Motion was watched in real time when applicable.
- [ ] Captures were opened and visually inspected.
- [ ] All hard gates pass before integration.

### Integrated acceptance

- [ ] The accepted isolated result is mounted in the real scene.
- [ ] The same coverage was repeated in context.
- [ ] Neighboring layout, systems, input, camera, lighting, and occlusion were checked.
- [ ] No player, shared-camera, or root-scale shortcut was used.
- [ ] Adjacent regression states were inspected.
- [ ] Integrated captures were opened and visually inspected.

### Final handoff

- [ ] Baseline, isolated, and integrated evidence lives in local `wip/<task-slug>/`.
- [ ] Evidence paths, tool path, states, and window sizes are reported.
- [ ] Visual pass/fail is stated against the original contract.
- [ ] Static validation is reported separately from visual validation.
- [ ] No known visual failure from the current work remains unresolved.
