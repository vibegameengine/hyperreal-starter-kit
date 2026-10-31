# Agent Entry Point

## ⛔ ABSOLUTE RULES (read first, no exceptions)

Every rule below carries the incident that produced it, and those incidents
happened in the game the web starter kit was distilled from — a browser game
(three.js / WebGPU, React, Vite) whose agent workflow this Unreal Starter Kit
inherits. Where an example names an arena, a wave, a mob or a route, that world
is not in this repository — the number and the mechanism are what transfer, and
they were measured, not imagined. The rules themselves apply here without
exception.

This kit runs Unreal Engine 5.8 as a runtime-only renderer (never the editor);
game code is TypeScript in `src`, the UI is React in `src/ui` shown in the
game through CEF, and one Vite dev server (`vge/server.mjs`) serves and
hot-reloads both. See [README.md](./README.md). Where a rule's mechanics were
specific to the browser, a **Here:** paragraph says how the rule maps onto this
kit. The rule numbers are the web kit's numbers, unchanged.

### Before any change: read the README, then pick the layer

Read [README.md](./README.md) in full before the first change: it says how scenes,
content, labs, materials, animation graphs, profiles and builds work here, and most
of what an agent sets out to build already exists. Then change the **first layer
that can do the job**, and go down a layer only when the one above has been shown,
from the code, unable to do it:

| Layer | Where | What belongs here |
|---|---|---|
| 1. Game TypeScript and React | `src/features/<game>`, `src/ui` | Scenes, mechanics, rules, AI, input, camera, UI on the HUD page, labs, per-frame visuals (instanced meshes moved every frame for rain, dust, debris), anything the engine exposes to reflection: every class, function and property in `unreal/Typing/ue/ue.d.ts`, every component and actor class as a JSX element (`unreal/Typing/ue/ue-jsx.d.ts`). The labs show how; start from them. |
| 2. Assets and the content pipeline | the source files (Blender, any DCC), `vge/content`, `vge/vite` | A wrong scale, skeleton, animation unit, pivot or material in an imported file: fixed in the file or in the import step. A new kind of content (a material, a particle effect, a sound): created and cooked by the content service in the editor process and mounted as DLC, the way materials from TSX are (a module calling `defineMaterial` from `src/shared/material`, `VgeMaterialBuilder`), never assembled inside the running game. |
| 3. The kit's shared TypeScript and tools | `src/shared`, `vge/tools`, `vge/server.mjs` | A wrapper every game would need, or a bug in a kit tool. Portable, kept out of game code. |
| 4. The kit's C++ | `Source/` (content-service tools in `VibeGameEngineTools`, the game runtime in `VibeGameEngine`), built in a profile | Only what layers 1-3 cannot reach, shown in the code: which function or data is not exposed to reflection, or which engine path needs native code. Every C++ change rebuilds the runtime for every kit on the machine: **agree it with the user before writing it.** |

Not layer 4: content the game does not have yet (bring it in through layer 2 or
build it from what layer 1 has), an asset that imports wrong (layer 2), a behaviour
nobody asked for. Measured: agents making a game on this kit spent a night
rebuilding the runtime for a native particle factory, native window focus, native
bone inspection and native animation-unit normalization; all of it was reverted,
and the animation units were then fixed in the asset step without C++.

0. **COMMIT. As soon as a coherent piece works — commit it. Do not wait to be
   asked.** Not at the end of the task, not when the whole feature is finished,
   not "once it is proven": the moment a piece compiles and does something, it
   goes into git.
   - **If anyone else works in this tree — another person, another agent session
     — then especially.** Uncommitted work has no history, no diff and no way
     back: `git log -- <file>` on an untracked file prints nothing, so when it
     breaks nobody can tell what changed or who changed it. Alone in a tree the
     rule costs you nothing and still gives you the diff.
   - Measured: a whole navigation system - six files - sat untracked for three
     hours while another session edited one of those files underneath it. For
     twenty of those minutes the tree did not compile, and the question "what
     broke it" had no answer to give, because there was no baseline to diff
     against.
   - Asking permission to commit is not caution, it is the delay itself. This
     rule is the permission. Commit on a branch, never straight to `main`.

