# A better nature generator for the valley lab

The goal: the valley lab (`tasks/in-progress/demo-world-scene.md`) needs trees, bushes, rocks, grass and ground
litter that look good. They come from the kit's own generator, `vge/tools/nature-meshes.mjs`, a Node script that
writes `.glb` files with `@gltf-transform/core`; the content service imports them with Nanite on. No PCG yet and no
external DCC tools. This note lists the open libraries and textures that can replace the naive geometry, what the
three.js showcase already has, and how to put them together.

Everything below was read on the cited page or in the cited file. Nothing was installed, downloaded or run.

## 1. What the generator makes today and why it looks naive

`nature-meshes.mjs`:
- **Tree**: a 14-sided tube trunk and recursive 8-sided branch tubes, then 42 square leaf cards per twig end. The leaf
  shape is a noise mask in `nature.material.tsx` (`LeafCluster`), the colour is two-tone noise; no leaf texture.
- **Rock**: an icosphere subdivided four times, pushed out by nine bumps, flat-shaded, UVs from the XZ position.
- **Grass**: 22 four-segment blades in a clump with a root-to-tip colour ramp.
- Materials are flat colours with procedural noise in HLSL; no bark, rock or leaf textures at all.

What makes Megascans-like vegetation read as real is mostly what is missing here: photographed leaf and bark albedo
with opacity and translucency, normal and roughness maps, real branch structure, rock silhouettes with facets and
cracks, and textured, triplanar rock materials.

## 2. What the three.js showcase already has (`C:\Users\pavel\projects\AIGamess\ThreejsShowcase`)

All of it is geometry in `THREE.BufferGeometry` plus textures computed into `Uint8Array`s, so it runs in Node
(`three` core needs no DOM for geometry; the kit already depends on `three` 0.185). The TSL materials do not carry
over; their maps and colours do.

| Showcase file | What it generates | Carry over to the kit |
|---|---|---|
| `src/entities/conifer/ezPine.ts` | pines and bushes from `@dgreenheck/ez-tree` presets (`Pine Small/Medium/Large`, `Bush 1-3`), with a `narrowCrown` tweak | yes, the presets and the tweak |
| `src/entities/conifer/branchGrowth.ts`, `needleSpray.ts`, `index.ts` | spruce: whorls (0.42 m spacing, 6 branches per whorl, 14 twigs per branch), shoots of flat needle quads | yes, geometry |
| `src/entities/shrub/index.ts` | undergrowth rosette of arching broad leaves as real geometry (no alpha cards): midrib arch, gravity droop, folded halves | yes, geometry |
| `src/entities/palm/index.ts`, `trunkSurface.ts` | palm crown; trunk albedo/normal/roughness from one height field (leaf scars on the phyllotaxis spiral, fissures, weathering) | the trunk-surface method applies to bark |
| `src/entities/foliage/leafOptics.ts` | leaf colour from biochemistry (PROSPECT plate model): reflectance and transmittance per leaf, age and senescence variation | yes, gives base and subsurface colours per leaf |
| `src/entities/foliage/leafSurface.ts` | leaf normal and roughness maps from venation (parallel or pinnate) | yes, written as PNG |
| `src/entities/rocks/rockGeometry.ts` | boulder: welded icosphere (up to 20k triangles), anisotropic stretch, fbm lumps, 3-9 random plane cuts for facets, ridged crevices, flat bottom, smooth/flat normal blend by sharpness, a `crevice` attribute for shading | yes, directly |
| `src/entities/rocks/index.ts` | world-space triplanar rock material on ambientCG `Rock030` (colour, normal, roughness, AO), albedo calibrated to a target mean | the method and the textures |
| `src/entities/grove/blockoutProps.ts` | fern clump, fallen log, boulder, spruce for blockouts | fern and log |
| `src/shared/lib/noise.ts` | seeded mulberry32 + `simplex-noise` with fbm and ridged helpers | yes (`simplex-noise` is not yet a kit dependency) |
| `docs/lessons-foliage-materials.md` | traps met on the way: double normal unpack, albedo clipped when normalised in 8-bit sRGB, Fresnel counted twice | read before porting the leaf maps |

## 3. Open libraries

### Trees and bushes

