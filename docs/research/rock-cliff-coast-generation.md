# Rock, cliff and coast generation

The task: find a good technique for generating rock so that one method builds both coastlines and mountains. Research
first. This document covers what makes rock read as real, which methods reproduce each feature, which libraries can
run from Node, what UE 5.8 actually ships for combining a landscape with rock meshes, and one recommended technique for
this kit.

Every claim carries its source: a `file:line` in this repository, the engine (`C:\GameEngien\UE_5.8`) or the
three.js showcase, or a link to the paper or library source that was read. Anything not checked is listed under
"Not verified" at the end.

## 1. The answer in one paragraph

Build every rock, from a boulder to a coastal cliff or a mountain face, from a single geology-driven implicit
field, and mesh it with dual contouring. The field is the kit's terrain height function, extended to 3D, with a
geology layer on top. Bedding planes and joint sets cut the bedrock into implicit blocks (Paris et al. 2020). A
hardness field marks the weak beds. Erosion primitives carve the steep, soft places, with a band at sea level for the
wave notch, caves, arches and stacks (Paris et al. 2019, and the release code's `sea-scene.cpp`). Detached material
becomes talus piles of eroded Voronoi cells (Peytavie et al. 2009).

The field is meshed by dual contouring of Hermite data (Ju et al. 2002), because that keeps the sharp edges of joint
faces and carries one material index per stratum. It is meshed in chunks, simplified with meshoptimizer with chunk
borders locked, and written as Nanite GLBs with geology attributes in vertex colour. The UE Landscape keeps the
heightfield part of the same function, lowered under the rock.

The material is world-space triplanar, with a strata band lookup along the bedding normal, masks from the vertex
attributes, and Nanite tessellation displacement for sub-voxel detail. At mountain scale, the heightfield itself
comes from uplift plus stream-power erosion (Cordonnier et al. 2016, Schott et al. 2023).

## 2. What the kit has today

| Part | What it does | Source |
| --- | --- | --- |
| `vge/tools/nature/rock.mjs` | Welded icosphere (detail 31). fbm lumps along the sphere direction. 3 to 9 random plane cuts that clamp vertices to a plane, which gives facets. Ridged-noise crevices pushed inward. Flat bottom clamp. Smooth/flat normal blend. Spherical UVs tiled at 1.2 m. A `crevice` value in vertex colour R. | `rock.mjs:35-47`, `:51-71`, `:73-86`, `:88-101`, `:107-129`, `:148-171` |
| `vge/tools/nature/noise.mjs` | `fbm3` and `ridged3` only. There is no cellular/Worley noise. | `noise.mjs:16`, `:29`, `:44` |
| `vge/tools/nature-meshes.mjs` | Writes GLBs with POSITION, NORMAL, TEXCOORD_0 and COLOR_0. Rock textures come from `rock-granite.png` through `tilingSurface`. Optional `UCX_` collision hull. | `nature-meshes.mjs:55-58`, `:122-146` |
| `nature.material.tsx` `stone` | UV-mapped colour, normal and masks. The crevice (vertex colour R) darkens albedo and AO. No triplanar, no strata, no displacement. | `nature.material.tsx:67-79`, `:168-176` |
| Importer | Nanite on by default. Only `bEnabled` and LOD settings are written. No displacement maps, no position precision. | `unreal/Source/VibeGameEngineTools/Private/VgeImporter.cpp:185-210` |
| Terrain | `defineTerrain({ height(x, y), layers, grass })` → `ALandscape::Import` of 16-bit heights. Pure heightfield, no Nanite landscape. | `src/shared/terrain/index.ts:25-34`, `VgeTerrain.cpp:127-236` |
| Material declarations | The `<material>` root is generated from every `EMaterialProperty` except a fixed exclusion list, plus every editable `UMaterial` property. Structs become `Record<string, unknown>`. | `VgeJsxDeclarations.cpp:434-479`, `:340-366` |

The showcase (`C:\Users\pavel\projects\AIGamess\ThreejsShowcase`) adds:

- **World-space triplanar rock material** (`src/entities/rocks/index.ts:76-156`): weights `|n|^4`, a whiteout normal
  blend with per-axis sign fix, and macro albedo variation from noise.
- **Island cliff wall** (`src/entities/island/index.ts:83-171`): a displaced vertical grid strip under the beach
  heightfield. It carries a per-vertex `strata` attribute (soil/rock) used by `cliffMaterial.ts:59-97`. It is a
  single displaced sheet, not a volume. It cannot hold arches, caves or detached blocks.

## 3. What makes rock, cliffs and coasts read as real, and what reproduces each

| Feature | Physical cause | Method that reproduces it | Source |
| --- | --- | --- | --- |
| **Bedding / strata** | Layers of different hardness. | A geology field of strata primitives, used as hardness rather than displacement. The weak beds are then eroded preferentially. Or a strata-indexed material on the mesh. | Paris 2019 code: `GeoStrata::Intensity` is a falloff of the squared vertical distance to the stratum plane (`geostrata.cpp`). The sea scene reads it as `hardness` and only erodes where `hardness < 0.05` (`sea-scene.cpp`). |
| **Joints and fracture sets** | Near-planar fracture families with set orientation and spacing (equidimensional, rhombohedral, polyhedral, tabular). | Fracture disks, then point clusters separated by fractures, then the convex hull of each cluster, then the block as a smooth intersection of the hull's half-spaces. Blocks are combined by union. | Paris et al. 2020, *Modeling Rocky Scenery using Implicit Blocks* ([project](https://aparis69.github.io/public_html/projects/paris2020_Blocks.html)). Release code: `GenerateFractures`, `ComputeBlockClusters` and `ComputeBlockSDF` in [`blocks.cpp`](https://github.com/aparis69/Rock-fracturing/blob/master/Code/Source/blocks.cpp), and `SDFBlock::Signed` with a quadratic smooth-min (radius 0.25) in [`blocks-sdf.cpp`](https://github.com/aparis69/Rock-fracturing/blob/master/Code/Source/blocks-sdf.cpp). |
| **Joint-controlled erosion** | Erosion follows joints into blocks and columns. | Voxel simulation with joints. | Ito et al. 2003, *Modeling rocky scenery taking into account joints*, CGI 2003 (cited as [IFMC03] in Arches; not read). |
| **Talus / scree** | Detached blocks pile at the angle of repose. | (a) Material-stack stabilization: move material to a neighbour when the slope exceeds the angle of repose, using Δz_i = a·Δh̃_i / ΣΔh̃_i, with rocks at 40-45° and sand at 30-35°. (b) Rock piles: a periodic tile of Voronoi cells from Poisson sampling, each cell eroded everywhere except at Gaussian-weighted contact points ρ(p) = exp(−‖p − c_ij‖²/r²), then instanced where the rock layer is. | Peytavie et al. 2009, *Arches*, §3.4 and §5 ([PDF](https://perso.liris.cnrs.fr/egalin/Articles/2009-arches.pdf), read in full). |
| **Weathering: rounded edges, tafoni, overhangs** | Spheroidal weathering is strongest at high positive mean curvature. Cavernous weathering is strongest at high negative curvature. Both are modulated by durability. | Curvature-driven weathering on a voxel grid, with rockfall and colluvium. | Jones, Farley, Butler, Beardall 2010, IEEE TVCG 16(1):81-94 ([abstract](https://scholarsarchive.byu.edu/facpub/110)). Beardall et al. 2007, *Goblins by spheroidal weathering* (cited in Arches). |
| **Wave-cut notch** | Wave impact at the cliff base. Notches form near mean sea level, and higher where the tidal range is large. | Eroded notch volume grows linearly with time, dV/dt = C_E·C_I·(ρ/ρ_b)·H_c²/T (eq. 9-10), so it scales with the wave height at the cliff squared. A beach built from the eroded material damps waves exponentially, H_c = H_E·exp(−2αV_E/h_c) (eq. 11-12). | Larson, Sunamura, Erikson, Bayram, Hanson 2010, *An analytical model to predict dune and cliff notching due to wave impact*, ICCE 2010 ([PDF](https://icce-ojs-tamu.tdl.org/icce/article/download/1249/pdf_70/8278), read in full). |
| **Notch collapse, cliff retreat, sea caves, arches, stacks** | A notch undercuts the cliff until the overhang fails. Weak zones are eroded through. | Implicit erosion primitives (point skeletons with negative energy) placed by Poisson sampling at steep (normal.z ≤ 0.8), soft (hardness < 0.05) surface points, in three passes, plus a weak stratum at sea level. | Paris et al. 2019, *Terrain Amplification with Implicit 3D Features*, ACM TOG 38 ([project](https://perso.liris.cnrs.fr/aparis/public_html/projects/paris2019_3D.html)). Release code [`sea-scene.cpp`](https://github.com/aparis69/Implicit-Volumetric-Terrains/blob/master/Code/Source/sea-scene.cpp): `ErodeWithPrimitives` with energies −15, −10, −8, radius 8, then `marching_cube(..., 350)`. |
| **Overhangs and arches in general** | Anything a heightfield cannot hold. | A material-stack terrain (air layers between bedrock layers) reconstructed as a convolution surface, f(p) = 2·V_M/V_Ω − 1 with a cubic kernel, and polygonized. Carving by sweeping profile curves along a graph: f̃ = min(f, −f*). | Arches §3.2-3.3, §4.2. |
| **Ledges, undercuts, karst pockets, joint grooves by rock type** | Lithology. | Per-rock-type wall grammar on an SDF. Granite: Worley F2−F1 joints. Sandstone: ledges and undercut near bank bases. Limestone: two joint families 1.25-1.75 m and 1.45-2.0 m apart, rotated 0.18-0.72 rad, with terraced crown and karst noise. | [`threejs-procedural-rocks-cliffs`](https://github.com/maxliebscher/threejs-procedural-rocks-cliffs) `src/landscaping-compiler.js` `createRockGrammar` (MIT, read). |
| **Mountain ridges, valleys, drainage** | Tectonic uplift against fluvial erosion. | Stream power law on the heightfield: e = k·A^m·S^n, minus hillslope diffusion, plus uplift. | Cordonnier et al. 2016, CGF 35(2):165-175 ([EG](https://diglib.eg.org/handle/10.1111/cgf12820)). Schott et al. 2023, ACM TOG 42(5), DOI 10.1145/3592787. Release shader [`spe_shader.glsl`](https://github.com/H-Schott/StreamPowerErosion/blob/main/data/shaders/spe_shader.glsl): `spe = k * kNoise * pow(A, 0.8) * pow(slope, 2.0)`, `newH -= dt * (spe - k_h * Laplacian(p))`, `newH += dt * uplift`, with multiple-flow-direction drainage (`WaterLp`). Defaults: k = 0.0005, k_h = 200, dt = 50, uplift = 0.03. |
| **Hydrology-consistent rivers** | A drainage network shapes the terrain. | A river graph builds a construction tree of terrain primitives with blending and carving operators. | Génevaux et al. 2013, ACM TOG 32(4):143 ([PDF](https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf); abstract checked). |

What "Megascans-like" means in production, verified as far as the sources go:

- Epic's Electric Dreams sample builds its large cliff from Assemblies of meshes dropped into the world and extended
  by PCG graph logic. Its docs show "the large cliff structure ... with all Assemblies used to build it"
  ([Electric Dreams docs](https://dev.epicgames.com/documentation/en-us/unreal-engine/electric-dreams-environment-in-unreal-engine)).
- Ghost Recon Wildlands used World Machine heightfields, and scattered rocks by curvature, slope and cliff detection
  ([80.lv](https://80.lv/articles/landscape-and-material-pipeline-of-ghost-recon-wildlands/)).

The common factor is that cliff geometry is a mesh sitting on a heightfield landscape, and its detail comes in three
bands:

- **Macro shape:** the terrain and the strata.
- **Mid-frequency:** blocks and joints at metre spacing.
- **Micro:** the scanned or texture surface.

The recommendation in section 6 generates all three bands instead of scanning them.

## 4. Generation methods

### 4.1 Representation

- **Implicit field (SDF / construction tree).** This is the only representation in the surveyed work that holds
  overhangs, arches, caves, strata and blocks in one object. It also combines with a heightfield as the term
  `z − h(x, y)`:
  - Arches uses material stacks with a convolution surface.
  - Paris 2019 uses construction trees over an imported heightfield.
  - Paris 2020 uses implicit blocks.
  - `threejs-procedural-rocks-cliffs` has a `heightAt(x, z)` floor in every field.
- **Displaced sphere (the current `rock.mjs`).** Fine for a single boulder. It cannot express joint sets, strata,
  overhangs or a cliff attached to terrain, and its spherical UVs have pole seams (`rock.mjs:103-129`).
- **Displaced wall strip (the showcase island).** 2.5D only (`island/index.ts:103-142`).

### 4.2 Meshing an implicit field

| Method | Vertex placement | Sharp features | Material index per region | Source |
| --- | --- | --- | --- | --- |
| Marching cubes | On grid edges. | Chamfered: vertices are restricted to edges. | Hard to place multi-material junctions. | Ju et al. 2002, §2.1 and §2.4. |
| Marching tetrahedra (BCC) | On edges, root-found with ITP when `tolerance > 0`. | Same limitation. | No. | manifold `src/sdf.cpp` (read). |
| Surface nets | One vertex per cell, free inside the cell. | Smoothed. Better triangle aspect ratios. | No. | Ju et al. 2002 §2.1. mikolalysenko `isosurface` README. |
| **Dual contouring (Hermite data)** | One vertex per cell at the QEF minimizer of the edge intersections and normals, solved by QR with an SVD pseudo-inverse truncated at 0.1. | **Reproduced**, both sharp edges and corners. | **Yes.** Each grid point has a material index. Quads come only from solid/empty edges, and the vertex sits at the junction where three materials meet. | Ju, Losasso, Schaefer, Warren 2002, SIGGRAPH ([PDF](https://people.engr.tamu.edu/schaefer/research/dualcontour.pdf), read in full). |

Joint faces, bedding planes and wave-cut platforms are planar, and the strata are distinct materials. Dual contouring
is the one method in the table that keeps both properties at a given grid size.

### 4.3 Fracture

There are three verified ways to fracture:

- **Implicit blocks (Paris 2020).** Each block is the smooth intersection of half-spaces, combined by union with a
  bounding-volume hierarchy, and polygonized together. Gaps between blocks are joints.
- **Voronoi cells as a periodic tile (Arches §5).** Used for loose rocks and piles.
- **Mesh booleans.** manifold `splitByPlane(normal, offset)` and `hull(points)` can cut a mesh into convex cells
  (manifold `manifold-encapsulated-types.d.ts`). This works on meshes, not on the field.

## 5. Libraries usable from Node

Licences were checked in each repository's `LICENSE` or its package metadata. The "what it really does" column is
from reading the source.

| Library | Licence | Runs in Node | What it really does |
| --- | --- | --- | --- |
| **meshoptimizer** 1.3.0 (already a dependency) | MIT | yes (WASM) | `simplifyWithAttributes(..., vertex_lock, ...)` locks chosen vertices, which keeps chunk borders. Flags include `LockBorder`, `Regularize`, `Prune`, and `PreserveFolds` (experimental). `remesh(...)` is an **experimental** voxel remesher with grid resolution 4-256 that does not preserve topology (`meshoptimizer.h`; `node_modules/meshoptimizer/meshopt_simplifier.d.ts:73`). |
| **manifold-3d** 3.5.4 | Apache-2.0 | ESM package with a WASM build. Node use is not stated in the package metadata. | `Manifold.levelSet(sdf, bounds, edgeLength, level, tolerance)` is marching tetrahedra on a body-centred cubic grid, with ITP root finding when `tolerance > 0`. It is 2-manifold before vertex collapse, and `CleanupTopology` removes kissing vertices afterwards. Also `splitByPlane`, `hull`, `warp`/`warpBatch`, `refineToLength`, `calculateNormals`, `setProperties`, `decompose`, `minkowskiSum` (`src/sdf.cpp`, `bindings/wasm/manifold-encapsulated-types.d.ts`). |
| **isosurface** (mikolalysenko) | MIT | yes (pure JS) | `surfaceNets`, `marchingCubes`, `marchingTetrahedra(dims, potential, bounds)` → `{ positions, cells }`. |
| **threejs-procedural-rocks-cliffs** | MIT (2026, Max Liebscher) | README says CPU-only with Node tests | Field core (`landscaping-field.js`): polynomial `smin`/`smax`, seeded value-noise `fbm3`, `worley2`/`worley3` (F1, F2, cell id), `polygonSdf`, marching tetrahedra (6 tetrahedra per cube, edge t clamped to [0.015, 0.985]), Taubin smoothing, sliver collapse, QEM decimation, manifold audit. Compiler (`landscaping-compiler.js`): area cliff, spline cliff, rock-group fields; per-lithology wall grammar; talus as displaced icospheres pushed out of the union. **It has no erosion model and no overhangs except sandstone undercuts.** It has no licence header in the file, but the repository `LICENSE` is MIT. Its textures have no licence (survey doc). |
| **RockGenerator** (bamyazi) | MIT | the geometry files import only `three` (survey doc) | `displacement.js`: noise displacement along normals, and nine crack groove fields (ridge, voronoi, warp, branch, shatter, planar, horizontal, vertical, path); "horizontal" is the strata-like one. `thermal-erosion.js` treats radial distance as height, transfers when the radial drop exceeds 0.04·size, moves material along position vectors and is **not mass-conserving** (the neighbour gains 60 % of what the source loses). It is a look, not talus physics. |
| **watlas** (toji) / **xatlasjs** | MIT (xatlas itself MIT, Jonathan Young) | watlas: "browsers and node.js" | xatlas chart and pack. Needed only if baked UV-space maps are wanted. Triplanar needs no UVs. |
| **SebLague/Hydraulic-Erosion** | MIT | C# (port) | Particle (droplet) hydraulic erosion on a heightfield. |
| **H-Schott/StreamPowerErosion** | MIT (GitHub API) | GLSL + C++ (port) | Stream power + hillslope + uplift, as quoted in section 3. |
| **three** (already a dependency) | MIT | yes | `ConvexGeometry` and buffer utilities, used by `rock.mjs` already. |

Excluded by licence or by missing licence:

- **fidget** (manifold dual contouring in Rust): MPL-2.0 ([README](https://github.com/mkeeter/fidget)).
- **fastscapelib**: GPL-3.0 ([LICENSE](https://github.com/fastscape-lem/fastscapelib/blob/main/LICENSE)).
- **Paris et al. release code** (`Rock-fracturing`, `Implicit-Volumetric-Terrains`): no standard licence ("use in
  any way, credit the article"). Port the methods from the papers. Do not copy the code.

No JavaScript, TypeScript or WASM dual contouring package was found on npm in this search. Dual contouring has to be
written in the kit, from Ju et al. 2002 §2.2-2.3.

The engine also ships `FMarchingCubes`, which takes an implicit function, `CubeSize`, a root-finding mode and parallel
evaluation (`Engine/Source/Runtime/GeometryCore/Public/Generators/MarchingCubes.h:50-106`). It also ships
`Implicit/Solidify.h` and `Operations/MeshBoolean.h` in GeometryCore. These run in the content service (C++), not in
Node.

## 6. Landscape scale in UE 5.8 (read from engine source)

### Nanite tessellation and displacement

- **Runtime tessellation is on by default.** `r.Nanite.Tessellation` defaults to 1 (`NaniteCullRaster.cpp:94-97`).
  It needs `r.Nanite.ProgrammableRaster` and `r.Nanite.ComputeRasterization`, both default 1 (`:80-90`;
  `RenderUtils.cpp:1411-1423`).
- **Dicing cvars.** `r.Nanite.DicingRate` defaults to 2 px micropolygons and `r.Nanite.MaxPatchesPerGroup` defaults to
  5 (`NaniteCullRaster.cpp:148-158`).
- **The material must opt in.** `UMaterial::bEnableTessellation` is "required for displacement to work"
  (`Material.h:585-587`).
- **Material displacement scaling.** `FDisplacementScaling` has Magnitude (default 4) and Center (default 0.5)
  (`EngineTypes.h:3444-3459`). A distance fade is also available (`Material.h:505-506`, `:589-591`). The displacement
  material input is `MP_Displacement` (`SceneTypes.h:181`).
- **Build-time displacement on the mesh.** A static mesh can also carry build-time displacement maps in its Nanite
  settings: `FMeshNaniteSettings::DisplacementMaps` (texture, magnitude, center) and `DisplacementUVChannel`
  (`EngineTypes.h:3232-3260`, `:3377-3382`). This path needs UVs.
- **Kit config.** No kit config overrides any tessellation cvar (grep of `unreal/Config` and `unreal/Source` found no
  `Tessellation`).

### Nanite landscape

- `ALandscapeProxy::bEnableNanite`, `NaniteSkirtEnabled/Depth`, `NanitePositionPrecision` and
  `NaniteMaxEdgeLengthFactor` (default 16) exist (`LandscapeProxy.h:489-512`).
- The Nanite landscape is a static mesh exported from the landscape components, with fallback triangles at 1 %
  (`LandscapeNaniteComponent.cpp:275-324`).
- **It can only be built in the editor:** `check(GIsEditor)`, with the comment "don't allow Nanite landscape to be
  built in standalone editor (-game) mode" (`LandscapeNaniteComponent.cpp:236-237`). The build entry points are
  `ALandscapeProxy::UpdateNaniteRepresentation` and `UpdateNaniteRepresentationAsync` (`Landscape.cpp:459`, `:534`).
  The kit builds landscapes in the content service, an editor process (`VgeTerrain.cpp`), so this is reachable there.
  It is not wired today.
- Landscape materials support per-cluster displacement fallback (`LandscapeRender.cpp:223-226`, `:4925-4929`).

### Assemblies and distance fields

- **Nanite Assemblies.** `FMeshNaniteSettings::NaniteAssemblyData` lists parts (static mesh paths) and nodes
  (transforms), "set up by the import" (`EngineTypes.h:3384-3386`; `NaniteAssemblyData.h:43-113`). This is the
  engine's kitbash container. How it is authored outside an import was not checked.
- **Mesh distance field cap (Lumen).** `r.DistanceFields.MaxPerMeshResolution` is 256 voxels per axis and
  `r.DistanceFields.DefaultVoxelDensity` is 0.2 (`DistanceFieldAtlas.cpp:69-79`). A single 100 m cliff mesh
  therefore gets voxels no finer than about 0.4 m. That is one more reason to split cliffs into chunks.

### Combining a heightfield landscape with rock meshes

The landscape stays a heightfield: `VgeTerrain.cpp:204-219` imports 16-bit heights. Cliff, overhang and arch geometry
is Nanite static meshes placed on it, which is the arrangement Electric Dreams documents. Where the rock covers the
ground, the landscape must sit inside the rock so it never shows through. The terrain height function is the place
to do that, since the landscape and the rock field both read it.

### Coastline

A coast in this kit is three parts:

1. **The beach heightfield.** Landscape layers for sand and wet sand. The showcase sand material and the wetness
   coupling to water are in `src/entities/island/sandMaterial.ts`.
2. **The water body.** It exists in the demo world (`tasks/in-progress/demo-world-scene.md`, "Trees, rocks, grass and
   water").
3. **The cliff and rock meshes from the field.** The wave band sits at sea level, the notch height follows the tidal
   range (Larson et al. 2010), and the talus at the foot comes from the eroded material (Arches §4.4).

### Research at landscape scale, and what fits a Node generator

| Work | Fit for a code-driven Node generator |
| --- | --- |
| Stream power uplift erosion: Cordonnier 2016, Schott 2023 (MIT code), Tzathas et al. 2024 analytical stream power ([EG](https://diglib.eg.org/handle/10.1111/cgf15033)) | **Fits.** It is a grid update with a closed-form per-cell rule (section 3). Its output is the terrain height function the landscape already takes. Tzathas 2024 treats time as a continuous parameter; abstract only, not read. |
| Génevaux 2013 river networks | Fits as a construction tree over a river graph. Its value is for valleys and rivers more than for rock. |
| Arches 2009 (material stacks + convolution surface + rock piles) | Fits. The stack data structure is compact: a cliff of 2000 × 500 × 4000 effective voxels in 26 MB (Table 1). Its rock-pile tiling is the talus method. |
| Paris 2019 implicit amplification | **Fits directly.** It amplifies an existing heightfield with implicit features (stratified cliffs, sea arches, caves). The geology tree drives erosion primitives. |
| Paris 2020 implicit blocks | **Fits directly.** Fracture sets → blocks → implicit union on vertical parts of the terrain. |
| Jones 2010 curvature weathering | Fits as a field operator: offset the surface by curvature × durability before meshing. Abstract only. |
| Teoh 2008 *River and Coastal Action* (WaterWorld: coastal cliffs, beaches) | Abstract only ([dblp](https://dblp.dagstuhl.de/rec/conf/cgvr/Teoh08.html)). The method was not read. |
| Larson/Sunamura 2010 notch model | Fits as the rule that sizes the wave-band erosion from wave height squared and beach damping. |

No graphics paper that models wave erosion of sea cliffs, beyond the Paris 2019 sea scene, turned up in this search.

## 7. Recommendation for this kit: one technique

**A geology-driven implicit rock field over the terrain height function, meshed by dual contouring.**

### 7.1 The field

There is one signed field per site: negative inside rock, distance-like near the surface. It is built from:

1. **Terrain term.** `z − h(x, y)` from the same height function the landscape uses (the valley's
   `valleyShape.ts`, through `defineTerrain`). This makes the rock and the landscape meet by construction.
2. **Rock body.** The shape that rises above or juts from the terrain, using the forms
   `threejs-procedural-rocks-cliffs` already uses:
   - a spline cliff along a coastline or ridge polyline;
   - an area cliff from a plan polygon;
   - a boulder as one ellipsoid;
   - on mountains, the terrain itself where its slope exceeds a threshold (Paris 2020 places blocks on "the vertical
     parts of the terrain").
3. **Geology.**
   - Bedding planes: a dip direction and angle, a thickness sequence, and a hardness per bed.
   - Two or three joint sets, each with an orientation, a spacing and a jitter.
   - Fractures cut the body into implicit blocks: the smooth intersection of half-spaces, with a gap at joints
     (Paris 2020).
   - A boulder is one block.
4. **Hardness field.** From the beds plus noise, as in the Paris 2019 `geoTree`.
5. **Erosion primitives.** Point skeletons with negative energy, Poisson-placed at steep, low-hardness surface
   points, applied in passes (Paris 2019 `ErodeWithPrimitives`).
   - **On a coast:** an extra band at [sea level, sea level + runup]. The primitive energy there scales with the
     exposed wave height squared (Larson et al. 2010 eq. 9-10). That band produces the notch. Where it cuts through
     a weak bed or a joint between blocks, it produces caves, arches and stacks.
   - **Curvature weathering:** rounding of convex edges and hollowing of concave ones, scaled by hardness (Jones 2010).
6. **Talus and scree.** Rock piles from a periodic tile of Voronoi cells, eroded except at contact points (Arches
   §5). They are instanced where eroded volume was removed above, at the angle of repose for rock, 40-45° (Arches
   §3.4). Small cells reuse the same block code, so pebbles, boulders and blocks share one generator.

### 7.2 Meshing

- **Dual contouring with Hermite data** (Ju et al. 2002 §2.2-2.3). Each edge intersection gets a normal from the field
  gradient. The vertex is the QR/SVD QEF minimizer. Each grid point carries a material index = its bed, so beds
  become separate surface regions with sharp contacts (§2.4).
  - This is written in the kit (section 5: no npm package). It reuses `smin`/`smax`, `worley3` and the audit from
    `threejs-procedural-rocks-cliffs` (MIT), ported into `vge/tools/nature` next to `rock.mjs` and `noise.mjs`.
    `noise.mjs` gains cellular noise.
- **Chunks.** Fixed world-space chunks with a one-cell overlap. Chunk size follows the distance-field cap
  (256 voxels per mesh, section 6).
- **Simplification.** meshoptimizer `simplifyWithAttributes` with `vertex_lock` on chunk borders, and the geology
  attributes in the error metric.
- **Output.** GLB through the existing `staticModel` (`nature-meshes.mjs:122-146`), with COLOR_0 carrying:
  - **R:** crevice/cavity, as today;
  - **G:** bed index or hardness;
  - **B:** height above sea level, normalized, for wetness and the barnacle band;
  - **A:** curvature.
- **Collision.** A `UCX_` hull per chunk where it is convex enough; otherwise complex collision.

### 7.3 Coupling with the landscape

- The terrain description and the rock field read one height function.
- Under rock, the landscape height is held below the rock surface, so the landscape never pierces the meshes.
- Landscape layers keep using slope for rock-coloured ground (`demo-world-scene.md`, "rock on slopes over 24
  degrees"). Near rock meshes they use distance to the field, so the ground colour blends into the cliff foot.
- At mountain scale the height function comes from uplift + stream power + hillslope (section 3, Schott shader rule),
  run over the landscape grid in Node before `defineTerrain` samples it. Ridges and valley walls with slope over the
  threshold become field sites.

### 7.4 Texturing

- **World-space triplanar**, ported from the showcase rock material (`src/entities/rocks/index.ts:81-156`: `|n|^4`
  weights, whiteout normals, sign fix). The Arches paper uses the same projection with exponent p = 8 (§6). No UVs are
  needed, and the spherical-UV seams of `rock.mjs` go away.
- **Strata lookup.** A band texture indexed by `dot(worldPosition, beddingNormal)` plus bed index from vertex G. Each
  bed has its own albedo, roughness and normal intensity, so beds read across the whole cliff face and across chunk
  seams.
- **Masks from vertex attributes and the geometric normal:**
  - crevice and cavity darkening (as `stone` does today);
  - wet, darker, smoother band from height above sea level (B);
  - moss and soil on up-facing low-curvature faces, none on overhang undersides.
- **Nanite tessellation displacement** from the same triplanar height of the rock texture, for detail finer than the
  meshing grid. The engine path is on by default (section 6). The material sets `enableTessellation` and
  `displacementScaling`, which the kit's declaration generator exposes from `UMaterial` properties
  (`VgeJsxDeclarations.cpp:434-479`).
- **Textures** come through the existing `photoTextures.mjs` `tilingSurface` path, or from CC0 sets the survey already
  lists (Poly Haven `rock_face`, ambientCG `Rock030`).

### 7.5 Stages, each a part of the final system

1. Field core: `smin`/`smax`, cellular noise, terrain term, block primitive.
2. Dual contouring mesher with Hermite data and material indices.
3. Chunking, locked-border simplification and GLB export. A boulder is the first output of this pipeline and replaces
   the icosphere boulder.
4. Geology: beds, joint sets, block fracture, hardness.
5. Erosion primitives (slope and hardness, plus the wave band) and curvature weathering.
6. Talus: the Voronoi rock-pile tile and its instancing.
7. Terrain coupling: shared height function, landscape held under rock, field-distance layer weights.
8. The rock material: triplanar, strata, masks, Nanite displacement.
9. Landscape-scale heightfield: uplift + stream power + hillslope.

### 7.6 What already exists and is reused

| Existing part | Reused for |
| --- | --- |
| `rock.mjs` plane cuts (`:51-71`) | The same half-space idea as Paris blocks. The block primitive replaces it. |
| `noise.mjs` `fbm3`, `ridged3` | Field noise. |
| `nature-meshes.mjs` `staticModel` and `tilingSurface` | GLB writing and textures. |
| `VgeImporter.cpp` Nanite import | Cliff chunks. |
| `stone` material crevice wiring | The crevice mask. |
| Showcase triplanar rock material | The triplanar basis. |
| Showcase island `strata` attribute idea | The bed attribute in vertex colour. |
| `threejs-procedural-rocks-cliffs` (MIT) | Field helpers, Worley noise, rock-type grammar, mesh audit. |
| meshoptimizer | Simplification. |

## 8. Not verified

- **manifold-3d in Node.** Running manifold-3d in Node, and its speed with a JS SDF callback, was not tested.
- **Dual contouring cost.** Dual contouring has not been run on the kit's terrain at any grid size.
- **Displacement inputs.** Whether `worldPosition` can feed the `displacement` input inside a Nanite tessellation
  material in UE 5.8 was not checked in the shader code.
- **Generated material declarations.** The generated material declarations were not found in the checked-in tree, so
  `enableTessellation` and `displacementScaling` being exposed rests on reading the generator, not its output.
- **Nanite Assemblies.** Authoring an assembly outside an Interchange import was not read.
- **Papers not read beyond their abstracts:**
  - Ito et al. 2003;
  - Beardall et al. 2007;
  - Teoh 2008;
  - Tzathas 2024;
  - the full texts of Paris 2019 and 2020 (the HAL PDFs were blocked; their release code was read instead);
  - Cordonnier 2016 beyond the abstract.

## 9. Sources

- Peytavie, Galin, Grosjean, Mérillou. *Arches: a Framework for Modeling Complex Terrains*. CGF 28(2), 2009.
  https://perso.liris.cnrs.fr/egalin/Articles/2009-arches.pdf
- Paris, Galin, Peytavie, Guérin, Gain. *Terrain Amplification with Implicit 3D Features*. ACM TOG 38, 2019.
  https://perso.liris.cnrs.fr/aparis/public_html/projects/paris2019_3D.html. Code:
  https://github.com/aparis69/Implicit-Volumetric-Terrains
- Paris, Peytavie, Guérin, Dischler, Galin. *Modeling Rocky Scenery using Implicit Blocks*. The Visual Computer 36(10),
  2020. https://aparis69.github.io/public_html/projects/paris2020_Blocks.html. Code:
  https://github.com/aparis69/Rock-fracturing
- Ju, Losasso, Schaefer, Warren. *Dual Contouring of Hermite Data*. SIGGRAPH 2002.
  https://people.engr.tamu.edu/schaefer/research/dualcontour.pdf
- Larson, Sunamura, Erikson, Bayram, Hanson. *An Analytical Model to Predict Dune and Cliff Notching due to Wave
  Impact*. ICCE 2010. https://icce-ojs-tamu.tdl.org/icce/article/view/1249
- Cordonnier et al. *Large Scale Terrain Generation from Tectonic Uplift and Fluvial Erosion*. CGF 35(2), 2016.
  https://diglib.eg.org/handle/10.1111/cgf12820
- Schott, Paris, Fournier, Guérin, Galin. *Large-scale terrain authoring through interactive erosion simulation*. ACM
  TOG 42(5), 2023. Code: https://github.com/H-Schott/StreamPowerErosion
- Tzathas, Gailleton, Steer, Cordonnier. *Physically-based Analytical Erosion for fast Terrain Generation*. CGF
  43(2), 2024. https://diglib.eg.org/handle/10.1111/cgf15033
- Génevaux et al. *Terrain Generation Using Procedural Models Based on Hydrology*. ACM TOG 32(4), 2013.
  https://www.cs.purdue.edu/homes/bbenes/papers/Genevaux13ToG.pdf
- Jones, Farley, Butler, Beardall. *Directable Weathering of Concave Rock Using Curvature Estimation*. IEEE TVCG
  16(1), 2010. https://scholarsarchive.byu.edu/facpub/110
- Galin et al. *A Review of Digital Terrain Modeling*. CGF (Eurographics STAR), 2019 (listed at
  https://perso.liris.cnrs.fr/eric.galin/articles.html).
- manifold: https://github.com/elalish/manifold (`src/sdf.cpp`, `bindings/wasm/manifold-encapsulated-types.d.ts`,
  `LICENSE`).
- meshoptimizer: https://github.com/zeux/meshoptimizer (`src/meshoptimizer.h`, `js/meshopt_simplifier.d.ts`).
- isosurface: https://github.com/mikolalysenko/isosurface
- threejs-procedural-rocks-cliffs: https://github.com/maxliebscher/threejs-procedural-rocks-cliffs
- RockGenerator: https://github.com/bamyazi/RockGenerator
- xatlas: https://github.com/jpcy/xatlas. watlas: https://github.com/toji/watlas
- Epic, Electric Dreams environment:
  https://dev.epicgames.com/documentation/en-us/unreal-engine/electric-dreams-environment-in-unreal-engine
- UE 5.8 source:
  - `Engine/Source/Runtime/Renderer/Private/Nanite/NaniteCullRaster.cpp`
  - `Engine/Source/Runtime/RenderCore/Private/RenderUtils.cpp`
  - `Engine/Source/Runtime/Engine/Public/Materials/Material.h`
  - `Engine/Source/Runtime/Engine/Classes/Engine/EngineTypes.h`
  - `Engine/Source/Runtime/Engine/Classes/Engine/NaniteAssemblyData.h`
  - `Engine/Source/Runtime/Landscape/Classes/LandscapeProxy.h`
  - `Engine/Source/Runtime/Landscape/Private/LandscapeNaniteComponent.cpp`
  - `Engine/Source/Runtime/Landscape/Private/LandscapeRender.cpp`
  - `Engine/Source/Runtime/Engine/Private/DistanceFieldAtlas.cpp`
  - `Engine/Source/Runtime/GeometryCore/Public/Generators/MarchingCubes.h`