1. **NEVER judge a frame from a process that does not render.** In the web kit
   this rule read: never run the app headless — no headless browsers, no
   headless/software-GL (swiftshader) rendering, for any reason, ever, because
   headless WebGL/WebGPU results are misleading and must never be used to judge
   or claim that anything works. The intent is unchanged: a result from a
   surface that is not the real renderer on the real GPU is never visual
   evidence.
   - **Here:** `npm run play -- --lab <id> --headless` starts `VibeGameEngine.exe` with
     `-nullrhi` (`vge/tools/play.mjs`): no renderer at all. That process is
     legitimate for one thing only — reading state as numbers with
     `node vge/tools/game.mjs "<expr>"` (positions, counts, script timings). It shows
     nothing, and any number that depends on rendering — GPU time, frame pacing,
     Nanite, Lumen, shadows, materials, anything a player sees — is invalid
     there. Never claim that something looks right, or renders, from a
     `-nullrhi` process.
   - **Visual confirmation happens in a rendered game window** — the world the
     dev session's shell shows (`npm run dev` opens it; `npm run open -- labs/<id>`
     or `npm run open -- main` puts your scene in it), which the **user** sees
     too, and which you capture. The kit ships no capture tool of its own: any
     screen capture of the `VibeGameEngine` window is the evidence, opened and looked
     at. A real visible window on the real GPU is the correct way to check how
     the scene actually looks. `-nullrhi` is the ban for visual claims; the
     window is fine.
   - Compilation checks (`npm run typecheck`, `npm run build:cpp`) and reading
     source are allowed, but they are NOT visual verification — never claim
     something "looks right" from a typecheck or a build alone; look at a
     rendered frame.
   - **For normal hot-reload work, do not run `npm run typecheck`,
     `npm run typings` or `npm run build:cpp` as a routine check.** Keep one
     `npm run dev` running and reuse it: Vite re-runs changed game modules inside
     every connected game process and hot-reloads `src/ui` in CEF, and a model
     file the game code imports is rebuilt and mounted into the running game by
     the same server when it is saved. Confirm the affected surface in the running game. Run a static
     check when the user asks for it, when diagnosing a concrete compile or
     runtime failure, and once before final delivery — that last pass is the
     validation set in [agents/AGENTS.md](./agents/AGENTS.md), and it is the end
     of the work rather than a step inside it. `npm run build:cpp` is not a check
     at all: it is how a C++ change reaches the game and the typings, so it runs
     when C++ changed, and only then (README: rebuilding `VibeGameEngineTools` needs the
     dev server stopped, because the content service holds its DLL).

2. **NEVER delete files, remove code wholesale, or `npm uninstall` without the
   user's explicit permission.** Preserve work (keep in place or save to a
   branch) and ask first.
   - The same applies to asking git to throw work away. `git checkout -- <file>`
     was run once to undo a single change; it also discarded every other
     uncommitted edit in that file, and git keeps no record of a working-tree
     file it overwrote. Revert by writing the reverse edit, or by putting the
     current state somewhere safe first.
   - **The guard.** `.claude/hooks/block-destructive-git.mjs` refuses that family
     of commands — `checkout` without `-b`, `restore`, `clean`, `stash`,
     `reset --hard`, `switch --force`, `worktree remove` — and lets their
     harmless forms through.
   - `.claude/settings.json` wires two independent gates: this one on `PreToolUse`, and the
     clean-code guard of rule 6a on `PostToolUse`.

