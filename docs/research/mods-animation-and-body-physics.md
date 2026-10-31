# Mods for Cyberpunk 2077, Skyrim and Oblivion: animation sets and body physics

Research date: 2026-10-27. First pass: what the best mods are, how they are built, and what of it maps onto
Vibe Game Engine (UE 5.8 runtime, TypeScript game, FBX/GLB characters, generated ragdoll, Chaos Cloth from code,
retarget onto the mannequin).

## How the data was gathered

- Popularity numbers (E = endorsements, D = downloads) come from the public Nexus Mods GraphQL API
  (`https://api.nexusmods.com/v2/graphql`, no key needed), read on 2026-10-27. Nexus mod pages themselves sit behind
  a Cloudflare check and were not opened.
- Mod descriptions were read through the same API (`description` field).
- Cyberpunk dangle physics was read from the source of the WolvenKit Cyberpunk Blender add-on
  (`github.com/WolvenKit/Cyberpunk-Blender-add-on`, `collisiontools/dangles/*`), which reads and writes the game's
  `.animgraph` dangle nodes and re-implements their solver.
- Skyrim physics plugins were read from their source: FSMP (`github.com/DaymareOn/hdtSMP64`, GPL-3.0) for the
  HDT-SMP XML schema, CBP (`github.com/cbpphysics/CBPSSE`, MIT) for the CBP/CBPC spring model.
- UE 5.8 capabilities were checked on disk in `C:\GameEngien\UE_5.8\Engine`.
- Nothing was downloaded or installed. Per-mod permission tabs were not read except where quoted below.

## Licensing in one paragraph

Every mod that ships game-derived data (animations exported from the game, game meshes, game rigs) is built on
CD Projekt Red or Bethesda assets and cannot be taken into our engine. Fully custom animation packs belong to their
authors under the Nexus permission tab of each mod; one checked example, Photomode Facial Expression Mega Pack, says
"Please do not redistribute my mod". What can be taken freely is the method: the solver design, the constraint
types, the parameter ranges and the profile structure. The WolvenKit Blender add-on has no license file in its
repository (the GitHub API reports none), so its code is read for understanding only. KawaiiPhysics, the UE bone
physics plugin referenced below, is MIT. Skyrim: CBP source is MIT (CBPC is built on it, per its author); the
original HDT-SMP source was released under MIT by its author, and the maintained fork FSMP is GPL-3.0, so FSMP code
cannot go into our engine without making it GPL, while its design and parameter set can be studied.

---

## 1. Cyberpunk 2077

### 1.1 Engine background (REDengine 4)

- Animation: `.anims` containers (many clips per file) played through `.animgraph` graphs; skeletons are `.rig`.
  Editing goes through WolvenKit (export `.anims` to GLB, edit in Blender with the Cyberpunk add-on, import back).
  Body shape changes go through `.morphtarget` and custom `.rig` + `.animgraph` "slots".
- Physics: PhysX (the add-on ships a `pxbridge` for PhysX-dependent features). Ragdolls are PhysX D6 joints in
  `.phys`/rig data. Secondary motion is a separate animgraph-side solver, "dangle", described in 1.4.
- Loading: ArchiveXL (adds new items and patches without overwriting game files), TweakXL (records), RED4ext
  (native plugins), redscript and Cyber Engine Tweaks (scripting), Codeware.

### 1.2 Animation sets