| Library | Licence | State | In Node | What it gives |
|---|---|---|---|---|
| **ez-tree** (`@dgreenheck/ez-tree`, [repo](https://github.com/dgreenheck/ez-tree)) | MIT | npm 1.1.0 (2026-01-15); repo v2.0.0 tag 2026-07-16 with geometric LOD | geometry yes; `src/lib/textures.js` imports `.jpg`/`.png` as modules, so plain Node needs a loader or a stub for those imports | presets ash, aspen, oak, pine (small/medium/large), bush 1-3, trellis; bark textures (birch, oak, pine, willow, 1K, credited in `assets/bark/README.md` to texturecan.com and Poly Haven, both CC0); leaf PNGs (ash, aspen, oak, pine) with no stated source |
| **SeedThree** ([repo](https://github.com/SkyeShark/SeedThree)) | MIT | pushed 2026-10-01 | generators import only geometry classes from `three/webgpu` (Node import not verified); `ground-cover.js` and `export-glb.js` are browser-only | Weber-Penn broadleaf and conifer, dichotomous L-system shrubs, leaf/needle/spray cards, grass, scrub, fallen limbs, rocks, LODs; 20+ species presets. Its textures were generated with an image model and have no stated licence |
| **proctree.js** ([repo](https://github.com/supereggbert/proctree.js)) | BSD-style header (Paul Brunt, 2012), no LICENSE file | 2019 | pure math, needs `globalThis.window = globalThis` | trunk mesh plus a separate twig-card mesh |
| **space-colonization** (npm) | MIT per README | 2016 | yes | 3D skeleton only |

### Grass and ground cover

| Library | Licence | In Node | What it gives |
|---|---|---|---|
| **gaia** ([repo](https://github.com/owenyuwono/gaia)) | MIT, pushed 2026-08-20 | yes: `src/bladeMesh.js` `buildBladeGeometry` is plain JS, tested with `node:test` | genome, skeleton and blade geometry for grass, separate from the shader |
| SeedThree `grass.js`, `scrub.js`, `fallen-limbs.js` | MIT | geometry yes | grass, scrub, fallen branches |
| James-Smyth/three-grass-demo | MIT | yes | a 5-vertex blade; too simple |

No dedicated JS ground-litter generator was found; litter is built from the same pieces (leaf cards scattered flat,
twigs from the branch generator, pebbles from the rock generator) or taken from Poly Haven scans (below).

### Rocks

| Library | Licence | In Node | What it gives |
|---|---|---|---|
| Showcase `rockGeometry.ts` | ours | yes | section 2 |
| **RockGenerator** ([repo](https://github.com/bamyazi/RockGenerator), [demo](https://bamyazi.github.io/RockGenerator/)) | MIT, pushed 2026-03-03 | geometry files import only `three` core; its exporter is browser-only | 12 base shapes; simplex/Worley/fbm/domain-warp/ridge displacement; 9 crack algorithms; thermal erosion, edge chipping, undercuts, moss, curvature colour, vertex AO, decimation |
| **threejs-procedural-rocks-cliffs** ([repo](https://github.com/maxliebscher/threejs-procedural-rocks-cliffs), [demo](https://maxliebscher.github.io/threejs-procedural-rocks-cliffs/)) | MIT, pushed 2026-10-22 | yes, the README says the compiler is CPU-only with tests under Node | rocks and cliffs as SDFs with smooth union, meshed by marching tetrahedra; triplanar, no UVs; its textures are image-model generated with no licence |
| gl-rock ([repo](https://github.com/Erkaman/gl-rock)) | MIT, 2016 | yes | sphere scraped by planes plus Perlin noise (the showcase does the same, better) |

### Mesh tools already in the kit

- `@gltf-transform/functions` 4.5.1: `weld`, `simplify` (with `MeshoptSimplifier`, after `weld`), `tangents`
  (needs the `mikktspace` package), `unwrap` (needs `watlas`), `dedup`, `prune`. Its `normals()` writes flat normals
  only (it unwelds first), so smooth normals are computed before the data reaches gltf-transform, for example with
  three's `mergeVertices` and `computeVertexNormals`.
- `meshoptimizer` 1.3.0: `MeshoptSimplifier.simplify` / `simplifyWithAttributes`, after `await MeshoptSimplifier.ready`.
- `sharp`: writes PNGs from the generated `Uint8Array` maps and merges a separate alpha into a base colour.
- three's `GLTFExporter` needs `FileReader` and a canvas, which Node lacks; copying `BufferGeometry` attributes into
  gltf-transform accessors, as `nature-meshes.mjs` already does, avoids it.

## 4. Textures (all CC0, shippable, no credit required)

The textures make most of the difference, and photographed CC0 sets exist for every part:

- **ambientCG** ([licence](https://docs.ambientcg.com/license/)):
  - `LeafSet` atlases: 30 sets of photographed leaves (about 40 x 40 cm, 1K-8K) with colour, opacity, normal,
    roughness, displacement and **scattering** (translucency) maps, e.g.
    [LeafSet024](https://ambientcg.com/view?id=LeafSet024). Use them for leaf and twig cards and for geometric leaves'
    albedo.
  - `Foliage001-008` atlases with opacity (007 and 008 with scattering).
  - `ScatteredLeaves001-009`: tiling leaf-litter ground materials.
  - Rock and bark materials (the showcase uses `Rock030`).
  - API: `https://ambientcg.com/api/v2/full_json?category=LeafSet`.
- **Poly Haven** ([licence](https://polyhaven.com/license), API `https://api.polyhaven.com`, no key, send a User-Agent
  naming the app):
  - Scanned models: grass `grass_medium_01/02`, `grass_bermuda_01`; `fern_02`, `moss_01`; shrubs `shrub_01-04`,
    `nettle_plant`, `weed_plant_02`; flowers `dandelion_01`, `celandine_01`; litter `dry_branches_medium_01`,
    `bark_debris_01`, `pine_roots`, `tree_stump_01/02`; rocks `rock_07`, `rock_09`, `stone_01`, `boulder_01`,
    `rock_moss_set_01/02`.
  - About 200 textures: `forest_floor`, `forest_leaves_02-04`, `dry_decay_leaves`, `pine_bark`, `bark_brown_01/02`,
    `mossy_rock`, `rock_face`, `pebbles`, `gravel`.
  - A trap: in the glTFs of `shrub_01`, `fern_02` and `grass_medium_01` the base colour is a `.jpg` without alpha and
    the alpha map is a separate file, so the opacity has to be merged into the base colour before import.
- **texturecan.com** and **3dtextures.me**: CC0 by their terms pages.

## 5. Recommended generator

Keep `nature-meshes.mjs` as the one script; replace its builders and give every material real maps.

1. **Trees**: ez-tree presets for broadleaf (oak, ash, aspen) and pine, generated in Node with its texture imports
   stubbed; the showcase spruce (`branchGrowth` + `needleSpray`) for conifers. Leaves: cards textured with ambientCG
   `LeafSet` atlases (colour + opacity + normal + roughness + scattering), and the showcase's geometric broad leaves
   where the camera comes close. Bark: CC0 bark sets (ez-tree's own, or Poly Haven `bark_brown_02`, `pine_bark` at
   2K-4K).
2. **Bushes and undergrowth**: the showcase shrub (geometric leaves) and fern; ez-tree `Bush 1-3`; leaf colour per
   leaf from `leafOptics.ts`.
3. **Grass**: gaia's `buildBladeGeometry` or the existing clump with more blades, curvature and per-blade colour from
   leaf optics; plus Poly Haven `grass_medium_01/02` as scanned clumps.
4. **Ground litter**: Poly Haven `dry_branches_medium_01`, `bark_debris_01`, `tree_stump_*`; scattered leaf cards
   from `LeafSet`; pebbles from the rock generator at small radius; ambientCG `ScatteredLeaves` and Poly Haven
   `forest_floor` as a terrain layer under the trees.
5. **Rocks**: the showcase `rockGeometry.ts` (facets and crevices) at Nanite density, or RockGenerator's crack and
   erosion modules; world-space triplanar material on a CC0 rock set (ambientCG `Rock030` as in the showcase, Poly
   Haven `rock_face`, `mossy_rock`), with moss on upward faces as `nature.material.tsx` already does.
6. **Textures in the pipeline**: downloaded once into `src/features/world/assets/nature/textures/` beside the
   meshes, referenced from the `.glb` (or from the material module), so the content pipeline imports them like any
   asset.

## 6. Rendering in the lab (what UE 5.8 needs for this, read in the engine source)

- Masked leaf cards are supported on Nanite (programmable raster, `r.Nanite.AllowMaskedMaterials` 1). The Nanite
  Foliage docs call alpha cards a poor fit and prefer geometric leaves; cards are still the cheapest way to use the
  `LeafSet` atlases, and geometric leaves can replace them per species.
- Far trees thin out under Nanite simplification. `FMeshNaniteSettings::ShapePreservation` = `Voxelize` keeps their
  volume (`Engine/Source/Runtime/Engine/Classes/Engine/EngineTypes.h:3265`), but only with `r.Nanite.Foliage=1` (or
  `r.Nanite.AllowVoxels=1`) in `DefaultEngine.ini`, otherwise the builder resets it to `None`
  (`Engine/Source/Developer/MeshBuilder/Private/StaticMeshBuilder.cpp:251`). The kit sets neither, and
  `VgeImporter.cpp:211` sets only `bEnabled`. A leaf material on voxels also needs usage `voxels`
  (`MATUSAGE_Voxels`).
- Wind by WPO (as `nature.material.tsx` does) needs `MaxWorldPositionOffsetDisplacement` on the material so swaying
  geometry is not culled at rest bounds (`Material.h:1214`), and a WPO disable distance per component
  (`StaticMeshComponent.h:155`).
- `Nature.tsx` creates one `staticMeshComponent` per placement (3200 grass tufts are 3200 components); the kit's
  `VgeInstancePool` already batches ISM instances.

## 7. Later, with PCG

UE 5.8 has Epic's own generator, the Procedural Vegetation Editor (`Engine/Plugins/Experimental/ProceduralVegetationEditor`),
a PCG-based botanical grower that exports Nanite Foliage (geometric leaves as Nanite Assembly parts, voxels, bone
wind through the DynamicWind plugin) and ships Quixel Megaplants samples (hazel, beech, aspen, maple). Its export runs
only from an editor button (`PVEditor.cpp:786` calls the private `FPVExporter`), so driving it from the kit needs a
content-service command. That belongs with the PCG step, not with this lab.