2a. **NEVER MEASURE A SYSTEM IN A PLAYABLE SCENE.** A playable scene is for
   measuring INTEGRATION — that these systems run together, in the real
   renderer, without the frame falling apart — and for nothing else. Any claim
   about how a system BEHAVES is measured in its own DEV lab, built with the
   `dev-lab-authoring` skill: chosen geometry, a fixed cast, the same numbers on
   every run.

   **Here:** a lab is its body in `src/features/<slice>/labs/<id>/` plus one
   `defineLab` entry in the list `LABS` in `src/app/labs.ts`, where
   `src/app/scenes.ts` finds it, and it is opened in the dev session's shell with
   `npm run open -- labs/<id>` (`npm run play -- --lab <id> --headless` only
   when the question is answered by numbers alone, rule 1). Its state is read
   with `node vge/tools/game.mjs --scene labs/<id> "<expr>"`.

   Why, in numbers from the day this was written. A wave was measured on the
   combat arena to decide whether recast was steering it. Twice in a row the run
   was contaminated by state the scene owns and the measurement does not —
   survivors of the previous wave standing on the player at t = 0, and a `reset`
   that quietly rebuilt the fight at wave one, so a wave-2 run reported sixteen
   bodies of which ten carried `w1-` ids. Both runs looked perfectly healthy and
   printed confident numbers. The same questions asked in the lab answered on the
   first try and reproduced exactly.

   A playable scene has a live player, a spawner that drip-feeds, waves that
   overlap, deaths, physics corpses and a camera that moves. Each of those is a
   variable the measurement did not declare, and every one of them is free to
   explain the result instead of the thing being measured. A frame from such a
   scene cannot distinguish a working system from a broken one: measured, the
   demo arena's wave arrives 6 of 6 with pathfinding switched fully OFF, from
   five different standing places.

   So: if the question is "does this work", build the lab. If the question is
   "do these fit together in the real product", the scene is the right place and
   the answer is a frame, not a statistic. A statistic gathered in a playable
   scene proves nothing and will be rejected.

2b. **A FAULT IS FOUND IN THE CODE, IN THIS ORDER. Frames are proof, never a
   debugger.**

   1. **Read the code first.** Grep for who already does the thing, open the
      file, read the arithmetic. Most faults are visible there and nowhere else.
   2. **Then reason.** Ask why the code produces what is described — think the
      mechanism through before touching anything.
   3. **A frame is EVIDENCE THAT SOMETHING WORKS, not an instrument for finding
      out why it does not.** You will not debug anything with screenshots. The
      only exception is a task that is literally about comparing frames.

   **Here:** when a number is needed, read it from the running game with
   `node vge/tools/game.mjs "<expr>"` (`UE`, `puerts`, `world`, `gameInstance` in
   scope; `src/app/debug-seam.ts`) at the point where it first goes wrong,
   and the game log (`Saved/Logs/play-<scene>-<time>.log`, written by
   `npm run play`) before any hypothesis.

   Measured, the day this was written. Blood stood off the walls in the level.
   The answer was two rasters describing one wall — the drawing on the kit's
   ~1.75 m grid slid by a fractional recentre offset, the collision on a 0.9375 m
   grid pinned to the world origin, so a wall face could differ by half a cell,
   0.47 m. That is arithmetic, and it sat in the level's two grid modules — the
   one that draws and the one that collides — the whole time. Those files belong
   to the game this kit was distilled from and are not in this repository; what
   is portable is the shape of the fault, two rasters describing one wall.
   Instead of reading them the agent planned to shoot at walls in a headed
   browser and look — proposing to judge a 47 cm discrepancy by eye, in a
   screenshot, in a scene with a live fight in it. The owner's answer: *"your
   plan is that some miracle will let you see this in a frame — how exactly do
   you picture that?"*

   The same session had already lost an hour to the same reflex: a courtyard was
   drawn twice, and one `grep -rn` for the component's name — one line, one
   second — was run after a hundred tool calls of probes and captures.

2c. **WHAT THE USER SAYS IS A FACT UNTIL PROVEN OTHERWISE. Do not re-measure it.**

   When the owner says "the sky is gone", "there are two geometries", "the world
   is offset a little", "blood is fine in the lab" — that is a report from the
   person looking at the running game. Take it as given and go find the CAUSE.
   Spending a turn confirming the symptom is spending the owner's time to learn
   what they already told you, and it reads as not listening.

   Contradicting it needs evidence, not doubt: if the code says otherwise, say
   which line and why, and let them correct you.

3. **NEVER build scenes procedurally / dynamically — scenes are ALWAYS authored
   by hand.** No RNG scatter, no seeded generators, no `range()`/random placement,
   no "spawn N of these from a loop to fill space". Every element's position,
   rotation and scale is chosen **deliberately** to serve the composition and the
   reference — never sketched, scattered, or "roughed in".
   - Work one intent at a time. After each placement step, capture the **rendered
     game window and look at it** — 100% visual confirmation of every step, no
     "probably fine, moving on". Placement is authored in TypeScript in
     `src/scenes/<scene>/` and arrives in the running game by hot reload.
   - Think through where each element goes and why *before* writing it. Layout is
     a design decision, not a `for` loop.
   - The web kit's scene-authoring skill is `threejs-scene-authoring`; in this
     kit it is a stub (web renderer version, not ported — see
     [agents/skills/README.md](./agents/skills/README.md)). The rule stands
     without it.