| Mod | Nexus | E / D | What it does | How it is built |
|---|---|---|---|---|
| Immersive Third Person - Best Of Both Worlds (CybrDrake) | [32203](https://www.nexusmods.com/cyberpunk2077/mods/32203) | 3839 / 262933 | Full third-person animation set for V: idle, walk, jog, sprint, stops, jumps and landings, ladders and ledges, swimming, slide, dash, pickups; switches to first person for combat, driving, cutscenes. Female V done, male V fixes only. Since 1.3: 360° camera-oriented movement | Custom `.anims` isolated from first-person ones, wired with redscript + CET + ArchiveXL + TweakXL + Codeware. Author says some clips resemble other games' animations, so the data is not clean to reuse |
| ITP - True Camera-Oriented Controls (djoole) | [33789](https://www.nexusmods.com/cyberpunk2077/mods/33789) | 557 / 36986 | V turns toward the travel direction instead of strafing/backpedaling, smooth transitions over 360° | Now folded into ITP 1.3. The idea is "orientation follows velocity, not camera" |
| JB - TPP MOD (Jelle Bakker) | [669](https://www.nexusmods.com/cyberpunk2077/mods/669) | 20035 / 993576 | The original third-person camera mod | Camera only; uses game TPP animations |
| Every Animation Redone TPP (Tylerrrrr) | [16858](https://www.nexusmods.com/cyberpunk2077/mods/16858) | 1471 / 193597 | Redoes every third-person animation that can be fixed | `.anims` replacement |
| M.P.A.F. Multi Pose-Pack and Animation Framework (NoraLee) | [6227](https://www.nexusmods.com/cyberpunk2077/mods/6227) | 1881 / 202432 | Lets many `.anims` pose packs load into photo mode at once | Framework over the photo mode pose loading system |
| Morphtarget and AnimRig Additions (NoraLee) | [4673](https://www.nexusmods.com/cyberpunk2077/mods/4673) | 3693 / 357185 | 15 extra `.morphtarget` slots and 5 `.rig` + `.animgraph` slot pairs on V | Framework that other physics/shape mods load into |
| CyberScript Core Animation Archive (donk7413) | [7691](https://www.nexusmods.com/cyberpunk2077/mods/7691) | 3698 / 277070 | 16k+ animations for CyberScript | Library of game clips |
| Cute and Sexy Pose Pack (xBaebsae) | [6871](https://www.nexusmods.com/cyberpunk2077/mods/6871) | 3825 / 881080 | 56 custom photo mode/AMM poses | "posed or retargeted in Blender and imported" |
| Zwei Custom PMU Pose Packs, PMU Sitting Poses | [7165](https://www.nexusmods.com/cyberpunk2077/mods/7165), [8361](https://www.nexusmods.com/cyberpunk2077/mods/8361) | 3463 / 824939; 1769 / 485494 | Large custom pose libraries (76 sitting poses) | Single-frame `.anims` |
| Action Pose Pack (Subleader), Fistfight / Impact poses | [8698](https://www.nexusmods.com/cyberpunk2077/mods/8698), [13178](https://www.nexusmods.com/cyberpunk2077/mods/13178), [12974](https://www.nexusmods.com/cyberpunk2077/mods/12974) | 1323 / 172444 | Combat and hit-reaction poses | ArchiveXL + TweakXL |
| Photomode Facial Expression Mega Pack (xBaebsae) | [7912](https://www.nexusmods.com/cyberpunk2077/mods/7912) | 4754 / 985126 | 195 facial expressions, static and looping | Facial `.anims` on the game face rig. "Do not redistribute" |
| Melee Attacks Fixes And Enhancements | [16921](https://www.nexusmods.com/cyberpunk2077/mods/16921) | 3002 / 1165633 | Melee fixes | Gameplay records, not new clips |
| Appearance Menu Mod (AMM) | [790](https://www.nexusmods.com/cyberpunk2077/mods/790) | not read | Spawning, poses tab, expressions tool | CET Lua; the hub most pose packs target |

Notes on the face: the WolvenKit add-on's facial module (`animation/facial/constants.py`) shows the game face rig is
split into envelopes (upper face, lower face, anti-stretch, lipsync left/right, JALI jaw, JALI lips, muzzle lips,
eyes, brows, eye direction). Lipsync uses JALI (jaw/lip separation driven from phonemes with coarticulation), which
the add-on re-implements (`animation/jali/*`).

### 1.3 Body physics mods

| Mod | Nexus | E / D | What it does | How it is built |
|---|---|---|---|---|
| Ragdoll Physics Overhaul (SketchCritic) | [3858](https://www.nexusmods.com/cyberpunk2077/mods/3858) | 16951 / 2171503 | Looser joints and fixed self-collision on all NPC rigs; varied resting poses instead of the vanilla A-pose; legs can splay | Retuned joint limits and collision in the ragdoll data. Known residuals: knees sometimes bend backwards, shoulders keep one locked axis ("chicken arms") |
| SPLAT Physics Realistic Ragdoll Overhaul (IceFire Modding) | [23539](https://www.nexusmods.com/cyberpunk2077/mods/23539) | 951 / 108388, v12.0 updated 2026-10-27 | 30+ authored ragdoll profiles (normal, loose, forward fold, pelvis first, stiff topple, decorticate, decerebrate, kickback, knee first, lateral L/R) with per-profile chance; directional collapses, trips, slams, explosions | Runtime profile manager over PhysX D6 joints: swing Y/Z and twist X limits, joint stiffness, swing/twist spring, strength, damping, D6 drive targets; per-body-part release timers loosen joints progressively after impact; root displacement and collision shape editing |
| RagdollPunk (palregeni) | [34965](https://www.nexusmods.com/cyberpunk2077/mods/34965) | 94 / 7424 (released 2026-10-16) | Restrained/Flexible profiles, unlocked axial twist, friction tuning, physical reactions for deaths, knockouts, knockdowns | Tuned joints and collision shapes on five body rigs; RED4ext for the light edition |
| Enable Finisher Ragdolls (Kvalyr) | [9496](https://www.nexusmods.com/cyberpunk2077/mods/9496) | 6753 / 1198653 | Finisher victims ragdoll instead of playing a canned death | Switch from animation to ragdoll at the end of an animated action |
| Breast Jiggle Physics - enabled for TPP, FPP and Photomode (JohnsonsStuff) | [3339](https://www.nexusmods.com/cyberpunk2077/mods/3339) | 13300 / 1293017 | Turns on the vanilla jiggle where the game disables it | Animgraph switch |
| Custom Breast Jiggle Physics (JohnsonsStuff), LITE | [2891](https://www.nexusmods.com/cyberpunk2077/mods/2891), [3665](https://www.nexusmods.com/cyberpunk2077/mods/3665) | 11872 / 681044; 8388 / 921099 | Stronger jiggle | Edited `woman_base_breasts.animgraph` dangle values; author: "100% trial and error". Tutorial + base animgraph: [3359](https://www.nexusmods.com/cyberpunk2077/mods/3359) |
| Citizen Breast Physics (Larilith), no-conflict version (f80h) | [3900](https://www.nexusmods.com/cyberpunk2077/mods/3900), [21520](https://www.nexusmods.com/cyberpunk2077/mods/21520) | 5678 / 641828; 1295 / 274084 | Same dangle setup applied to most female NPCs | f80h version patches through ArchiveXL without overwriting `.app`/`.ent` |
| Curvy NPC body mod and jiggle setup (f80h) | [20604](https://www.nexusmods.com/cyberpunk2077/mods/20604) | 670 / 105232 | 16 sizes and 4 jiggle presets | Morphtargets + animgraph presets |
| Johnson's Amazing Dangles Emporium, JADE (johnson) | [15265](https://www.nexusmods.com/cyberpunk2077/mods/15265); modder cores [9130](https://www.nexusmods.com/cyberpunk2077/mods/9130), [9131](https://www.nexusmods.com/cyberpunk2077/mods/9131) | 1992 / 444383 | "Cloth physics" for skirts and jackets | Not real cloth: dozens of `jade_*` dangle bones per garment, shared presets (short/long skirt, short/long jacket), mesh skinned to them |
| Experimental Songbird Dress | [9315](https://www.nexusmods.com/cyberpunk2077/mods/9315) | not read | Real cloth simulation on a dress | Author: experimental, unstable, heavy; JADE recommended instead |
| Framework - Unique V/Panam/Judy Body Shape - Rig (JohnsonsStuff) | [3725](https://www.nexusmods.com/cyberpunk2077/mods/3725) | 23567 / 2005006 | Per-character rig so body mods and physics apply to one character | Custom `.rig` per character |
| Body mods: spawn0 BODY MOD 2.0, Hyst EBB, VTK HD Body | [1424](https://www.nexusmods.com/cyberpunk2077/mods/1424), [4654](https://www.nexusmods.com/cyberpunk2077/mods/4654), [7054](https://www.nexusmods.com/cyberpunk2077/mods/7054) | 31534 / 4775086; 27604 / 2942762; 21213 / 4799994 | Body shape replacement | Meshes, morphtargets, rig deforms; physics comes from the dangle frameworks above |
| Hair and accessories with physics (Lizzy Hair, raem necklaces, Kwek earrings) | e.g. [4287](https://www.nexusmods.com/cyberpunk2077/mods/4287), [15076](https://www.nexusmods.com/cyberpunk2077/mods/15076) | up to 2061 / 598681 | Ponytails, necklaces, earrings, bracelets that swing | Same dangle system, donor `.rig`/`.animgraph` + weight transfer |

### 1.4 How Cyberpunk dangle physics works (read from the add-on source)

`animAnimNode_Dangle` in an `.animgraph` holds one or more chains. Each chain picks one of four solvers
(`animgraph_codec.py`):

- `animDangleConstraint_SimulationDyng` - particle system ("dyng"): each bone is an `animDyngParticle`.
- `animDangleConstraint_SimulationPositionProjection` - position-based (PBD) variant.
- `animDangleConstraint_SimulationSpring` - per-bone spring.
- `animDangleConstraint_SimulationPendulum` - per-bone pendulum.

Per particle (`props.py`): mass, damping, pull force factor (pull back toward the animated pose), pinned flag,
capsule radius/height/axis for self-collision, projection type (disabled, shortest path, directed), and a direction
reference bone. Spring chains add simulation fps, constraint radius and two ellipsoid scales, pull force origin.
Pendulum chains add simulation fps, constraint type (cone, hinge plane, half cone), half aperture angle, constraint
orientation, pull force direction, collision radius/height.

Constraints between particles (`animDyngConstraintMulti` holding inner constraints):

- `animDyngConstraintLink` - distance link to a target bone: fixed, variable, greater-than or closer-than, with
  lower/upper bound ratios, explicit rest distance, stiffness, look-at axis.
- `animDyngConstraintCone` - cone/hinge/half-cone around an attachment bone, with a collision cone.
- `animDyngConstraintEllipsoid` - keeps a particle inside or outside an ellipsoid on a center bone
  (radius, two half-axis scales, local transform). This is how breasts are kept from caving into the chest.

Body collision: `animCollisionRoundedShape` (sphere, capsule, rounded box) attached to body bones with local offset
and rotation. External force: a world-space vector link (wind, motion). A second node, `animAnimNode_Drag`, lags a
bone behind its source with overshoot detection (min/max speed, duration) and optional stepped motion.

Takeaway: the game's hair, jewelry, skirts (JADE) and breasts are all one bone-chain solver with distance, cone and
ellipsoid constraints plus capsule colliders. Real cloth was tried and dropped as unstable and expensive.

---

## 2. Skyrim (Special Edition / Anniversary Edition)

Skyrim is where the deepest body physics and animation frameworks of the three games live. Numbers below are for
the Special Edition Nexus (`skyrimspecialedition`), which is where active work happens.

### 2.1 Engine background (Creation Engine + Havok Behavior)

- Animation: Havok `.hkx` clips driven by Havok Behavior graphs (`.hkx` behavior files per race). Skeleton
  `skeleton.nif` / `skeleton_female.nif` with Havok ragdoll bodies (`bhkRigidBody`, constraints).
- Behavior patchers: FNIS (old), Nemesis ([60033](https://www.nexusmods.com/skyrimspecialedition/mods/60033),
  E82603 / D9318971) and Pandora Behaviour Engine+ ([133232](https://www.nexusmods.com/skyrimspecialedition/mods/133232),
  E22656 / D2923187, open source, Windows/Linux) merge many mods' behavior edits into one graph.
- Skeleton standard: XP32 Maximum Skeleton Special Extended, XPMSSE
  ([1988](https://www.nexusmods.com/skyrimspecialedition/mods/1988), E247439 / D18302385, the most endorsed mod
  in this report). Adds breast, butt, belly, weapon, cloak and other bones every physics and animation mod relies on.
- Native extensions: SKSE plugins (DLLs). Every runtime physics system below is an SKSE plugin outside the game's
  own Havok world.

### 2.2 Animation sets and frameworks

| Mod | Nexus | E / D | What it does | How it is built |
|---|---|---|---|---|
| Dynamic Animation Replacer, DAR (Felisky) | [33746](https://www.nexusmods.com/skyrimspecialedition/mods/33746) | 80924 / 6523884 | Replaces any actor's animations by conditions (actor base, race, equipped, etc.) | SKSE plugin; folder convention `DynamicAnimationReplacer\<esp>\<actor id>\*.hkx` and condition folders. Closed source |
| Open Animation Replacer, OAR (Ersh) | [92109](https://www.nexusmods.com/skyrimspecialedition/mods/92109) | 46091 / 7895205 | Open-source DAR successor with in-game editor; addons for detection, dialogue, raycast, equipment conditions | SKSE plugin with a conditions API other plugins extend |
| True Directional Movement, TDM (Ersh) | [51614](https://www.nexusmods.com/skyrimspecialedition/mods/51614) | 63476 / 9356193 | 360° movement and attacks in any direction, target lock, modern TPP | SKSE plugin rotating the character to the movement vector |
| Animation Motion Revolution, AMR (alexsylex) | [50258](https://www.nexusmods.com/skyrimspecialedition/mods/50258) | 55084 / 9019098 | Actor displacement follows each animation instead of preset speed values | Root motion stored as custom annotations in the clip, injected into the movement controller |
| Precision - Accurate Melee Collisions (Ersh) | [72347](https://www.nexusmods.com/skyrimspecialedition/mods/72347) | 39593 / 7046601 | Weapon colliders live for the swing duration instead of a single hit frame; procedural physics hit reactions; hitstop, camera shake, trails, recoil on hard materials | SKSE; collider attached to the weapon bone for an animation-defined window; animators can author custom collisions |
| MCO Universal Support (doodlum) + ADXP/MCO movesets | [85491](https://www.nexusmods.com/skyrimspecialedition/mods/85491); [72220](https://www.nexusmods.com/skyrimspecialedition/mods/72220), [72966](https://www.nexusmods.com/skyrimspecialedition/mods/72966) | 11173 / 1801427; 9083 / 2931156; 10744 / 2416060 | Combo movesets with recovery frames you can cancel with directional input; Elden Ring style movesets (130+ animations), Nordic complete pack | Behavior annotations for recovery windows; DAR/OAR conditions per weapon |
| Vanargand Animations (Verolevi) | e.g. [57544](https://www.nexusmods.com/skyrimspecialedition/mods/57544), [60323](https://www.nexusmods.com/skyrimspecialedition/mods/60323), [54351](https://www.nexusmods.com/skyrimspecialedition/mods/54351), [58997](https://www.nexusmods.com/skyrimspecialedition/mods/58997) | 15000-17000 / ~3M each | One-handed mid stance, archery, sneak, crossbows, attacks; complete idle/walk/run/strafe/turn/equip sets | Hand-animated `.hkx`; power attacks use AMR for motion data; OAR conditions |
| Leviathan Animations (Verolevi) | e.g. [81463](https://www.nexusmods.com/skyrimspecialedition/mods/81463), [80760](https://www.nexusmods.com/skyrimspecialedition/mods/80760), [82603](https://www.nexusmods.com/skyrimspecialedition/mods/82603), [47092](https://www.nexusmods.com/skyrimspecialedition/mods/47092) | ~10000 / 1-3M each | Male and female idle/walk/run, sprint, two-handed stances and attacks | Same author, same pipeline; conditional by armor type |
| Pretty Combat Animations (dualsun) | [3761](https://www.nexusmods.com/skyrimspecialedition/mods/3761) | 48422 / 2198013 | Complete weapon idle stances including walk/run/turn | `.hkx` replacer |
| Pristine Vanilla Movement (Everglaid) | [66635](https://www.nexusmods.com/skyrimspecialedition/mods/66635) | 8963 / 3398933 | Vanilla run/walk/sprint re-edited: no jitter, smoother | Edited `.hkx` |
| Movement Behavior Overhaul | [38950](https://www.nexusmods.com/skyrimspecialedition/mods/38950) | 8573 / 530961 | Direction transitions, momentum stop | Behavior graph edits |
| TK Dodge, Dynamic Dodge Animation | [15309](https://www.nexusmods.com/skyrimspecialedition/mods/15309), [79598](https://www.nexusmods.com/skyrimspecialedition/mods/79598) | 49339 / 6529090; 11771 / 1303011 | Dodge, weapon-specific 8-way dodges | Behavior + clips |
| Arm Movement Animations (OAR) | [62849](https://www.nexusmods.com/skyrimspecialedition/mods/62849) | 10654 / 5145121 | 80+ variants of the folded-arms overlay chosen by armor, personality, role | OAR conditions on an additive overlay |
| Expressive Facial Animation, Female / Male (Niroku) | [19181](https://www.nexusmods.com/skyrimspecialedition/mods/19181), [19532](https://www.nexusmods.com/skyrimspecialedition/mods/19532) | 70154 / 8964889; 47049 / 8051930 | Every expression and lip/brow/eye morph redone | Replaces the face morph (`.tri`) files; tied to vanilla head vertex order |
| Combat Gameplay Overhaul (DServant) | [33767](https://www.nexusmods.com/skyrimspecialedition/mods/33767) | 33318 / 1553137 | Dodge rolls, procedural leaning, grip changing, mid-air combat | Behavior + procedural bone offsets |

### 2.3 Body physics

| Mod | Nexus | E / D | What it does | How it is built |
|---|---|---|---|---|
| CBPC - Physics with Collisions (Shizof) | [21224](https://www.nexusmods.com/skyrimspecialedition/mods/21224) | 106056 / 10973902, updated 2026-10-04 | Breast, butt, belly bounce plus collisions with hands, other bodies; VR hands and weapons | SKSE plugin built on CBP (MIT). Per-bone damped spring every frame; collisions are spheres attached to bones, configured per body shape |
| CBP Physics (Polygonhell) | [13207](https://www.nexusmods.com/skyrimspecialedition/mods/13207) | 47496 / 1778723 | Original simple bounce, no collisions | See the model below |
| HDT-SMP (hydrogensaysHDT) / FSMP - Faster HDT-SMP | [30872](https://www.nexusmods.com/skyrimspecialedition/mods/30872), [57339](https://www.nexusmods.com/skyrimspecialedition/mods/57339) | 85259 / 4037700; 69485 / 11049822, updated 2026-08-26 | Physics for hair, capes, skirts, body with collisions between body, hair, armor | SKSE plugin running Bullet physics on skinned meshes; one XML per mesh (see below); `smp report` validates a mod list |
| CBBE 3BA (Acro) | [30174](https://www.nexusmods.com/skyrimspecialedition/mods/30174) | 84213 / 8320455 | Body with three breast bones per side, repainted weights, SMP and CBPC presets swappable in game | Mesh + weights + physics configs |
| BHUNP - UUNP Next Generation (Bakafactory, Haeun) | [31126](https://www.nexusmods.com/skyrimspecialedition/mods/31126) | 26250 / 3792282 | High-poly UNP-family body, "natural movements", three breast bones per side, believable collision | Mesh + weights + SMP configs; author warns not to run SMP on NPCs (FPS, crashes) - use CBPC there |
| UBE 2.0 - Ultimate Body Enhancer | [92989](https://www.nexusmods.com/skyrimspecialedition/mods/92989) | 6001 / 727166 | New races with their own body models and textures | Custom races + meshes |
| HIMBO - Highly Improved Male Body Overhaul | [46311](https://www.nexusmods.com/skyrimspecialedition/mods/46311) | 20468 / 5608600 | High-poly male body for all races with sliders | BodySlide/RaceMenu sliders |
| OBody Next Generation | [77016](https://www.nexusmods.com/skyrimspecialedition/mods/77016) | 13642 / 3828829, updated 2026-10-26 | Distributes BodySlide presets to every NPC, change any NPC's body in game, clothes follow the morph | SKSE plugin applying morph presets at runtime |
| CBBE SMP (ousnius) | [29023](https://www.nexusmods.com/skyrimspecialedition/mods/29023) | 28116 / 1050900 | Official SMP body and configs | SMP XML |
| 3BA RFBBBT, Petite to Plenty | [59123](https://www.nexusmods.com/skyrimspecialedition/mods/59123), [82745](https://www.nexusmods.com/skyrimspecialedition/mods/82745) | 4087 / 856839; 2750 / 498329 | Firm realistic CBPC preset; one config tuned across body sizes with careful collision spheres | CBPC config only |
| KS Hairdos - HDT SMP | [31300](https://www.nexusmods.com/skyrimspecialedition/mods/31300) | 53004 / 6508718 | Long hairstyles with SMP physics | Hair bones + SMP XML |
| Vanilla hair remake (jg1) | [63979](https://www.nexusmods.com/skyrimspecialedition/mods/63979) | 21869 / 8321762 | 146 vanilla hairstyles rebuilt with optional SMP | Same |
| Cloaks and Capes - FSMP | [2019](https://www.nexusmods.com/skyrimspecialedition/mods/2019) | 17287 / 1675158 | Physics cloaks | SMP |
| PLANCK - Physical Animation and Character Kinetics (FlyingParticle) | [66025](https://www.nexusmods.com/skyrimspecialedition/mods/66025) | 7268 / 912801, updated 2026-10-12 (VR) | Every character's ragdoll is always present and driven toward the animation pose (active ragdoll). Characters can be grabbed, pushed, hit physically; they flinch in the direction of the hit; improved get-up; melee hits are ragdoll collisions; player collides with the enemy's ragdoll, not a capsule | SKSE VR plugin on top of HIGGS; powered ragdoll with motors toward the pose |
| Realistic Ragdolls and Force SE (dDefinder) | [1439](https://www.nexusmods.com/skyrimspecialedition/mods/1439) | 61825 / 3118495 | Ragdolls bend and twist realistically, fall faster, more friction; lower hit force | Skeleton Havok edits + force ESP |
| XP32 True Ragdoll Physics | [161116](https://www.nexusmods.com/skyrimspecialedition/mods/161116) | 841 / 60798 | Bodies roll and tumble instead of sliding | `bhkRigidBody` inertia changed from `MO_SYS_BOX_INERTIA` to `MO_SYS_SPHERE_INERTIA` (feet stay box), better limb mass distribution, friction 2.5, hand/forearm/head restitution -0.8 to +1.2 |
| Ragdoll Friction and Edits, Enhanced Ragdoll Accuracy | [107266](https://www.nexusmods.com/skyrimspecialedition/mods/107266), [45767](https://www.nexusmods.com/skyrimspecialedition/mods/45767) | 596 / 104827; 1147 / 54074 | Friction and joint edits | Skeleton edits |

NBO's author (Krasue) has three mods on Nexus, all for Oblivion Remastered (NBO, Natural Male Bodies - NBO Addon
[3696](https://www.nexusmods.com/oblivionremastered/mods/3696), Female Locomotion Replacer); no Skyrim version
exists under that name. The Skyrim counterpart of what NBO combines is a stack: body (CBBE 3BA, BHUNP, HIMBO for
men) + physics (CBPC for everyone, SMP for the player) + runtime body variety and morphing (OBody NG, RaceMenu
morphs).

### 2.3a Legendary Edition (2011), where the techniques started

| Mod | Nexus (skyrim) | E / D | Why it matters |
|---|---|---|---|
| FNIS - Fores New Idles in Skyrim (fore) | [11811](https://www.nexusmods.com/skyrim/mods/11811) | 395384 / 23336058 | First behavior patcher: custom idles, paired animations, killmoves, furniture, creature animations. Nemesis and Pandora keep its formats |
| FNIS Sexy Move | [54521](https://www.nexusmods.com/skyrim/mods/54521) | 91306 / 2218991 | Per-NPC female locomotion variants; the idea later done with DAR/OAR conditions |
| HDT Physics Extensions, HDT-PE (HydrogensaysHDT) | [53996](https://www.nexusmods.com/skyrim/mods/53996) | 238032 / 7428976 | Ran the game's own Havok on extra bones for hair, skirts, breasts. Replaced on SE by HDT-SMP (Bullet) and CBPC |
| HDT Breast And Butt Physics - TBBP/BBP | [54044](https://www.nexusmods.com/skyrim/mods/54044) | 81919 / 2719925 | The BBP/TBBP bone standards (two and three breast bones) that 3BA and BHUNP still use |
| XPMSE | [68000](https://www.nexusmods.com/skyrim/mods/68000) | 149831 / 5404930 | Origin of the extended skeleton |

### 2.4 How CBP/CBPC works (read from the CBP source, `Thing.cpp`)

Each jiggle bone (`NPC L/R Breast`, `NPC L/R Butt`, `HDT Belly`) is a point on a damped spring toward a target
point in the parent bone's space (`cogOffset` ahead of the parent). Per sub-step of `timeTick` ms:
`force = diff * stiffness + diff² * stiffness2 - gravityBias`, `velocity += force*dt - velocity*damping*dt`,
`position += velocity*dt`. The displacement is clamped per axis to `maxOffset`, scaled per axis by
`linearX/Y/Z`, and a part of it becomes bone rotation through `rotational`; `gravityCorrection` shifts the rest
position down. Frame delta is clamped to 8-64 ms. CBPC adds sphere colliders on bones and pushes the jiggle bones out
of them. That is the whole model: a few dozen lines, cheap enough for every NPC.

### 2.5 How HDT-SMP / FSMP works (XML schema read from `src/hdtSkyrimSystem.cpp`)

One XML per mesh describes a Bullet physics system on the mesh's bones:

- `bone` / `bone-default`: rigid body per bone with `mass`, `inertia`, `centerOfMassTransform`, `linearDamping`,
  `angularDamping`, `friction`, `rollingFriction`, `restitution`, `margin-multiplier`, `gravity-factor`,
  `wind-factor`, collision shape `sphere` / `box` / `capsule` / `cylinder` / `hull` / `compound`.
- Constraints: `generic-constraint` (6-DOF with `linearLowerLimit/UpperLimit`, `angularLowerLimit/UpperLimit`,
  `linearStiffness`, `angularStiffness`, `linearDamping`/`angularDamping`, `linearEquilibrium`/`angularEquilibrium`,
  `linearBounce`/`angularBounce`, motors and servo motors, non-Hookean stiffness and damping),
  `stiffspring-constraint` (`minDistanceFactor`, `maxDistanceFactor`, `stiffness`, `damping`),
  `conetwist-constraint` (`swingSpan`-style `coneLimit`, `planeLimit`, `twistLimit`), each with a `-default`
  template and `frameInA`/`frameInB` (or `frameInLerp`); `constraint-group` for grouped solving.
- Collision: `per-vertex-shape` and `per-triangle-shape` (the skinned mesh itself is the collider, with
  `radius`/`margin`/`penetration`), `tag`, `can-collide-with-tag`, `no-collide-with-tag`,
  `can-collide-with-bone`, `no-collide-with-bone`, `collision-filter`, `weight-threshold`.
- Bones with zero mass are kinematic and follow the animation; dynamic bones overwrite the node transform
  (`hdtSkyrimBone.cpp:92-101`). `translationLerp` / `rotationLerp` place a constraint frame between its two bodies
  (`hdtSkyrimSystem.cpp:1007-1024`, `1192-1199`); they do not blend simulation with animation.

Takeaway: Skyrim splits body physics into two tiers. CBP/CBPC is a per-bone spring with sphere collisions, cheap,
used for breasts/butt/belly on every NPC. HDT-SMP is a full rigid-body chain simulation with mesh-vertex and
mesh-triangle colliders for hair, capes, skirts and bodies that collide with armor. PLANCK goes further: the whole
character is a powered ragdoll following animation.

---

## 3. Oblivion (2006)

### 3.1 Engine background (Gamebryo + Havok 2.x)

- Animation: `.kf` keyframe files on one shared `skeleton.nif`; meshes and skeleton in `.nif` (NifSkope, Blender
  NIF tools). Ragdolls are Havok (`bhkRigidBody` + constraints inside `skeleton.nif`).
- No runtime secondary-motion solver for live characters. "Bouncing" on live characters is baked into animation keys
  on extra bones. Havok simulates only corpses and loose objects.
- Script extender: OBSE; Blockhead (OBSE plugin) for per-NPC/per-race animation overrides.
- Nexus search found no HDT, CBPC or similar runtime jiggle plugin for Oblivion; those are Skyrim technologies.

### 3.2 Animation sets

| Mod | Nexus | E / D | What it does | How it is built |
|---|---|---|---|---|
| NoMaaM BBB Animation Replacer (fore) | [35551](https://www.nexusmods.com/oblivion/mods/35551) | 7884 / 301823 | BBB versions of every standard human animation except swimming: walk/run, sneak, hand-to-hand, one-hand, two-hand, bow, cast, staff, dodge, riding | Breast bone motion keyed into each `.kf`; three strengths (Breast Movement Factor 1.1 / 0.8 / lower) |
| NoMaaM Breathing Idles | [40462](https://www.nexusmods.com/oblivion/mods/40462) | 1062 / 21843 | Breathing on all idles, subtle or strong, with BBB variants | Keyed `.kf` |
| beni animation replacers: DMC Stylish, Stylish Jump, Pretty Woman, Natural Walk, Silver Ranger, Spell Singer | [16459](https://www.nexusmods.com/oblivion/mods/16459), [20459](https://www.nexusmods.com/oblivion/mods/20459), [32572](https://www.nexusmods.com/oblivion/mods/32572), [31240](https://www.nexusmods.com/oblivion/mods/31240) | 5334 / 460122; 6142 / 286435; 4198 / 147849; 2566 / 107297 | Japanese-action-game style blade/blunt skills, jumps and dodges; feminine idle/turn/walk/run; natural walk without side-stepping | Hand-keyed `.kf` replacers, third person only |
| Womans Move walk / run (nao4288) | [33998](https://www.nexusmods.com/oblivion/mods/33998), [38375](https://www.nexusmods.com/oblivion/mods/38375) | 6841 / 308157; 3779 / 139315 | Female walk and run | `.kf` with BBB bones |
| Sensual Walks for Female NPCs (Surazal, Mur_Zik) | [28223](https://www.nexusmods.com/oblivion/mods/28223) | 6034 / 200712 | Different walk per NPC by class, job, age | Per-NPC animation assignment |
| Combat Stance Reanimation (ElAlquimista) | [43695](https://www.nexusmods.com/oblivion/mods/43695) | 4871 / 154731 | New idle and blocking stances | `.kf`, BBB enabled |
| CCAO Combat Animation Overhaul (cotyounoyume) | [36261](https://www.nexusmods.com/oblivion/mods/36261) | 1217 / 58604 | Own stance and power attack per weapon type | OBSE; switches skeleton or special-anim sets at runtime |
| Blockhead (shadeMe) | [43752](https://www.nexusmods.com/oblivion/mods/43752) | 60094 / 2459448 | Per-NPC/race/gender animation and head overrides | OBSE plugin; the base for animation diversity (Blockhead Animations Compilation [46588](https://www.nexusmods.com/oblivion/mods/46588)) |
| WalkBlessed (cOJzZ) | [49067](https://www.nexusmods.com/oblivion/mods/49067) | 5260 / 236647 | Diagonal movement, spine bend when aiming a bow | OBSE plugin rotating spine bones procedurally |
| Personality Idles 4 (dereko) | [14280](https://www.nexusmods.com/oblivion/mods/14280) | 2090 / 137659 | Reactions and idles for NPCs and player | Idle `.kf` + scripts |

### 3.3 Body physics

| Mod | Nexus | E / D | What it does | How it is built |
|---|---|---|---|---|
| Coronerra's Maximum Compatibility Skeletons | [27945](https://www.nexusmods.com/oblivion/mods/27945) | 23208 / 932379 | One skeleton with breast, butt, hair, cloth, tail, wing, genital bones so all animation mods work together | Merged `skeleton.nif` |
| Universal Skeleton Nif (Growlf) | [37596](https://www.nexusmods.com/oblivion/mods/37596) | 8506 / 249069 | Same idea plus scale bones on the whole spine to reshape body through idles | `skeleton.nif` |
| HGEC Body with BBB | [34442](https://www.nexusmods.com/oblivion/mods/34442) | 10254 / 426049 | Body weighted to BBB bones | Skinning to extra bones |
| BBB Ragdoll Breast Physics (killermonkey99) | [40739](https://www.nexusmods.com/oblivion/mods/40739) | 2277 / 64051 | Real Havok breast bodies on corpses | Breast collision objects and ragdoll constraints added to the skeleton; corpses only |
| Realistic Ragdolls and Force v3 | [5011](https://www.nexusmods.com/oblivion/mods/5011) | 2864 / 122727 | Faster falls, stronger hit force | Havok mass, damping, constraint edits |
| Ragdolls for Oblivion (MadAce) | [51844](https://www.nexusmods.com/oblivion/mods/51844) | 764 / 189031 | Every skeleton re-tuned: collision shapes refit, mass, friction, restitution, constraints; force scales with skill and strength; arrows apply force at the hit point | Havok skeleton edits + script, `Ragdoll.ini` |
| Growlf's Animated Hair | [16930](https://www.nexusmods.com/oblivion/mods/16930) | 1576 / 58812 | Swinging wigs and braids | Hair bones driven by keyed animation |
| Havok Tapestries | [45530](https://www.nexusmods.com/oblivion/mods/45530) | 164 / 2290 | Tapestries that flutter and react | Havok-constrained cloth pieces |

---

## 4. Oblivion Remastered (2025)

### 4.1 Engine background

Original Gamebryo game logic runs underneath; Unreal Engine 5.3 renders and animates (FModel opens the paks with
`GAME_UE5_3`). Assets are cooked `.pak/.utoc/.ucas` in `Content/Paks/~mods`; Blueprint mods go to
`Content/Paks/LogicMods`; scripting through UE4SS (Lua) and OBSE64. Classic `Data` loose files are ignored for
these assets. The game's skeletal meshes carry UE names such as `SK_Imperial_HR_Loose_f`.

A telling engine detail from Smoother Locomotion ([1864](https://www.nexusmods.com/oblivionremastered/mods/1864)):
`Altar.ini` keys `bDefaultUseFakeRootLocationInterpolation`, `bDefaultInterpolateFakeRootForHumanoids`,
`bDefaultInterpolateFakeRootForCreatures`. Gamebryo moves the actor in steps; UE interpolates a "fake root" to hide
the steps on stairs and uneven ground.

### 4.2 Animation sets

| Mod | Nexus | E / D | What it does | How it is built |
|---|---|---|---|---|
| Female Locomotion Replacer - Unique Walk and Run (Krasue) | [2088](https://www.nexusmods.com/oblivionremastered/mods/2088); v2 crash fix [5430](https://www.nexusmods.com/oblivionremastered/mods/5430) | 2548 / 111615 | Feminine walk, run, sprint, idle | UE4SS script scans actors flagged female and swaps their locomotion animations; author calls it a proof of concept |
| Better Idle Pose (nyyxn) | [3898](https://www.nexusmods.com/oblivionremastered/mods/3898) | 581 / 28935 | Feminine idle | Patch on the above |
| Kei Animations - Pelinal's Edge / Morihaus Might / Legacy | [4816](https://www.nexusmods.com/oblivionremastered/mods/4816), [4817](https://www.nexusmods.com/oblivionremastered/mods/4817), [4825](https://www.nexusmods.com/oblivionremastered/mods/4825) | 177 / 21353; 159 / 22089 | One-handed and two-handed animation overhauls, power attack variations | Cooked AnimSequence replacements |
| Ultra Combat UE4SS V2 (ultramatt) | [4244](https://www.nexusmods.com/oblivionremastered/mods/4244) | 409 / 30235 | Feints, perfect block/dodge that unbalance the enemy, hitstop, locational damage | UE4SS Lua gameplay overhaul |
| Dance and Emote Animation Pack | [5039](https://www.nexusmods.com/oblivionremastered/mods/5039) | 29 / 974 | 39 emotes and dances | Cooked animations |
| Facial Animations for German Dubbing | [5315](https://www.nexusmods.com/oblivionremastered/mods/5315) | 8 / 420 | 106,000+ lip-sync animations matched to German voice | Generated facial animation per line |

### 4.3 Body physics

| Mod | Nexus | E / D | What it does | How it is built |
|---|---|---|---|---|
| Natural Bodies of Oblivion (NBO) with Body Morph (Krasue) | [2877](https://www.nexusmods.com/oblivionremastered/mods/2877) | 6286 / 437333 | New female body, in-game real-time morphing for player and NPCs, adjustable jiggle | A second "expanded" skeleton alongside the vanilla one, with bones for physics and morphs; UE4SS Body Morpher UI; settings saved to JSON per character; Blueprint part in `LogicMods`. The page does not say which solver drives the jiggle; that needs the cooked AnimBP opened in FModel |
| Jiggle Begone (Kas_Dew) | [3772](https://www.nexusmods.com/oblivionremastered/mods/3772) | 54 / 1374 | Sets all NBO jiggle to 0 | Edits NBO's own files |
| Colovian Cuts - Hairstyles with Physics (Everglaid) | [1671](https://www.nexusmods.com/oblivionremastered/mods/1671) | 1683 / 110206 | Four long hairstyles | UE5 Chaos Cloth on hair strands/cards; about 0.30 ms per character per the author; length morphs do not affect cloth-simulated areas; no physics in the inventory preview |
| Spider Daedra Hairstyle (Jenya66) | [1522](https://www.nexusmods.com/oblivionremastered/mods/1522) | 603 / 22858 | Replaces the Loose hairstyle, with physics | Edited `SK_*_HR_Loose(_f)` skeletal meshes; morphs break |
| Capes with physics (CosmicBoogaloo) | [4840](https://www.nexusmods.com/oblivionremastered/mods/4840) | 59 / 5695 | Capes | Chaos Cloth ("I finally figured out cloth physics") |
| Lich King Set with Cape Physics | [4284](https://www.nexusmods.com/oblivionremastered/mods/4284) | 74 / 4367 | Armor with cloth cape | Chaos Cloth |
| Physics Based Combat (Kemper), experimental | [4884](https://www.nexusmods.com/oblivionremastered/mods/4884) | 7 / 79 | Mouse-driven sword arm swinging | Physics-driven hand control |

Remastered modding is young: no ragdoll overhaul exists yet (only "force ragdoll" spells), and body physics is
concentrated in NBO.

---

## 5. What is the best of each kind

- Animation frameworks: Skyrim leads. OAR/DAR conditional replacement, TDM 360° movement, AMR root motion from
  annotations, MCO recovery frames, Precision swing-duration weapon colliders. Nothing in Cyberpunk or Oblivion
  modding comes close.
- Locomotion: Skyrim Vanargand and Leviathan sets (complete per-stance idle/walk/run/strafe/turn/sprint/equip),
  Cyberpunk Immersive Third Person (full TPP set + 360° orientation-follows-velocity). Oblivion classic beni/nao
  replacers and the Remastered Female Locomotion Replacer are clip swaps on the old state machines.
- Combat animation: Skyrim ADXP/MCO movesets (Elden Ring style, 130+ animations) with Precision; Oblivion DMC
  Stylish and CCAO; Remastered Kei overhauls.
- Poses and faces: Cyberpunk pose packs and the 195-expression facial pack; the Cyberpunk face rig itself (JALI
  lipsync, envelope layers) is the strongest technology here. Skyrim Expressive Facial Animation redoes every morph.
- Ragdoll: Skyrim PLANCK (always-on powered ragdoll driven toward the animation, physical hits, grabbing, get-up).
  Cyberpunk SPLAT (profile manager, per-part progressive release, D6 drives) and Ragdoll Physics Overhaul (joint
  limits and self-collision). Skyrim XP32 True Ragdoll Physics shows how much inertia shape, mass split, friction and
  restitution matter. Oblivion Ragdolls for Oblivion for hit-location force.
- Soft-body jiggle: Skyrim CBPC (per-bone damped spring + sphere collisions, runs on every NPC).
- Full secondary physics (hair, capes, skirts, body vs armor): Skyrim HDT-SMP/FSMP (Bullet rigid chains with
  6-DOF, cone-twist and stiff-spring constraints, mesh-vertex and mesh-triangle colliders). Cyberpunk dangle chains
  (dyng particles with link, cone, ellipsoid constraints) and JADE are the lighter equivalent.
- Body shape: Remastered NBO (extra skeleton + runtime morph + per-character JSON); Skyrim CBBE 3BA (three breast
  bones per side, repainted weights, SMP and CBPC presets); Cyberpunk morphtarget/rig slots.
- Cloth: Remastered Chaos Cloth hair and capes; Skyrim SMP capes and skirts. Cyberpunk mods abandoned real cloth
  for bone chains.

---

## 6. What maps onto Vibe Game Engine (UE 5.8)

What the kit has today: `VgeRagdoll` rebuilds the imported character's physics asset with per-role masses and hard
joint limits (`unreal/Source/VibeGameEngineTools/Private/VgeRagdoll.h`); `VgeCloth` builds Chaos Cloth from a
description (`VgeCloth.h`, cloth lab); `VgeRetargeter` retargets onto the mannequin (mixamo-to-manny lab).

Engine features confirmed on disk in `C:\GameEngien\UE_5.8\Engine`:

- Anim nodes in `Source/Runtime/AnimGraphRuntime/Public/BoneControllers`: `AnimNode_AnimDynamics`,
  `AnimNode_RigidBody`, `AnimNode_SpringBone`, `AnimNode_Trail`, `AnimNode_LookAt`, `AnimNode_LegIK`.
- Physics asset constraint profiles: `USkeletalMeshComponent::SetConstraintProfile` /
  `SetConstraintProfileForAll`, `UPhysicsAsset::GetConstraintProfileNames`.
- Plugins: `Animation/PhysicsControl`, `Experimental/ControlRigPhysics` (rig bodies, joints, controls, solver),
  `Experimental/ControlRigDynamics`, `Animation/PoseSearch` (Motion Matching), `Chooser`, `Animation/AnimationWarping`
  (orientation, stride, slope warping), `Animation/MotionWarping`, `Animation/AnimationLocomotionLibrary`,
  `Animation/IKRig`, `Experimental/FullBodyIK`, `Animation/MLDeformer` (Neural Morph, Nearest Neighbor, Vertex Delta,
  Chaos Flesh and Chaos Cloth generators), `Experimental/ChaosFlesh`, `ChaosCloth` + `ChaosClothAsset` (panel cloth,
  Dataflow), `Runtime/HairStrands` (Groom), `Animation/DeformerGraph`, `Experimental/UAF/*` (AnimNext),
  `Experimental/Mover`, MetaHuman plugins (RigLogic face).
- Not in the engine: KawaiiPhysics ([github.com/pafuhana1213/KawaiiPhysics](https://github.com/pafuhana1213/KawaiiPhysics),
  MIT, 3369 stars) - a single AnimGraph node for bone chains with sphere, capsule and plane colliders.

| Technique from the mods | Where it comes from | UE 5.8 equivalent | Fit for our engine |
|---|---|---|---|
| Bone-chain secondary motion with distance, cone and ellipsoid constraints and capsule colliders (hair, jewelry, breasts, skirts) | Cyberpunk dangle (`animAnimNode_Dangle`, dyng solver), JADE | `AnimNode_AnimDynamics` (chains, angular/planar limits, sphere collision, wind), `AnimNode_SpringBone`, `AnimNode_Trail`; Control Rig Physics; KawaiiPhysics as a third-party option | Direct. Needs an AnimBP or Control Rig built from code for imported characters, same way VgeCloth builds cloth. Breast/butt bones must exist in the imported skeleton or be added |
| Ellipsoid "keep out of the chest" constraint | Cyberpunk `animDyngConstraintEllipsoid` | AnimDynamics planar limits and sphere collision; KawaiiPhysics capsule/plane colliders; physics asset bodies with `AnimNode_RigidBody` | Direct |
| Per-bone damped spring with sphere collisions for breasts, butt, belly on every NPC | Skyrim CBP/CBPC | `AnimNode_SpringBone` (one bone, spring stiffness/damping, translation/rotation axes), `AnimNode_AnimDynamics` with sphere collision; or our own node from the CBP formula (MIT source) | Direct; cheapest tier, fits crowds |
| Rigid chains with 6-DOF / cone-twist / stiff-spring constraints and mesh-surface colliders for hair, capes, skirts, body against armor | Skyrim HDT-SMP / FSMP | Physics asset sub-bodies on extra bones simulated by `AnimNode_RigidBody` (Chaos joints have the same linear/angular limits, drives, soft limits); Control Rig Physics; Chaos Cloth for surfaces | Direct for bone chains. Mesh-triangle colliders have no ready UE equivalent; Chaos Cloth collides against physics asset capsules |
| Always-on powered ragdoll following animation, physical hits, grabbing, get-up | Skyrim PLANCK | Physics Control plugin (body and parent-space controls toward the animated pose), `AnimNode_RigidBody` with drives, Physical Animation component | Direct; the strongest single idea for our ragdoll work |
| Weapon collider alive for the whole swing, procedural hit reaction, hitstop | Skyrim Precision | Collision shape on the weapon bone enabled between anim notifies; Physics Control impulse on the hit body; time dilation for hitstop | Direct |
| Conditional animation replacement by actor state | Skyrim OAR/DAR | Chooser tables, Pose Search databases per condition | Direct |
| Root motion authored per clip | Skyrim AMR | Root motion in AnimSequences; Motion Warping | Native in UE |
| Cancelable recovery frames in combos | Skyrim MCO | Anim notify states marking cancel windows | Direct |
| Ragdoll inertia shape, mass split, friction, restitution | Skyrim XP32 True Ragdoll Physics | Physics asset body mass, inertia tensor scale, physical materials (friction, restitution) | Direct; worth adding to VgeRagdoll's per-role table |
| Breasts/butt as real rigid bodies with spring joints | Oblivion BBB ragdoll skeleton (corpses only) | Physics asset bodies on those bones + `AnimNode_RigidBody` for live characters, ragdoll for dead | Direct; extends VgeRagdoll's role table with soft-tissue roles |
| Baked jiggle keys in clips | Oblivion BBB animations | Keys on extra bones in FBX/GLB clips; retarget must carry those bones | Works with no runtime cost, but authored per clip |
| Joint limit and self-collision tuning for ragdolls | Cyberpunk Ragdoll Physics Overhaul, RagdollPunk; Oblivion Ragdolls for Oblivion | Physics asset constraint limits (swing1, swing2, twist), body collision pairs, mass, friction, restitution | VgeRagdoll already sets hard limits and masses by role; collision between non-adjacent bodies and twist limits are the same knobs these mods turned |
| Multiple ragdoll profiles picked at random per death | SPLAT, RagdollPunk Restrained/Flexible | Constraint profiles in the physics asset + `SetConstraintProfileForAll` at runtime | Direct |
| Progressive per-part release after impact, D6 drives toward a pose | SPLAT release timers and D6 targets | Physics Control plugin (per-body controls with strength/damping toward the animation), Physical Animation component, constraint drives | Direct |
| Physical hit reactions and knockdowns, then recovery | RagdollPunk Physical Reactions, SPLAT, Oblivion hit-location force | Physics Control / `AnimNode_RigidBody` blended over animation; impulse at hit location; get-up from the ragdoll pose | Direct |
| Ragdoll at the end of an animated finisher | Enable Finisher Ragdolls | Switch from anim montage to simulated bodies at a notify | Direct |
| Third-person locomotion set with stops, starts, jumps, landings, ledges | Cyberpunk ITP | Pose Search (Motion Matching) over a clip database, Chooser, Animation Warping (orientation, stride, slope), Motion Warping for ledges | Direct; clips come from our own library (Mixamo retarget path) |
| Orientation follows velocity, not the camera, over 360° | ITP True Camera-Oriented Controls | Orientation warping, or rotation from velocity in the movement code | Direct |
| Per-character locomotion variants (female walk, per-NPC walks) | Oblivion Sensual Walks, Blockhead, OR Female Locomotion Replacer | Chooser tables keyed by character traits; separate Pose Search databases | Direct |
| Breathing layered on idles | NoMaaM Breathing Idles | Additive animation layer | Direct |
| Fake-root interpolation to hide stepped movement | Oblivion Remastered `Altar.ini` | Our fixed-tick simulation with render interpolation | Already the kit's model |
| Body shape morphing at runtime, saved per character | NBO, Cyberpunk morphtargets | Morph targets set at runtime; scale bones; ML Deformer for shape-correct deformation | Direct for morph targets; ML Deformer needs a trained model asset |
| Muscle and flesh deformation | not done in any mod found | Chaos Flesh, ML Deformer (Neural Morph) trained from Chaos Flesh | Engine-only; the mods do not do it |
| Hair and garments with real cloth | Oblivion Remastered Colovian Cuts, capes | Chaos Cloth (we build it from code), Groom strands with physics | Direct; Cyberpunk's experience says bone chains are cheaper and more stable for skirts on fast-moving characters |
| Facial expressions and lipsync with separate jaw and lips | Cyberpunk face rig, JALI | Morph targets / Pose Assets, MetaHuman RigLogic (`RigLogicUAF`), audio-driven facial animation in the MetaHuman plugins | Direct for expressions; lipsync depends on the face rig our imported characters carry |
| Pose packs | Cyberpunk photo mode packs | Single-frame AnimSequences | Trivial |

## 7. Which animation sets are open for use

Read on 2026-10-27 from each mod's "Permissions and credits" block on Nexus (agent Chrome, signed in), plus the
mod description for where the motion comes from. Nexus permission fields that matter for taking clips into our
engine: asset use (may the assets be used elsewhere), conversion (may they be moved to another game; our engine
counts as another game), use in sold files. Codes: YES+credit = allowed with credit, ASK = needs the author's
permission, NO = forbidden.

### 7.1 Usable with credit, author's own motion

| Mod | Game | Asset use | Conversion | Sold | Origin of the motion |
|---|---|---|---|---|---|
| Get Up with Style (JL) [52535](https://www.nexusmods.com/skyrimspecialedition/mods/52535) | Skyrim SE | YES+credit | YES+credit | NO | Author's own Blender work: get-up from back and from front |
| Movement Behavior Overhaul (Retrospect) [38950](https://www.nexusmods.com/skyrimspecialedition/mods/38950) | Skyrim SE | YES+credit | YES+credit | NO | Direction-change transitions, sprint stops, crouch slide; the "other assets" field is not filled in, so whether every clip is the author's own is unverified |
| Combat Stance Reanimation (ElAlquimista) [43695](https://www.nexusmods.com/oblivion/mods/43695) | Oblivion | YES+credit | YES+credit | NO | Author's own combat idles, turns, block, walk, run, cast. Author note: "free to use anywhere and upload anywhere but please credit"; modifications after contacting the author |
| Female Locomotion Replacer (Krasue) [2088](https://www.nexusmods.com/oblivionremastered/mods/2088) | Oblivion Remastered | YES+credit | YES+credit | NO | Walk, run, sprint, idle; "all assets belong to the author", no credits to others |

"Sold: NO" holds for every mod checked: none of these clips may go into anything sold. That has to be weighed if a
game built on the kit is ever sold.

### 7.2 Open permissions, but the motion is game data (not usable)

| Mod | Why not |
|---|---|
| Every Animation Redone TPP [16858](https://www.nexusmods.com/cyberpunk2077/mods/16858) (Cyberpunk) | Reworked game animations; the author's permission cannot cover CD Projekt Red's data |
| Fistfight Poses [13178](https://www.nexusmods.com/cyberpunk2077/mods/13178), Impact Poses [12974](https://www.nexusmods.com/cyberpunk2077/mods/12974) (Cyberpunk) | "All poses are based on base game animations" |
| Pristine Vanilla Movement [66635](https://www.nexusmods.com/skyrimspecialedition/mods/66635) (Skyrim) | Edited vanilla walk/run |
| NoMaaM BBB Animation Replacer [35551](https://www.nexusmods.com/oblivion/mods/35551), NoMaaM Breathing Idles [40462](https://www.nexusmods.com/oblivion/mods/40462) (Oblivion) | BBB adaptations of Bethesda's standard animations |
| Feminine Walk and Run - OAR [122728](https://www.nexusmods.com/skyrimspecialedition/mods/122728) (Skyrim) | Credits say "Use motion created by Gunslicer"; the uploader cannot grant rights to Gunslicer's motion |

### 7.3 Need the author's permission (asset use ASK)

Cyberpunk: Immersive Third Person [32203](https://www.nexusmods.com/cyberpunk2077/mods/32203) (also "other
assets" not specified, and the author says some clips resemble other games), Cute and Sexy Pose Pack
[6871](https://www.nexusmods.com/cyberpunk2077/mods/6871), Zwei PMU packs [7165](https://www.nexusmods.com/cyberpunk2077/mods/7165) /
[8361](https://www.nexusmods.com/cyberpunk2077/mods/8361), Action Pose Pack [8698](https://www.nexusmods.com/cyberpunk2077/mods/8698),
M.P.A.F. [6227](https://www.nexusmods.com/cyberpunk2077/mods/6227), CyberScript Animation Archive
[7691](https://www.nexusmods.com/cyberpunk2077/mods/7691). Photomode Facial Expression Mega Pack
[7912](https://www.nexusmods.com/cyberpunk2077/mods/7912) allows asset use with credit but forbids conversion and
is built on the game's face rig.

Skyrim: all Vanargand (8 mods checked) and Leviathan (7 mods checked) by Verolevi; all ADXP/MCO movesets by
black364 (7 checked); Dynamic Dodge Animation, TK Dodge, Arm Movement Animations; Pretty Combat Animations
[3761](https://www.nexusmods.com/skyrimspecialedition/mods/3761) (conversion allowed with credit, asset use ASK) and its
Spell Master part. Fully closed (NO on everything): Elden RIM x DS3 Mashup [112165](https://www.nexusmods.com/skyrimspecialedition/mods/112165),
Expressive Facial Animation female/male [19181](https://www.nexusmods.com/skyrimspecialedition/mods/19181) /
[19532](https://www.nexusmods.com/skyrimspecialedition/mods/19532).

Oblivion: beni's replacers (DMC Stylish, Stylish Jump, Pretty Woman, Natural Walk, Silver Ranger, Spell Singer;
"other assets" not specified), CCAO, Womans Move Running. Fully closed: Womans Move Walking
[33998](https://www.nexusmods.com/oblivion/mods/33998), Sensual Walks for Female NPCs
[28223](https://www.nexusmods.com/oblivion/mods/28223), Personality Idles 4 [14280](https://www.nexusmods.com/oblivion/mods/14280).

Oblivion Remastered: Kei Animations (3 mods; uploaded by someone else "with permission", "other assets" not
specified), Better Idle Pose, Dance and Emote Pack, Simple Jump Flip.

Not read: FNIS Sexy Move and FNIS on the Legendary Edition site returned no permissions block; Blockhead Animations
Compilation likewise.

## 8. Technique studies (code read)

Full notes with file:line references are in the side-session notes folder
(`C:\Users\pavel\AppData\Roaming\Claude\side-session-notes\local_e0a39abf-185c-4ffb-913f-60411961935e\`):
`active-ragdoll-study.md` and `body-physics-study.md`.

### 8.1 Active ragdoll: PLANCK against UE 5.8

- PLANCK source: github.com/adamhynek/activeragdoll, GPL-3.0 (HIGGS too). Methods only, no code.
- PLANCK has no motor of its own. It feeds Havok's ragdoll driver: a world-space rigid-body tracking controller
  (hierarchy gain 0.6, velocity gain 0.6, position gain 0.05) blended with weak joint motors (max force 500,
  tau 0.8, weight 0.05), same gains for every bone. Gravity is zeroed on driven bodies during the step. Joint
  limits are widened every frame so the animated pose is legal, and walked back to authored values while ragdolled.
- Hits: weapon-vs-body contacts classified by speed and direction into swing, stab, punch, with per-target cooldown.
  Flinch is a point impulse on the struck body plus decaying impulses (0.35, 0.25, 0.15) up to three joints away; the
  controllers pull the body back, no animation is played.
- Collision: ragdoll bodies collide with characters, weapons and props, not static world; the player capsule is
  filtered to collide with them with push impulses zeroed both ways.
- Get-up: motors off during ragdoll and get-up, root faded over 0.5 s in and 0.3 s out, no get-up while grabbed.

UE 5.8 options, all runtime:

- `UPhysicsControlComponent` (plugin `Animation/PhysicsControl`, runtime module): world-space and parent-space
  controls as Chaos joint drives, targets from the animated pose every frame with target velocities, per-limb sets,
  per-axis multipliers, gravity multiplier, kinematic/simulated per body, and
  `EAngularDriveLimitViolationResponse::WidenLimits` (`PhysicsControlComponentImpl.cpp:762`), the engine's version
  of PLANCK's limit widening. Reads bone transforms from the mesh, so it works with the kit's `PlayAnimation`
  playback without an anim graph. Functions are BlueprintCallable, reachable from TypeScript.
- `UPhysicalAnimationComponent`: older subset, one strength set, no velocity targets, no limit handling.
- `FAnimNode_RigidBody`: does not drive simulated bodies toward the pose. `FAnimNode_RigidBodyWithControl` and
  ControlRigPhysics run a private simulation with world objects copied in as kinematic, so collision is one-way:
  unsuitable for character-vs-character pushing and weapon hits.

Verdict: `UPhysicsControlComponent` on the physics asset VgeRagdoll builds, in the main Chaos world. Build:
VgeRagdoll sets WidenLimits on every joint, adds constraint profiles for fall styles, emits per-role control
strengths; a Vge runtime component wraps the Physics Control component, builds limbs from the roles and runs states
driven, hit, ragdoll with progressive release, get-up; weapon-vs-body hit detection with PLANCK's classification;
the PhysicsControl plugin enabled in the project; the ragdoll lab extended with push, hit, knockdown, get-up.

### 8.2 Body physics: CBPC and HDT-SMP against UE 5.8

- CBP/CBPC: explicit Euler spring with the force held constant over the frame's substeps; stability comes from
  clamps, dt clamps, friction on collision, skipped frames and one-frame averaging. Collision is an offset applied
  after the spring, not a constraint in the solve. (CBPC source read: Acro748/CBPCSSE, MIT; that it matches the
  current Nexus release is unverified.)
- HDT-SMP/FSMP: real Bullet rigid bodies; its unique strength is colliders made from the skinned mesh itself, per
  vertex and per triangle. Cost grows with mesh detail; GPL-3.0.
- Neither is the right base. The better method is what the Cyberpunk dangle code, KawaiiPhysics and UE's
  ControlRigDynamics share: particle chains with fixed substeps and XPBD/position-based constraints. It covers
  CBPC's job (one-particle chain with a compliant target, a confiner, body colliders) and SMP's bone chains, with
  stiffness independent of frame time.

Verdict, three complete tiers:

1. One XPBD particle solver for soft tissue, hair, jewelry and bone-chain skirts, as a new node in the kit's runtime
   anim graph (`UVgeAnimInstance`, next to `FVgeAnimNode_TwoBoneIK` in `VgeAnimNodes.h`). Solver core: the
   engine's `RigParticleSimulation` from `Experimental/ControlRigDynamics` (exported, header says it is kept
   independent of Control Rig, `RigParticleSimulation.h:20`): targets, angle and cone limits, distance constraints,
   particle contacts, colliders, confiners. Gaps: no tapered-capsule or mesh colliders, experimental, the bone
   write-back is ours. Alternative: KawaiiPhysics (MIT), richer colliders, but a third-party download, which is the
   user's call.
2. Chaos Cloth, already built from `.cloth.json` by VgeCloth, for capes and dresses; for mesh-accurate body collision
   it can use skinned-triangle-mesh and level-set colliders (`ChaosClothingSimulationCollider.cpp:738-790`).
3. Physics Control (8.1) for ragdolls and hit reactions only.

Imported rigs have no jiggle bones; they can be added at import with `USkeletonModifier` (editor module, available
to the import commandlet).

## 9. Breast and butt motion that looks good

Scope set by the user on 2026-10-27: clips are for the kit's showcases, not a sold product; locomotion will most
likely come from GASP (Epic's Game Animation Sample, Motion Matching on the UE5 mannequin); the priority is breast
and butt physics that look beautiful.

### 9.1 The skeleton has no soft-tissue bones

The UE5 mannequin skeleton (read from the bone names in
`Engine/Plugins/Experimental/MoverExamples/Content/Characters/Mannequins/Meshes/SK_Mannequin.uasset`) has corrective
bones (`clavicle_pec_l/r`, `spine_04_latissimus_l/r`, `thigh_bck_l/r`, `thigh_fwd_l/r`, `thigh_in_l/r`, twist
bones) but no breast, butt or belly bones. GASP and MetaHumans use this skeleton family, so soft-tissue bones have
to be added to the character (at import, `USkeletonModifier`, see 8.2) and the mesh weighted to them. GASP is not on
this machine.

### 9.2 What the best-looking setups do (read from the 3BA CBPC configs and the mod authors)

Source of the numbers: CBPC repository `Acro748/CBPCSSE` (MIT), folder `config/3BA and BHUNP/skse/plugins`, the
configs 3BA ships. Each value line holds two numbers, for body weight 0 and weight 100.

1. Three bones per breast, not one. 3BA's `L Breast01` -> `L Breast02` -> `L Breast03` (`CBPCMasterConfig_3BA.txt`)
   with weights "repainted and more spread out" (3BA page). BHUNP uses the same three-bone standard. One bone moves
   the breast like a solid object; three let the base stay firm while the tip lags.
2. Different spring and damping per bone along the chain (`CBPConfig_3b.txt`): the tip bone (Breast03) has higher
   stiffness (0.0268 vs 0.02), almost no second-order stiffness (stiffness2 0.0023 vs 0.02), the highest damping
   (dampingZ 0.0552 vs 0.0326 and 0.0232) and a smaller time step; the middle bone (Breast02) has the most vertical
   travel (linearZ 0.926 vs 0.58) and the lowest damping. Realistic Breast Physics for Cyberpunk
   ([33650](https://www.nexusmods.com/cyberpunk2077/mods/33650)) states the same principle: upper and lower sections
   get different spring and damping "to stop the whole breast from moving around like one solid object".
3. Translation and rotation both, coupled. Each bone has separate linear and rotational parameters
   (`stiffnessXRot`, `dampingXRot`, `rotationalX/Y/Z`) and cross terms that turn linear motion into rotation
   (`linearZrotationX`: vertical bounce becomes forward pitch) and overflow into other axes when an axis hits its
   limit (`linearZspreadforceX 1`, `linearXspreadforceZ 0.4`).
4. Asymmetric limits. Butt (`CBPConfig_butt.txt`): Z travel -4.5 down but only +1.5 up; collision Y +1.0 forward
   but -5.0 back, so tissue sags and swings out but never sinks into the pelvis. Breasts limit rotation tighter
   downward (`ZminoffsetRot` -1.3 to -1.76) than translation (-2.3 to -2.76).
5. Fast rebound, short tail. The complaint every realism preset answers is the slow "underwater" wobble:
   Realistic Breast Physics aims for "faster rebound, less floaty, less endless wobbling"; 3BA RFBBBT
   ([59123](https://www.nexusmods.com/skyrimspecialedition/mods/59123)) for "firmer, less ultra-jiggly". In spring
   terms: higher stiffness with damping close to critical on the tip, so motion is visible on impact (steps,
   landings) and dies in one or two oscillations.
6. Scale by body and context. Every value interpolates between body weight 0 and 100; CBPC also has posture sag,
   "auto push-up" under armor and per-armor amplitude (`breastClothedPushup`, `breastLightArmoredAmplitude`, ...),
   and bounce strength by NPC weight. Clothing changes how much tissue moves.
7. Collision with the body and hands. Capsules and spheres on arms, hands, fingers, chest and pelvis
   (`CBPCollisionConfig_Female.txt`), friction 0.02 on breasts, and elastic collision response. Petite to Plenty
   ([82745](https://www.nexusmods.com/skyrimspecialedition/mods/82745)) retuned every finger node because breast
   collision benefited from it.
8. Mesh density. 3BA adds vertices to the breasts so deformation curves stay smooth.

For our XPBD chain node (8.2 tier 1) this means: three particles per breast and one or two per buttock, per-particle
compliance and damping instead of one value per chain, linear and angular targets with coupling, per-axis asymmetric
limits as confiners, body and hand capsules from the physics asset, presets interpolated by body size, and
character-motion impulses (step, landing) as the main driver, so it reacts to GASP locomotion.

## 10. Walks and reactions for showcases

Strongest candidates from the mods read (permission status from section 7; game-derived clips excluded):

- Walks, idles: Vanargand and Leviathan female/male idle-walk-run sets, Goetia female idle walk run
  ([68005](https://www.nexusmods.com/skyrimspecialedition/mods/68005), E10427 / D2958826, magic-user mood), all by
  Verolevi (asset use ASK); EVG Conditional Idles ([34006](https://www.nexusmods.com/skyrimspecialedition/mods/34006),
  E29572, handmade context idles); Pretty Female Idles ([3760](https://www.nexusmods.com/skyrimspecialedition/mods/3760));
  Female Locomotion Replacer for Oblivion Remastered (open with credit); Combat Stance Reanimation (Oblivion, open
  with credit).
- Reactions: Get Up with Style (open with credit), Super Fast Get Up ([46714](https://www.nexusmods.com/skyrimspecialedition/mods/46714),
  handmade), Large Stagger Animation ([68696](https://www.nexusmods.com/skyrimspecialedition/mods/68696), mocap),
  Movement Behavior Overhaul transitions (open with credit).
- Physical reactions as a technique: Skyrim Delirium ([196333](https://www.nexusmods.com/skyrimspecialedition/mods/196333),
  released 2026-10-22): Euphoria-style behaviour on the game's ragdoll - stumbling with balance recovery, clutching
  wounds, curling or windmilling when thrown, writhing on the ground, physical deaths, a weighted reaction table per
  situation. Its engine, Delirium (github.com/PVCPC/delirium-physics, Rust, GPL-3.0, with an SDK), is open source and
  worth reading next to the Physics Control plan in 8.1.

Clip formats: Skyrim `.hkx` (Havok), Cyberpunk `.anims` (WolvenKit exports GLB), Oblivion `.kf` (Blender NIF
tools), Oblivion Remastered cooked UE AnimSequences. All need a retarget to the UE5 mannequin, which the kit's
retargeter does.

## 11. Character bases

| Base | Licence for our use | Soft-tissue bones | Notes |
|---|---|---|---|
| MetaHuman (plugins on disk: `Engine/Plugins/MetaHuman/MetaHumanCharacter`, Creator inside UE since 5.6) | For use in Unreal Engine | No (UE5 mannequin family, corrective bones only) | Best faces and body types; Creator runs in the editor as an authoring tool |
| MPFB / MakeHuman | Base mesh, targets, skins CC0; code GPL/AGPL | Not confirmed | Fully open; any body shape by sliders; rig and breast bones need checking |
| Character Creator 4/5 (Reallusion) | Paid | Breast bones exist in its skeleton (spring bones set in CC/iClone); whether Auto Setup for Unreal carries them is unverified | Strong realistic bodies, morphs |
| Daz Genesis 9 | Game use needs the Interactive License add-on per product | Not confirmed | Huge content library |
| VRoid / VRM | Per-model permissions in the VRM metadata | Spring bones in the format (VRM4U imports them as swing bones) | Anime style |
| Fab / RenderHub bases rigged to the UE5 skeleton with chest and butt jiggle joints | Paid, per listing | Yes (listing claims) | E.g. "Perfect Female Body basemesh" on RenderHub: Epic skeleton plus chest and buttock joints |
| Tripo (MCP in this setup) + kit retarget | Generated | No; bones to be added | Fast custom characters |

## 12. Open items for the next step

- Creating skinned-triangle-mesh and level-set physics asset elements from code (unverified).
- Which API writes skin weights for bones added with `USkeletonModifier` (unverified).

- Which solver NBO uses for jiggle (cooked AnimBP read in FModel) - would need the mod downloaded; not done.
- Whether to read the WolvenKit dangle solver's numerical core (`collisiontools/dangles/sim/*.py`) in full as a
  reference design for our own chain node.
- Which of the items in section 5 become labs in the kit first.
