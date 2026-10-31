# Ocean at the level of Tidewater

The task: a bay or lagoon in the game whose ocean is at least at the level of
[dgreenheck/tidewater](https://github.com/dgreenheck/tidewater), and exactly how to get there in this engine. This
document reads Tidewater's source and UE 5.8's water code (the Water plugin, the WaterAdvanced plugin and the
renderer). It ends with one recommended approach for this kit.

Every claim carries its source:
- Tidewater: `path:line` at commit `4811ba48d795197de5621985f404e765c0b7c0ef` (MIT, `LICENSE`), paths under `src/`.
- The engine: paths under `C:\GameEngien\UE_5.8\Engine`.
- This repository: paths relative to its root.

Anything not checked is listed under "Not verified" at the end. All Tidewater distances are in metres; UE works in
centimetres.

## 1. The answer in one paragraph

UE 5.8 has no ocean at Tidewater's level.
- The Water plugin renders a sum of Gerstner waves. Its spectrum-based wave generator is an empty stub.
- The only FFT ocean in the engine is a single Phillips-spectrum patch in the experimental WaterAdvanced plugin. It is
  a Niagara grid that writes a normal map for river materials.

So the way to reach Tidewater is to port its ocean system into a VGE runtime module:
- **FFT cascades:** four 256² JONSWAP/TMA cascades with Jacobian foam, as RDG compute shaders, written to texture
  arrays that the water material samples.
- **Shore waves and swash:** the depth-aware analytic shore waves and the swash run-up, driven by a wave travel-time
  field that the dev server computes from the TypeScript terrain height function.
- **Foam fields:** the shore foam and wetness advection field as RDG compute.
- **Caustics and underwater:** photon-splatted caustics, and an underwater pass in a scene view extension.
- **Shading:** the sea is shaded through UE's SingleLayerWater path, so it keeps Lumen reflections, depth, velocity
  and shadows. All of Tidewater's per-vertex and per-pixel surface logic goes in through material Custom nodes that
  include the ported shader files.
- **Driving and content:** TypeScript drives every parameter and the LOD grid. The content service bakes the static
  inputs.

## 2. Tidewater, read from source

### 2.1 Overall structure

The ocean is a set of systems that expose WGSL modules to each other, listed in the porting notes
(`docs/PORTING.md:61-78`):

| System | File | What it is |
|---|---|---|
| FFT cascades | `ocean/OceanFFT.js` | Deep-water spectrum, displacement, derivatives, foam |
| Surface composition | `ocean/WaterSurface.js` | Vertex and fragment functions that add up all contributions |
| Shore waves | `ocean/ShoreWaves.js` | Analytic depth-aware breakers, swash run-up, surf-zone medium |
| Shore travel-time field | `world/ShoreField.js` | Offline Eikonal solve (Fast Marching) |
| Shore foam field | `ocean/ShoreSim.js` | Per-frame Eulerian foam, wetness and residue |
| Breaker lips and spray | `ocean/Breakers.js` | Crest finder, lip ribbon mesh, spray emission |
| Surf foam look | `ocean/SurfFoam.js` | Whitewater, lace and bubble shading |
| Caustics | `ocean/Caustics.js` | Rasterised photon splatting |
| Refraction source | `ocean/RefractionPass.js` | The scene below the water only, re-rendered |
| Underwater lighting | `ocean/UnderwaterLighting.js` | Lighting hooks for every material under water |
| Water shader | `ocean/WaterMaterial.js` | Custom shading of the sea |
| Underwater view | `post/Underwater.js` | Lens medium, fog, light shafts, meniscus |
| Boat wake | `ocean/WakeSim.js` | Linear free-surface simulation |
| Sea detail | `ocean/SeaDetail.js` | Gusts, slicks and windrows |
| Water queries | `ocean/WaterQuery.js` | GPU height queries with CPU readback |

The surface mesh is a CDLOD quadtree (Strugar 2010): a 32×32 grid instanced per node, with geomorphing at LOD
borders (`core/CDLOD.js:5-15`). It is created with `gridSize 32, leafSize 8, levels 12` (`App.js:176`).

### 2.2 FFT cascades (`ocean/OceanFFT.js`)

**Cascades and resolution**
- 4 cascades of 256×256 (`FFT_SIZE = 256`, `OceanFFT.js:26`; `cascades ?? 4`, `:86`).
- Tile sizes are 733, 157, 33.3 and 7.1 m. The ratios are deliberately not integers, so the tiles do not repeat
  visibly (`:31-32`).
- Each cascade owns a band of wavenumbers. The low cut is `6·2π/L_i`, the high cut is `6·2π/L_{i+1}`, and the first
  and last cascades are open-ended (`:204-206`).

**Spectrum**
- JONSWAP with the TMA finite-depth correction (`tmaCorrection`, `jonswap`, `:253-271`).
- Finite-depth dispersion `ω = sqrt(g k tanh(k d))` and its derivative (`:244-251`), with depth 500 m (`:88`).
- Directional spreading blends a cos² base with the normalised Donelan-Banner-like `cos^2s` form, `spreadBlend` and a
  swell term (`:273-290`). A short-wave fade `exp(-f² k²)` is applied (`:292`).
- Two wave systems are summed, a local wind sea and a swell:
  - Local: 7 m/s, 25°, fetch 120 km (`:90`).
  - Swell: scale 0.48, 6 m/s, 5°, fetch 1200 km, swell 0.9 (`:91`).
- `alpha = 0.076 (gF/U²)^-0.22`, `ωp = 22 (U F/g²)^-0.33`, `γ = 3.3` (`:218-224`, `:46`).
- The amplitude is `sqrt(S |dω/dk| / k · dk²) · 0.5`, with Box-Muller Gaussians from a PCG hash (`:329-340`).
- The conjugate pair is packed so that a single complex IFFT yields real fields (`:349-365`).

**Per-frame work**
- Exactly two compute dispatches for all cascades (`:7-11`, `:625-632`).
- The row pass time-evolves `h0 → h(k,t)` and builds 4 packed complex fields. It runs a 256-point radix-2 IFFT per row
  in workgroup memory with 128 threads (`:408-463`).
- The column pass runs the IFFT per column and applies the sign correction (`:467-526`).
- The packing is `c0 = Dx + iDz`, `c1 = Dy + i·dDx/dz`, `c2 = dDy/dx + i·dDy/dz`, `c3 = dDx/dx + i·dDz/dz`
  (`:13-15`, `:437-446`).

**Outputs**
- Two `rgba16float` 2D-array textures, one layer per cascade, with a full mip chain built in compute (`:135-142`,
  `:529-606`):
  - displacement `(λDx, Dy, λDz, foam)`
  - derivatives `(dDy/dx, dDy/dz, λdDx/dx, λdDz/dz)`
- Choppiness `λ = 0.9` (`:102`).

**Jacobian foam**
- `J = (1+λDxx)(1+λDzz) − (λDxz)²` (`:505-508`).
- Foam is generated where `J < foamBias` (0.58), then decays: `f = prev·exp(−0.35 dt) + gen·2.5·dt` (`:510-516`,
  `:105-108`). This leaves trailing whitecap patches.

### 2.3 Surface composition (`ocean/WaterSurface.js`)

**Vertex stage**
- Per cascade it samples displacement at a mip level band-limited to the mesh spacing,
  `log2(spacing/texel) + 0.7` (`WaterSurface.js:121-138`).
- Each cascade is attenuated by depth: long cascades vanish in shallow water, short ones persist
  (`waterSurfaceCascadeAttenuation`, `:55-77`).
- Per-vertex foam is the per-cascade weighted foam channel, with weights 0.35, 0.45, 0.5 and 0.25 (`:53`, `:133-137`).
- Shore waves are added where depth is under 26 m (`:180-194`).
- The swash sheet is merged with a smooth max, except on steep rock. Where the sheet is the surface, horizontal motion
  is removed (`:199-219`).
- Water is hidden below dry land (`:220-223`).

**Fragment stage**
- Derivatives are summed over all 4 cascades with 4× anisotropic filtering. The two finest are damped by the gust and
  slick roughness (`:241-250`, `:289-291`).
- Near-field capillary detail re-samples the finest cascade at about 1 m and 2.3 m tiles, rotated. This applies where
  a pixel's footprint is under 4 cm (`:293-305`).
- The shore normal is combined with the FFT detail by reoriented normal mapping (`:318-338`).
- Whitecaps are persistent foam plus fresh Jacobian foam, modulated by gusts and windrow streaks (`:341-346`).
- The foam pattern is a bubbly-mat texture thresholded by coverage, with two rotated layers that fade to plain coverage
  at distance (`:348-361`). The texture comes from `ocean/FoamTexture.js:3-12`.

### 2.4 Depth-aware shore waves, breakers and swash (`ocean/ShoreWaves.js`, `world/ShoreField.js`)

**The travel-time field (offline, CPU)**
- `computeShoreField` solves the Eikonal equation `|∇T| = 1/c` with `c = sqrt(g·clamp(d, 0.25, 25))` by the Fast
  Marching Method on a 512² grid (`ShoreField.js:3-11`, `:65-84`, `:126-149`; `App.js:152`).
- Sources are the domain borders, initialised as a plane wave along the swell direction (`:95-106`).
- T is extended onto land for swash timing and smoothed (`:154-212`).
- The output texture holds `(T, dir·exposure, T at the shoreline)` (`:215-237`).
- The result: wave fronts refract around headlands and align with depth contours.

**The phase**
- `s = (t − T)/period + wobble(along)` (`ShoreWaves.js:510-519`), with a period of 9 s (`:180`).
- Each wave m has its own amplitude: sets of about 7 waves, per-wave randomness and along-shore peaks, so waves peel
  instead of closing out (`:304-318`).
- A procedural bar with rip channels changes height and phase along the beach (`:278-300`).

**The breaking profile (analytic)**
- The break depth comes from Green's-law shoaling, `H = γd` with `γ = 0.78` (`:322-346`, `:183`).
- The cross-section goes from a peaked cnoidal-like shoaling wave to a plunging elliptic face, then to a bore with a
  roller (`shoreProfile`, `:381-420`).
- Whitewater appears at the plunge point, then on the collapsing face and the roller (`:357-376`).
- The roller relief is Perlin lumps with their own slope in the normal (`:102-129`).
- Light through thin crests: `shoreCrestPath` marches the refracted view ray through the analytic cross-section, up to
  3 steps, to find where the ray leaves the back of the wave (`:523-568`).

**Swash**
- The run-up is analytic per wave (`shoreSwashRunup`, `:575-597`).
- Vertical run-up is about `2.1·A` (`:585`). It is converted to a horizontal excursion with beach slope 0.066 (`:38`).
- The uprush takes 0.4 of the period and decelerates. The backwash takes 0.55 and accelerates (`:39`, `:586-590`).
- The front is lobed along the beach (`:591-595`).
- The sheet thickness is a few centimetres (`:141-143`).
- The water shader cuts the sheet exactly on the analytic front, per pixel (`shoreSwashEdge`, `:602-621`).

**Breaker lips and spray (`ocean/Breakers.js`)**
- Stations are placed every 0.6 m along the shore. A compute pass finds crests as integer crossings of the same phase
  field (`Breakers.js:6-13`).
- The thrown lip is a separate ballistic ribbon mesh extruded along the crest, after Thuerey et al. 2007
  (`:24-28`).
- Spray is emitted at lip, plunge, roller and spindrift rates (`:14-21`). Drops that fall back deposit foam in
  ShoreSim (`:22`).

### 2.5 The "shallow-water simulation for swash" (`ocean/ShoreSim.js`)

The README lists "a shallow-water simulation for swash". The code shows that ShoreSim does not solve the
shallow-water equations for height and momentum. It is an Eulerian state over the main beach, on a 768² grid over
380 m (`ShoreSim.js:26`), updated every frame. Its channels:

| Channel | Meaning |
|---|---|
| r | Foam carried by the water |
| g | Sand wetness |
| b | Foam stranded on the sand |
| a | Depth-averaged flow speed |

(`:5-12`)

**Each frame**
- The flow velocity is read from the analytic shore waves: `c·η/h` for the waves and `dR/dt` for the swash tip
  (`ShoreWaves.js:149-157`).
- Foam is advected semi-Lagrangian along that flow (`ShoreSim.js:212-214`).
- Foam is generated from roller, swash front and spray deposits, decays, and is diluted by the flow divergence
  (`:216-234`).
- Wetness is saturated while covered and dries over 28 s (`:236-237`, `:35`).
- Stranded residue forms when the water leaves (`:239-242`).

The run-up itself is the analytic `shoreSwashRunup` from 2.4. The only wave PDE simulation in Tidewater is the boat
wake (`ocean/WakeSim.js:26-50`):
- A linear free-surface wave model: `dw/dt = −g L[h+P]`, `dh/dt = w` with the operator `L = |k| tanh(|k|d)`.
- 512² cells of 0.4 m, solved spectrally by FFT.
- Four depth operators (∞, 6, 1.8, 0.6 m), a hull pressure source and a turbulent eddy viscosity.

### 2.6 Water shading (`ocean/WaterMaterial.js`)

The sea is custom-shaded, not with the scene lighting model, in its own pass after the opaques. It reads a copy of the
opaque colour and depth (`WaterMaterial.js:45-53`).

**Air or water side**
- The side of the interface is picked from the camera height relative to the water and from the face. Folds of the
  choppy surface fall back to the camera's medium (`:286-303`).

**Roughness**
- Cox-Munk unresolved slope variance, `mss = 0.003 + 0.00512 U`. It is weighted by how much of the slope spectrum the
  pixel footprint does not resolve, plus foam and aeration (`:305-312`).

**Reflection**
- Exact dielectric Fresnel (IOR 1.333) (`:17-25`, `:331`).
- Sky radiance in the reflected direction, tilted up by the unresolved facet spread. Reflections below the horizon fade
  to a dark sea colour (`:333-344`).
- Screen-space reflection: 11 geometric steps plus 3 bisection steps on the opaque depth. It is skipped for steep rays
  and low Fresnel (`:346-357`, `:686-737`).
- Optional planar reflection (`:358-362`).

**Sun**
- GGX with Smith visibility. Sun light includes the shadow map, cloud shadow and terrain horizon shadow (`:236-241`,
  `:366-374`).

**Refraction and the water volume**
- The view ray is refracted by Snell's law. It is followed to the seabed against the terrain heightfield with 2
  refinements (`:376-395`). The comment notes that a straight screen ray overestimates the water path about 10× at
  grazing angles (`:377-378`).
- The seabed colour comes from the below-water-only image (`RefractionPass`) at the refracted end point. It falls back
  to the opaque copy (`:410-469`).

**Absorption and scattering**
- Beer-Lambert with `σa = (0.42, 0.075, 0.035)` and `σs = (0.012, 0.018, 0.024)` per metre (`engine/render/Frame.js:50-52`).
- The surf-zone medium adds sand and bubble scattering and absorption (`ShoreWaves.js:497-505`). Aeration adds
  scattering (`WaterMaterial.js:482-494`).
- In-scattering is analytic single scattering of refracted sun and ambient along the refracted path. It uses a
  Henyey-Greenstein phase (g = 0.86) plus a Gordon-style multiple-scattering backscatter term (`:496-514`).
- Crest translucency adds sun light through thin tips (`:516-524`).

**Foam and the swash edge**
- Foam is lit as a diffuse scatterer through `surfFoamLight` (`:529-532`; `SurfFoam.js:3-19`).
- The swash edge has a meniscus normal, a bright rim, an anti-aliased edge and a contact shadow on the sand
  (`:250-277`, `:534-547`).

**Below the water**
- Snell's window to the sky, total internal reflection of the lit water body, and objects above seen through the
  window (`:549-587`).

### 2.7 Refraction source, caustics and underwater (`RefractionPass.js`, `Caustics.js`, `UnderwaterLighting.js`, `post/Underwater.js`)

**Refraction source**
- The scene is re-rendered at 0.5 scale (`App.js:229`), discarding fragments higher than sea level + 0.4 m. Objects
  above the water therefore never hide the seabed (`RefractionPass.js:6-16`, `:27`).
- A guard band extends the image below the screen bottom, where refracted rays land (`:20-32`).

**Caustics**
- Rasterised photon splatting, as in Evan Wallace's WebGL Water (`Caustics.js:5-17`).
- A grid over one FFT tile is displaced to where the refracted sun ray hits a plane D metres below. Additive blending
  writes the area ratio, which is the light concentration.
- Two layers (`:164-166`):
  - fine: the finest cascade, 512² texture, 256² grid, planes at 1.2 m and 4 m
  - broad: the next cascade, 256² texture, 128² grid, planes at 3 m and 9 m
- The planes are blended by the real depth at lookup.

**Underwater lighting**
- Lighting hooks are installed into every scene material (`UnderwaterLighting.js:18-34`):
  - direct sun is attenuated along the refracted sun path and modulated by caustics and surf foam shadow
  - ambient is attenuated and tinted with depth
- Wave terms are baked per frame into two camera-centred maps, 128 m and 1 km wide (`:9-16`).

**Underwater view (post)**
- The medium is decided per pixel at the near plane, so the view splits at the waterline (`post/Underwater.js:10-17`).
- Beer-Lambert plus analytic single scattering.
- Ray-marched caustic light shafts at half resolution (`:89-116`).
- A meniscus band along the waterline on the lens.
- Water droplets on the lens after surfacing (`post/LensDroplets.js:3-8`).

### 2.8 Sky and post (the parts the water depends on)

- **Sky and atmosphere:** Hillaire 2020 atmosphere with transmittance and sky-view LUTs (`sky/Atmosphere.js:8-19`).
  The sky module provides `skyReflectionRadiance` and `skyRadianceWithClouds`, which the water reflects and refracts
  (`sky/Sky.js:19-20`, `:176-185`).
- **Clouds:** volumetric cumulus with the Nubis density model (`sky/Clouds.js:10-15`).
- **Environment:** an environment cube with GGX prefilter and SH irradiance (`sky/Environment.js:9-18`).
- **Post chain:** GTAO, then the underwater and waterline composite, then FSR2-style temporal upscale
  (`post/PostFX.js:21-24`; `post/TemporalUpscale.js:12-15`).
- **Sea haze:** two exponential height layers (`post/AirHaze.js:13-16`).

### 2.9 Sea detail and queries

- `SeaDetail` adds world-space gusts (cat's paws), surfactant slicks and Langmuir windrows. They never repeat with the
  FFT tiles (`ocean/SeaDetail.js:7-17`).
- `WaterQuery` solves the Eulerian height `x0 + D(x0) = xz` by fixed-point iteration on the GPU. Slot 0 is the
  camera. Results are read back to the CPU 1-3 frames later (`ocean/WaterQuery.js:6-22`).

## 3. UE 5.8 Water plugin, read from source

The plugin is at `Plugins/Experimental/Water`.

### 3.1 What it renders

**Gerstner only**
- The wave model is a sum of Gerstner waves (`Source/Runtime/Public/GerstnerWaterWaves.h:166-175`). The GPU loops over
  `NumWaves` per vertex (`Shaders/Private/GerstnerWaveFunctions.ush:357-374`).
- The waves come from a generator:
  - `UGerstnerWaterWaveGeneratorSimple` makes N waves from wavelength, amplitude and direction ranges
    (`GerstnerWaterWaves.h:92-145`).
  - `UGerstnerWaterWaveGeneratorSpectrum` exposes `Phillips / PiersonMoskowitz / JONSWAP` (`:67-74`, `:147-160`), but
    its implementation is empty: `// [todo] kevin.ortegren: implement` (`Source/Runtime/Private/GerstnerWaterWaves.cpp:143-146`).
- A grep of the whole plugin for FFT, Tessendorf, JONSWAP and Phillips finds only that enum.

**Depth attenuation**
- `exp(−depth / (TargetWaveMaskDepth/2))` (`GerstnerWaveFunctions.ush:420-432`).

**Mesh**
- A GPU quadtree water mesh (`WaterMeshComponent`, `WaterQuadTreeGPU`, `Shaders/Private/WaterQuadTree*.usf`).

### 3.2 WaterZone and the water info texture

- `AWaterZone::UpdateWaterInfoTexture` creates a transient `UTextureRenderTarget2DArray` at runtime and queues a
  render through `FWaterViewExtension` (`Source/Runtime/Private/WaterZoneActor.cpp:637-858`, `:826-852`).
- Its ground is every `ALandscapeProxy` that intersects the zone, or `UWaterTerrainComponent` primitives
  (`:720-764`).
- It returns early only on PSO precache, editor shader compilation or disabled world rendering (`:684-708`,
  `:773-824`).
- Channels: flow velocity XY, normalised water Z, normalised ground Z (`WaterInfoRendering.cpp:60`;
  `Shaders/Private/WaterInfoMerge.usf:88-107`).

### 3.3 Shoreline foam

- No C++ or shader code in the plugin computes shoreline foam. It lives in the material asset
  `Content/Materials/WaterSurface/Water_Material.uasset`.
- That asset references `/Water/Materials/Layers/BeachFoam`, `/Water/FluidSimulation/WaveFoam/WaterDistanceField`,
  `FoamRT` and the parameters "Depth for DF Foam" and "Foam Distance". These were read as strings from the binary
  asset; the graph itself was not read.

### 3.4 Underwater post process

- Each `UWaterBodyComponent` carries an `UnderwaterPostProcessMaterial` and settings, turned into a MID
  (`WaterBodyComponent.cpp:315-345`, `:1068-1140`).
- The subsystem registers a `UUnderwaterPostProcessVolume` and chooses the active water body per view in
  `ComputeUnderwaterPostProcess` (`WaterSubsystem.cpp:318-321`, `:801-827`).
- The content materials are `Content/Materials/PostProcessing/M_UnderWater_PostProcess_Volume.uasset` and `_Mesh`.
- This is a post-process material blend. There is no per-pixel near-plane medium split in C++.

### 3.5 Caustics

- The plugin has no runtime caustics code.
- `Content/Caustics/Blueprints/GenerateCausticsTextures.uasset` is an editor Blueprint. It references
  `/Script/UnrealEd`, `BeginDrawCanvasToRenderTarget` and `RenderTargetCreateStaticTexture2DEditorOnly` (strings of
  the binary asset), so it bakes static textures in the editor.
- The runtime side is material functions (`WaterCaustics_GerstnerWaves`, `WaterCaustics_SubUVAnimation`, …) and light
  function materials (`M_Caustics_LightFunction_Sun`) (`Content/Caustics/Materials`).

### 3.6 Fluid simulation

- `Content/FluidSimulation/Blueprints/Components/ShallowWaterSimComponent.uasset` is a Blueprint ActorComponent that
  runs on `DrawMaterialToRenderTarget` (strings of the binary asset). There is no C++ shallow-water solver in the Water
  plugin.

### 3.7 Ocean and WaterZone placed by our content service, then played in a packaged game

**What works at runtime:** the water info texture is a transient render target filled at runtime from landscapes and
water bodies (3.2), so it does not depend on the editor.

**What blocks it in our pipeline:**
- Water bodies need their water info mesh, generated from the spline. For the ocean this is `GenerateWaterBodyMesh`, a
  constrained Delaunay of the island spline inside the ocean extents (`WaterBodyOceanComponent.cpp:205-244`).
- That generation runs in `UpdateWaterBodyRenderData` only when `FApp::CanEverRender() || IsRunningCookCommandlet()`,
  and only before BeginPlay (`WaterBodyComponent.cpp:2124-2142`).
- Our content service runs with `-nullrhi` (`vge/content/service.mjs:18`), so `CanEverRender` is false there. A water
  body spawned by the service would be saved without that mesh.
- On load, `OnPostRegisterAllComponents` regenerates it only for old package versions or a mismatched
  conservative-raster mesh, and only `#if WITH_EDITOR` (`WaterBodyComponent.cpp:1640-1678`).
- Our cooker does run as a cook commandlet (`vge/content/cooker.mjs:20`). Whether the cook-time regeneration happens
  for a freshly saved body was not traced to the end (see Not verified).

**Enabling the plugin:**
- Water is `EnabledByDefault: false` and `IsExperimentalVersion: true`. It depends on Landmass, Niagara,
  GeometryProcessing and BlueprintMaterialTextureNodes (`Water.uplugin`).
- The runtime module loads at `PostConfigInit` because it registers its shader directory there
  (`Water.uplugin:21`; `Source/Runtime/Private/WaterModule.cpp:21`).
- Landscape carving by water bodies goes through the editor module and Landmass brushes (`Source/Editor`). Our
  terrain is imported directly from a height array (`unreal/Source/VibeGameEngineTools/Private/VgeTerrain.cpp:204-219`).

**Conclusion:** the plugin's look is bounded by its Gerstner sum. Its geometry needs editor-time mesh generation that
our `-nullrhi` service skips. Its shore foam, caustics and underwater effects are material assets, not systems. None
of it reaches Tidewater.

## 4. FFT oceans and reusable features elsewhere in UE 5.8

### 4.1 The only FFT ocean in the engine

A search of `Engine/Source`, `Engine/Plugins` and `Engine/Shaders` for Tessendorf, JONSWAP, Phillips spectrum and
ocean FFT finds one: `Plugins/Experimental/WaterAdvanced`.

- That plugin is experimental, off by default, and depends on Niagara, NiagaraFluids and Water (`WaterAdvanced.uplugin`).
- `UFFTOceanPatchSubsystem` spawns the Niagara system from `UShallowWaterSettings::DefaultOceanPatchNiagaraSystem` and
  binds a render target `OceanNormalRT` to it (`Source/WaterAdvanced/Private/FFTOceanPatchSubsystem.cpp:91-137`,
  `Public/ShallowWaterSettings.h:30`).
- The system `Content/Niagara/Systems/Grid2D_OceanPatch.uasset` holds a Grid2D with real and imaginary attributes, a
  radix-2 FFT in group-shared memory, and a Phillips spectrum. Its output is a normal written to `NormalRT` (strings of
  the compiled HLSL embedded in the asset).
- It is one patch, normals only, used as detail by `UShallowWaterRiverComponent` (`ShallowWaterRiverActor.cpp:82-90`,
  `:745`, `:1313`).
- WaterAdvanced also has a Niagara Grid2D shallow-water river and water-body simulation (`ShallowWaterSubsystem.cpp`,
  `Content/Niagara/Systems/Grid2D_SW_*.uasset`).

### 4.2 The engine's GPU FFT

- The renderer has a GPU FFT (`Source/Runtime/Renderer/Private/GPUFastFourierTransform.h:19`, namespace `GPUFFT`),
  used by FFT bloom.
- It lives in the renderer's `Private` folder and its functions carry no `RENDERER_API` export
  (`GPUFastFourierTransform.cpp:21-68`), so another module cannot call it.

### 4.3 Engine features this kit would reuse

**RDG compute from a module**
- `ISceneViewExtension` gives render-thread hooks with an `FRDGBuilder`:
  - `PreRenderViewFamily_RenderThread`, before the base pass
  - `PostRenderBasePassDeferred_RenderThread`
  - `PrePostProcessPass_RenderThread`
  - `SubscribeToPostProcessingPass`
  
  (`Source/Runtime/Engine/Public/SceneViewExtension.h:175-227`)
- The Water plugin uses the same pattern (`WaterViewExtension.cpp:398-643`).

**SingleLayerWater**
- It integrates with Lumen reflections through a dedicated pass (`Renderer/Private/Lumen/LumenReflections.cpp:1227`,
  `:1681`), with configurable reflection technique, distance-field shadows, depth prepass, velocity and wave ops
  (`Renderer/Private/SingleLayerWaterRendering.cpp:40-213`).
- Its compositing (`Shaders/Private/SingleLayerWaterShading.ush:96-179`):
  - samples the scene without water at a screen-space distorted UV
  - falls back to the undistorted pixel when the distorted sample lies in front of the water
  - takes the water volume depth as the straight screen difference `BehindWaterSceneDepth − WaterSurfaceSceneDepth`
    (`:160`)
  - reads scattering, absorption, phase g and colour-behind-water from the material per pixel (`:172-179`)
- It has no caustics: a grep of `SingleLayerWaterRendering.cpp` for "caustic" finds nothing.

**Material hooks**
- Custom nodes can include shader files: `UMaterialExpressionCustom::IncludeFilePaths`, `AdditionalDefines`,
  `AdditionalOutputs` (`Source/Runtime/Engine/Public/Materials/MaterialExpressionCustom.h:91-97`).
- `UMaterialExpressionTextureSampleParameter2DArray` exists (`Public/Materials/MaterialExpressionTextureSampleParameter2DArray.h`),
  as does `UTextureRenderTarget2DArray` (`Classes/Engine/TextureRenderTarget2DArray.h:21`).

**Per-instance data for the LOD grid**
- `UInstancedStaticMeshComponent::NumCustomDataFloats` and `SetCustomData` (`Classes/Components/InstancedStaticMeshComponent.h:181`,
  `:323-331`). This carries CDLOD node data per instance.

**Light functions on the sun**
- `ULightComponent::LightFunctionMaterial` (`Classes/Components/LightComponent.h:205`).
- The deferred light function pixel shader gives the material the per-pixel translated world position
  (`Shaders/Private/LightFunctionPixelShader.usf:49-62`).
- Directional lights are also handled by the light function atlas (`Renderer/Private/LightFunctionAtlas.cpp:381`).

**Other features**
- **Niagara GPU and NiagaraFluids:** NiagaraFluids is already enabled in `unreal/VibeGameEngine.uproject`. The kit
  already builds Niagara systems in `unreal/Source/VibeGameEngineTools/Private/VgeNiagara.cpp`. These suit spray.
- **Heterogeneous volumes** exist in the renderer (`Renderer/Private/HeterogeneousVolumes/`). Nothing in Tidewater's
  ocean needs them.

## 5. What the kit has today

**Water**
- One flat plane with a SingleLayerWater material (`src/features/world/assets/water.material.tsx:1-30`;
  `src/features/world/entities/Lake.tsx:1-12`).
- Its normals come from three analytic sine terms. Its coefficients are fixed.

**Terrain**
- The terrain is a TypeScript height function, `TerrainDescription.height(x, y)` (`src/shared/terrain/index.ts:26-35`).
  The dev server samples it.
- The content service imports it as a Landscape (`unreal/Source/VibeGameEngineTools/Private/VgeTerrain.cpp:127-236`).
- So the same height function is available in Node for any offline field.

**Materials**
- Materials are TSX graphs built into UE materials. The builder resolves any `UMaterialExpression` class by name and
  sets its properties by reflection (`unreal/Source/VibeGameEngineTools/Private/VgeMaterialBuilder.cpp:39-74`, `:519`).
- The content service runs `-run=VgeContentService -nullrhi` (`vge/content/service.mjs:18`).

**Runtime**
- TypeScript creates MIDs and sets parameters (`src/shared/react/materials.ts:38-62`,
  `src/shared/engine/world.ts:148-180`). It ticks per frame with `everyFrame` (`src/shared/engine/world.ts:111`).

**Missing for this work**
- The runtime module `VibeGameEngine` loads at `Default`, has no shader directory, and depends only on RenderCore
  among the render modules (`unreal/Source/VibeGameEngine/VibeGameEngine.Build.cs`; `unreal/VibeGameEngine.uproject`).
- No RDG, global shader or scene view extension exists in the project (grep of `unreal/Source` and `unreal/Plugins`).

## 6. Recommendation: port Tidewater's ocean into a VGE runtime module, shaded through SingleLayerWater

The one approach: Tidewater's ocean systems, ported faithfully (structure, constants and names kept, WGSL translated
to HLSL), run as RDG compute in a new VGE runtime module. They feed a SingleLayerWater material on a CDLOD grid that
TypeScript drives.

The Water plugin is not used:
- its waves are Gerstner (3.1)
- its spectrum generator is empty (3.1)
- its geometry depends on editor-time mesh generation that the `-nullrhi` service skips (3.7)

Its architecture is reused as the pattern:
- a module at `PostConfigInit` with a shader directory mapping
- an `ISceneViewExtension` that writes render targets the materials sample

### 6.1 Runtime module (C++, RDG)

**Module setup**
- A new runtime module under `unreal/Source`. Its name follows the Vge prefix; the exact name is the user's call.
- `LoadingPhase: PostConfigInit`, as Water does (`Water.uplugin:21`).
- `AddShaderSourceDirectoryMapping` for its `Shaders/` folder (`WaterModule.cpp:21`).
- Dependencies: RenderCore and Renderer.

**One `FSceneViewExtensionBase`**
- In `PreRenderViewFamily_RenderThread` (`SceneViewExtension.h:175`) it records the ported passes in order:
  1. Spectrum init: only when the parameters change (`OceanFFT.js:297-379`, `:614-622`).
  2. FFT rows, then columns with Jacobian foam (`:408-526`).
  3. Compute mips for both 256²×4 `rgba16f` arrays (`:529-606`).
  4. `ShoreSim` step (`ShoreSim.js:170-257`).
  5. Caustics photon splatting into the fine and broad layers, with mips (`Caustics.js:5-17`, `:155-175`).
  6. Water queries (`WaterQuery.js:6-22`).
  7. `WakeSim`, for boats (`WakeSim.js:26-50`).
  8. The underwater lighting bakes (`UnderwaterLighting.js:9-16`).
- The outputs are `UTextureRenderTarget2DArray` and `UTextureRenderTarget2D` objects owned by the module and
  registered into RDG as external textures. Materials bind them as texture parameters, so this frame's base pass reads
  this frame's waves.

**`UFUNCTION`s exposed to Puerts**
- These follow the kit's existing script library (`unreal/Source/VibeGameEngine/Public/VgeScriptLibrary.h`).
- Wind, fetch, swell system, choppiness, foam bias, gain and decay, shore period, amplitude and gamma, and time.
- Query slots with readback, for buoyancy and the camera medium.

### 6.2 Surface mesh and material

**Mesh**
- One grid mesh, 32×32 quads as in `App.js:176`, built by the content service as a static mesh.
- It is drawn through an `InstancedStaticMeshComponent` with 4 custom data floats per instance: node origin xz, size
  and lod (`CDLOD.js:10-15`; `InstancedStaticMeshComponent.h:181`, `:330`).
- TypeScript runs the CDLOD quadtree selection each frame (a port of `core/CDLOD.js`) and writes the instances.

**Material**
- A TSX material with `shadingModel="SingleLayerWater"`, as the lake already uses.
- **World position offset:** a Custom node includes the ported `waterSurfaceVertex` (`WaterSurface.js:142-237`):
  - CDLOD morph
  - band-limited cascade sampling with depth attenuation
  - shore waves, swash smooth max and the hide-under-land rule
- **Normal, foam and coverage:** a Custom node includes the ported `waterSurfaceFragment` (`WaterSurface.js:258-383`)
  and the swash edge and foam bead logic (`WaterMaterial.js:243-284`). The base colour is foam-lit through
  `surfFoamShading` (`SurfFoam.js:10-19`).
- **Roughness:** Tidewater's Cox-Munk term (`WaterMaterial.js:305-312`).
- **SingleLayerWater output:** per-pixel scattering and absorption, carrying the base water coefficients, the surf
  medium (`ShoreWaves.js:497-505`) and aeration (`WaterMaterial.js:482-494`).
- **Volume path:** SLW uses the straight screen depth as the water path (`SingleLayerWaterShading.ush:160`), where
  Tidewater uses the Snell-refracted path to the seabed (`WaterMaterial.js:376-395`). The material computes both
  lengths against the baked terrain height texture and scales the extinction coefficients by `L_refracted / L_straight`.
  The optical depth SLW integrates then equals Tidewater's along the refracted ray.
- **Thin crests:** the `shoreCrestPath` term (`ShoreWaves.js:528-568`) enters the same way.
- **Reflections and shadows:** the sky, Lumen reflections and shadows come from the engine's SLW path
  (`LumenReflections.cpp:1681`; `SingleLayerWaterRendering.cpp:69-131`).

### 6.3 What the content service builds

- **Terrain height texture:** a float texture sampled from the TypeScript height function on the terrain domain. It
  stands in for `terrainHeightAt`, which the shore waves, ShoreSim, the material path trace and the hide-under-land rule
  use. It is built from the same `height(x, y)` that `VgeTerrain` imports.
- **Shore travel-time field:** a port of `computeShoreField` (`ShoreField.js:65-237`) run in the dev server on that
  height function, with the swell direction from the TypeScript world description. It is saved as a float texture
  `(T, dir·exposure, Tshore)`, as `terrainShoreSample` reads it (`world/TerrainGPU.js:34`, `:268`).
- **Shore direction texture:** a port of `buildDirTexture` (`ShoreWaves.js:646-695`).
- **Pattern textures:** the foam pattern (`FoamTexture.js`), the lace texture (`SurfFoam.js:21-40`) and the sea detail
  noise (`SeaDetail.js`). These are generated procedurally by porting the generators.
- **The CDLOD grid mesh.**
- **The water material and its Custom-node shader includes.**

### 6.4 What TypeScript drives

- The ocean entity:
  - CDLOD selection and instance updates
  - wind and swell state
  - shore parameters per bay
  - sea level
  - the simulation time, taken from the fixed tick so the waves follow the simulation clock, not render FPS
- Query slots for gameplay, such as buoyancy, the swimmer and the camera medium.
- A lab per system, following the kit's dev-lab rules.

### 6.5 Shore effects, caustics, underwater

**Breakers**
- The crest finder runs in the module as RDG compute (`Breakers.js:6-13`).
- The lip ribbon mesh is driven from its buffer (`:24-28`).
- Spray goes through a Niagara GPU system, or through the module's own particle pass ported from `fx/Spray.js`.
  Either way, falling drops deposit foam into ShoreSim (`ShoreSim.js:154-168`).

**Caustics**
- The splatted textures are applied by a light function material on the sun. The material reproduces
  `hookDirectModulation`: refracted sun path attenuation times caustics times surf foam shadow
  (`UnderwaterLighting.js:18-23`). The deferred light function shader gives it the world position
  (`LightFunctionPixelShader.usf:49-62`).

**Underwater view**
- A post-process pass from the same view extension (`SubscribeToPostProcessingPass`, `SceneViewExtension.h:222`)
  ports `post/Underwater.js`:
  - the medium at the near plane per pixel, from water query slot 0
  - Beer-Lambert plus single scattering
  - half-resolution caustic shafts
  - the meniscus band
- `post/LensDroplets.js` after the temporal resolve.

### 6.6 Stages, each a part of the final system

1. Runtime module, view extension, FFT cascades with Jacobian foam, the CDLOD grid and the SLW material with the
   cascade WPO, normals, whitecaps and capillary detail. This is the open-sea part of Tidewater, complete.
2. Content-service bakes (terrain height texture, shore field, direction texture), shore waves in WPO and fragment,
   swash edge, ShoreSim, surf foam shading, the surf medium and the refracted-path extinction scaling. This is the bay.
3. Breakers lip ribbon and spray, with spray foam deposits.
4. Caustics and the sun light function, then the underwater post pass, shafts, meniscus and lens droplets.
5. Water queries for gameplay and the boat wake simulation.

## 7. Not verified

- Whether a SingleLayerWater material can write emissive, for the crest translucency and foam terms that Tidewater
  adds outside the volume integral. Read `SingleLayerWaterShading.ush` and the SLW base pass before choosing between
  emissive and the scattering inputs.
- How the light function atlas (`r.LightFunctionAtlas`) evaluates a directional light's material, and whether it
  provides the world position the caustics need. Only the deferred pass was read (`LightFunctionPixelShader.usf`).
- Whether the cook commandlet regenerates the water info mesh of a water body saved by the `-nullrhi` content service.
  Only `WaterBodyComponent.cpp:1640-1678` and `:2124-2142` were read. This matters only if the Water plugin were used.
- The graphs of the Water plugin's and WaterAdvanced's material and Niagara assets. They were read as strings only.
- The exact rendering cost on our hardware. Nothing was run.

## 8. Sources

- **Tidewater** at `4811ba48d795197de5621985f404e765c0b7c0ef`:
  - `src/ocean/*`, `src/world/ShoreField.js`, `src/world/TerrainGPU.js`
  - `src/core/CDLOD.js`, `src/App.js`, `src/engine/render/Frame.js`
  - `src/sky/*.js` headers, `src/post/*.js` headers
  - `docs/PORTING.md`, `README.md`
- **UE 5.8 Water plugin:** `Water.uplugin`, `Source/Runtime/Public/GerstnerWaterWaves.h`,
  `Source/Runtime/Private/{GerstnerWaterWaves, WaterZoneActor, WaterInfoRendering, WaterBodyComponent,
  WaterBodyOceanComponent, WaterSubsystem, WaterViewExtension, WaterModule}.cpp`, `Shaders/Private/*.usf|ush`.
- **UE 5.8 WaterAdvanced:** `WaterAdvanced.uplugin`, `Source/WaterAdvanced/*/FFTOceanPatchSubsystem.*`,
  `ShallowWaterRiverActor.cpp`, `Shaders/WaterAdvanced.ush`.
- **UE 5.8 renderer and engine:** `Renderer/Private/{SingleLayerWaterRendering, GPUFastFourierTransform,
  FrontLayerTranslucency, LightFunctionAtlas, LightFunctionRendering}.cpp`, `Renderer/Private/Lumen/LumenReflections.cpp`,
  `Shaders/Private/{SingleLayerWaterShading.ush, LightFunctionPixelShader.usf}`, `Engine/Public/SceneViewExtension.h`,
  `Engine/Public/Materials/{MaterialExpressionCustom, MaterialExpressionTextureSampleParameter2DArray}.h`,
  `Engine/Classes/Components/{InstancedStaticMeshComponent, LightComponent}.h`.
- **This repository:** `src/features/world/assets/water.material.tsx`, `src/features/world/entities/Lake.tsx`,
  `src/shared/terrain/index.ts`, `src/shared/react/materials.ts`, `src/shared/engine/world.ts`,
  `unreal/VibeGameEngine.uproject`, `unreal/Source/VibeGameEngine/VibeGameEngine.Build.cs`,
  `unreal/Source/VibeGameEngineTools/Private/{VgeTerrain, VgeMaterialBuilder}.cpp`, `vge/content/{service, cooker}.mjs`.