4. **NEVER stop to ask a question you could answer yourself.** You were given a
   goal. Not knowing something is not a reason to hand the decision back — it is
   the work. Hand the question to a fresh sub-agent — one that has not been
   reading your reasoning — take its answer, act on it, and say what you decided
   and why.
   - This includes decisions that feel like they belong to the user: which of two
     designs to take, whether a stale test encodes a feature or a mistake,
     whether to commit, what a roster of enemies should be. Decide, state the
     decision plainly in the report, and make it reversible where you can.
   - The bar for actually stopping is narrow: an action that is destructive,
     outward-facing, or that you cannot undo. Everything else is you being lazy.
   - Asking twice for the same thing is the tell. If a question has gone
     unanswered, that is an answer: decide it.

5. **NEVER remove asset optimization to make something work.** In the web kit:
   `?meshopt`, `?texture=…`, audio re-encoding and every other build-time
   optimizer stay ON. Dropping one is not a fix — it is shipping the megabytes to
   hide a bug that is still there, and it will be copied by the next asset.
   - **Here:** the optimizations are the ones a source `.glb` the game code imports
     carries (meshopt, Draco, quantization, WebP/AVIF textures) and the ones the
     content pipeline applies when it cooks and packages (Oodle compression in
     `vge/content/pipeline.mjs`). The pipeline's decode step rewrites the
     extensions Interchange 5.8 cannot read as plain glTF/PNG before import
     (README, "Content pipeline notes") — that is the consumer being fixed, which
     is exactly what this rule asks for. It is never a reason to strip a source
     file of its compression or to switch a cook or pak compression flag off.
   - If an optimized asset breaks a system, **fix the system**. The optimizer is
     doing something legitimate and documented; the consumer is making an
     assumption that does not hold.
   - Worked example, and the reason this rule exists (from the web game; the
     files are not in this repository): `?meshopt` quantizes a skinned mesh —
     vertex positions are rescaled and re-centred and the inverse bind matrices
     are rewritten to compensate. The render is identical, but
     `Skeleton.pose()` then returns a bind pose at a different scale, and the
     ragdoll measured its capsules in it: giant colliders on a living body, and
     the body doubling in size the moment it died. The fix was in
     `ragdoll/systems/mixamoRig.ts` (`poseToBind` normalizes the bind pose back
     to the size the body actually lives at) — NOT in the import.
   - Removing an optimizer is a change the user asks for explicitly, never one an
     agent reaches for while debugging.

6. **ALWAYS write down, as you go, what a future agent would want to know.** Not
   at the end, not "if there is time" — while the finding is still fresh, in a
   markdown file, in the same change that produced it.
   - Two destinations, and say which one a lesson belongs to:
     **product** — how the systems of the thing you are building behave, into
     that project's own `docs/`; **kit** — a lesson that would hold in any
     project with the same technique (a skinned rig, the content pipeline, a
     hot-reloaded script runtime, a measured lab), which belongs in this
     repository's `docs/` and travels to everything started from it. Label a
     portable lesson as portable when you write it: one nobody labelled never
     gets lifted. Label it for the KIT only when it would hold with your game
     gone — the test is whether the technique it describes is in this
     repository at all.
   - Write the FALSIFIED ones too, with the number that falsified them. A
     recorded dead end is worth more than a recorded success: the success gets
     re-derived from the code, the dead end gets retried by every agent after
     you. Put it next to the line it concerns, not only in a document.
   - What earns a line: a constant that turned out to be stale, a statistic that
     measured the wrong thing, an instrument that disagreed with another, a fix
     that made things worse and by how much, an assumption the code quietly
     violated.
   - **The bench is not evidence.** Captures belong in the git-ignored
     `wip/<task>/`; the SCRIPT that produced them belongs in `vge/tools/` (where
     this kit's agent and measurement tools live). The test: if
     losing it would make a number you wrote down unrepeatable, it is a tool, and
     tools are committed. A whole task's instrument once sat in `wip/` while the
     document quoting it was committed — one `git clean` from turning every
     measurement into an unverifiable claim.
   - This is not documentation-for-its-own-sake, and it does not replace doing
     the work. It is the difference between a session that leaves a system and a
     session that leaves a system plus the reasons it is shaped that way.

6a. **AGENTS NEVER WRITE COMMENTS — none, `@important` included, in any
   language.** Clean code documents itself: what a comment would say goes into a
   name (extract a function or a constant that says it), and what a name cannot
   carry — a measurement, a source, a dead end, a launch command — goes into
   `docs/`, per rule 6. A comment is tokens spent on prose next to code that should
   have said it; needing one means the code is wrong first. The one exception is
   a comment the USER has explicitly allowed: then the agent writes it, marked
   `@important`. The marker means "authorized by the user" — an agent never sets
   it on its own decision, and never deletes a comment that carries it.
   This rule and the one above are one idea — write the lesson down, and write it
   where it gets read on purpose rather than by accident.

   Measured in the web kit the day this was written, by `.claude/hooks/lib/cleanCode.mjs`
   over its 229 tracked source files: **4 276 of 18 819 non-blank lines were
   comment — 23%**, and the longest file was 980 lines, 45.8% of its non-blank
   lines comment. Nobody chose that. It arrived one reasonable-looking paragraph
   at a time, and every paragraph made the file it sat in harder to read.

   A comment an agent finds in code it touches gets one of two fates:

   - **Delete it** when it restates the code. `/** The player's health. */` over
     `readonly health: number` is noise with a maintenance cost: it outlives the
     line it describes and then lies about it.
   - **Move it** to `docs/` when it records a MEASUREMENT, cites a SOURCE, marks
     a dead end or carries design rationale, unshortened. Those cannot be
     re-derived from the code, and they are why rule 6 exists: moving them never
     means losing them.

   A comment marked `@important` was authorized by the user and stays as it is.

   The thresholds are in `agents/skills/clean-code`; the guard that measures
   them is `.claude/hooks/clean-code-guard.mjs`, wired by the `PostToolUse`
   block of `.claude/settings.json`. It is a ratchet: it reports a file that got
   worse than `.claude/clean-code-baseline.json` records, never the debt already
   there. It blocks on length and on a new comment; it lets a comment marked
   `@important` through, which only a user's authorization puts there. And it runs AFTER the
   write, so a block is a reason handed back, not an undo — this rule is still
   yours to keep.

   **Here:** the guard and the baseline judge the TypeScript under `src` and
   `src/ui` only. The baseline is regenerated with `npm run clean-code:baseline`
   in the kit root, and the guard's own tests run with `npm run test:agent-tools`
   (see [docs/README.md](./docs/README.md)).

7. **NEVER edit or read files through scripts. Total ban, 100%, no exceptions.**
   Not code, not prose, not data, not config. No `sed`, `awk`, `perl`, Python
   or Node rewrite scripts, no heredoc, no `cat >`, no `echo >`, no
   string-replace programs — and no `cat`, `head`, `tail`, `sed -n` or script
   dumps to read a file either. Files are changed only with the Edit and Write
   tools and read only with the Read tool; Grep and Glob find things.

   Running programs is not affected: typecheck, the C++ build, the dev server,
   the game, `tools/game.mjs`, `tools/ui.mjs`, the content pipeline — those
   execute the project, they do not read or rewrite its files for you.

   Why. A scripted edit is blind: the owner cannot see what changed, the
   match silently fails or hits the wrong place, and shell quoting eats the
   payload. Measured on the project that produced this rule: heredoc scripts
   died on `unexpected EOF while looking for matching \`'` and were re-sent
   whole — twice the tokens for one change; merge conflicts were "resolved" by
   string-replace scripts that nobody could review; a research document went
   out as a `cat > … <<'EOF'` heredoc, failed, and was re-sent verbatim through
   Write. The owner had asked for this many times before it was written down
   as a total ban.

7a. **NEVER DESCRIBE CODE IN WORDS — anywhere.** The code is the description of
   what it does. Not in comments, not in `docs/`, not in READMEs, not in notes
   beside a file. `docs/` holds design only: goals, the shape of a system, the
   decisions and why they were made. It is not a place to move what may not be
   written as a comment; a paragraph explaining a function is banned in a
   document exactly as it is banned beside the function.

8. **COMPRESS THE CHANNEL NOBODY READS; NEVER COMPRESS THE ONE THE USER READS.**
   Two audiences, and the rule is about the audience rather than about the
   language you happen to be in. Answer the user in the language they wrote in;
   keep internal traffic in English, which is the language this codebase, its
   error strings and its dependencies are in.
   - **Internal traffic — compressed.** Reasoning, sub-agent briefs, task
     descriptions, what an agent reports back, agent-to-agent handoffs. Nobody
     reads this but machines: drop articles, filler (`just`, `really`,
     `basically`), pleasantries, hedging and narration of tool calls. Fragments
     are fine. It is output tokens either way, and output tokens cost several times
     what input tokens do.
   - **The user's channel — normal prose.** Every reply a person reads.
     Compressing that one buys a few tokens and costs comprehension.
   - **Never compress what must survive verbatim:** code, file paths, exact
     error strings, API and CLI names, numbers, units, and the words
     `not`/`never`/`only`/`except`. Flipping a negation is worse than any token
     saved. Do not invent abbreviations (`cfg`, `impl`, `req`) — the tokenizer
     splits them the same as the full word, so they save nothing and read worse.
   - **Drop the compression where ambiguity is expensive:** security warnings,
     confirmations of irreversible actions, and multi-step sequences whose order
     could be misread. Resume it once that part is clear.
   - Persisted artifacts are the user's channel, not the internal one: commits,
     docs, `wip/` notes, issue and PR text, and this file are written in normal
     prose because humans read them later.

9. **NO TYPE POSTFIXES IN FILE NAMES.** A file is never named
   `<name>.<kind>.ts` — no `porsche.vehicle.ts`, `miami.terrain.ts`,
   `forest.pcg.ts`, `destruction.niagara.ts`, `sky.material.tsx`, no
   `<id>.lab.ts`, no `<model>.mesh.json` sidecar, and no new postfix of any
   other kind. A file is named for what it is; what kind of thing it holds is
   said by the code inside it, never by its name or its folder. Do not add a
   new file with a postfix, do not copy an existing postfixed file as a
   template, and do not build tooling that finds files by name or folder. The
   files that still carry one are the defect being removed, not a convention to
   follow.

   What it cost: on 2026-10-30 an agent added `porsche.vehicle.ts` because
   `car.vehicle.ts` was there, and the owner had to stop the work to say this
   naming is garbage and must never be written again.

9a. **NO CONFIG FILES FOR IMPORTS OR BEHAVIOUR. EVERYTHING IS DESCRIBED IN TSX.**
   JSON files as such are not banned (data, generated output, measurements).
   What is banned is describing in a JSON (or any config file) how content is
   imported or processed by the content pipeline and the cooker, or how a thing
   behaves in the game: a cloth's constraints, a character's outfit assembly, a
   vehicle's wheels.
   - How something is imported may be said in the import line's query
     (`grid.glb?nanite=off`, `?skeleton=...`, `?lods=...`). That is the edge of
     what is allowed, not a place to grow new formats.
   - How it behaves in the game is business logic, written in TSX/TS code
     beside the code that uses it.
   - `cloth=<file>.json` in an import line is the defect this rule names; the
     cloth's behaviour moves into code.

## Roles

All agent roles and workflow rules live in [agents/AGENTS.md](./agents/AGENTS.md).

Start there, then open the selected role under `agents/<role>/AGENTS.md`.

## Local WIP (mandatory)

`wip/` is a local, Git-ignored workspace for verification screenshots, temporary
renders, debug probes and active handoff notes. Put those artifacts there —
never in `docs/`, source directories or commits. A fresh clone has no `wip/`:
create `wip/README.md` before producing the first WIP artifact, read it before
work once it exists, and keep its task notes accurate. (`/wip/` must be listed in
the repository's `.gitignore`; if it is not, add it before the first capture.)

**After selecting your role and before starting any work, determine the list of
skills the task needs and load them up front.** Match the request against the
available skills (`agents/skills/`, surfaced under `.claude/skills/` and
`.codex/skills/`) first — choose the relevant ones deliberately before writing
anything, not mid-task. [agents/skills/README.md](./agents/skills/README.md)
says which skills are ported to this kit, which are copied unchanged from the
web kit, and which are web-renderer stubs.
