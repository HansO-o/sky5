## Verdict
Build both the keep interior and the cave procedurally in `tools/gen`, using Poly Haven CC0 PBR textures. Do not use a modular dungeon kit.
- **Kits don't fit.** Every CC0 kit I checked is stylised low-poly (flat colours or a gradient atlas) and would clash with the photoreal Poly Haven town. None of them includes natural caves.
- **Format problem.** The Quaternius packs ship FBX/OBJ/Blend only, so the build would need Blender.
- **Procedural fits the project.** The shell size, the story beats (bridge drop, collapse, stream, web walls) and the Jolt colliders can all come from the same data. This matches the existing approach in `townbuildings.mjs` and `terrain.mjs`.

I prototyped the cave generator in my scratch area (nothing in the project was changed) and checked it against the real terrain from `tools/gen/world.mjs`. The approach works; the numbers are below.

## 1. Kit check (verified 2026-10-03)
| Kit | Licence (verified) | Formats | Look | Verdict |
|---|---|---|---|---|
| Quaternius **Modular Dungeons Pack** (quaternius.com/packs/modulardungeon.html) | CC0. I downloaded and read its License.txt | FBX/OBJ/Blend, Google Drive folder `1CvofJVYHf00StUTsIWtOuyVxeV0CN3UI` | 48 flat-colour pieces: Wall/Floor/Stairs_Modular, Arch_bars, Cobweb, Torch, Trapdoor, Spikes | Style clash; needs Blender |
| Quaternius **Modular Dungeon Pack** (medievaldungeon.html) | Page says CC0 | FBX/OBJ/Blend, Drive `13MoeF0Uy9PHqXXi6gh63tV2PLRD6YXJv` | 41 stylised white-stone pieces | Same |
| Quaternius **Ultimate Modular Ruins** | Page says CC0 | FBX/OBJ/Blend plus 2 textures, Drive `1ETp2ldaHaP0BkS4FBmkT-g9Yf88T_cIX` | 90 stylised pieces | Same |
| **KayKit Dungeon Pack** 1.1 (formerly "Dungeon Remastered"), kaylousberg.itch.io/kaykit-dungeon-remastered | itch page: "Asset license: Creative Commons Zero v1.0". GitHub `KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0` LICENSE.txt is CC0 | glTF/FBX/OBJ. Free tier is 31 MB. The 1.0 repo has 203 `.gltf.glb` files, about 9.1 MB, reachable through jsDelivr | One 1024² gradient atlas; walls are 4×4×1 m modules (I measured `wall_gated`) | Toy-like; usable only as a scale reference |
| Kenney **Mini Dungeon** | CC0, 30 files | glTF | Toy-like | No |

Poly Haven has no dungeon kit. Its `modular_fort_01`, already in the project, is an exterior colonial fort.

## 2. Poly Haven textures
I checked each slug with `api.polyhaven.com/info` and `/files`. All are CC0, and every one has `Diffuse`, `nor_gl` and `arm` at 1k. I also checked their looks on a thumbnail contact sheet. Sizes are the 1k source JPGs (Diffuse/Normal/ARM); after KTX2 a set ships at roughly 0.3–0.5 MB. Set `tile` to the physical size so the texture sits at real-world scale.

**Keep interior**
- Ground-floor walls: reuse **castle_wall_slates** (2.5 m, already shipped as `keep_stone`), so the inside matches the outside.
- Basement walls and vaults: **stone_brick_wall_001** (2.5 m, 0.26/0.36/0.18 MB). Dark blocks, tagged "dungeon".
- Damp cell walls: **castle_brick_01** (1.5 m, 0.69/1.07/0.21). Tagged damp/wet/moss/sewer.
- Ground-floor flagstones: **rock_tile_floor** (1.96 m, 1.13/1.06/0.73).
- Basement corridor and torture-room floor: **stone_floor** (1.85 m, 0.91/1.05/0.60).
- Wet stone (cells, collapse): **cobblestone_floor_04** (1.5 m, 0.58/0.78/0.23). Tagged damp/wet.
- Doors, rack, tables: **dark_wooden_planks** (2.0 m, 0.70/0.66/0.78).
- Bridge deck: **weathered_planks** (2.0 m, tagged "bridge", 0.60/0.68/0.53).
- Also reuse **old_planks_02** (2.0 m), **rough_wood** (note: only **0.5 m** physical) and **rusty_metal_02** for bars, chains and the cage.

**Cave**
- Main walls: **rock_face_03** (2.7 m, 0.93/1.15/0.79).
- Spider chamber walls: **dark_rock_02** (2.0 m, 0.59/1.03/0.66). Optional; you could tint rock_face_03 instead.
- Floor: **rocks_ground_08** (3.0 m, damp mud with rocks, 0.97/1.44/0.27).
- Stream bed: **ganges_river_pebbles** (2.16 m, 0.87/1.21/0.80).
- Last 25 m before the exit: **mossy_rock** (3.0 m, 1.12/1.00/0.93).
- Bear den floor: **roots** (1.67 m, 0.96/1.35/0.85). Optional.
- Alternatives I checked: rock_wall_02, rock_face, cliff_side, rock_ground_02, brown_mud_rocks_01, river_small_rocks, medieval_blocks_03, rock_wall_12, slate_floor_02, wood_trunk_wall.

**Integration notes**
- Add the new slugs to `PH_TEXTURES` in `tools/sources.mjs` as `{res:"1k",maps:["Diffuse","nor_gl","arm"]}`.
- Also add them to the hard-coded `phIds` list near line 387 of `build-assets.mjs`, or they won't appear on the credits page.
- `assets-src/textures/castle_brick_07` is an orphan: it isn't in sources.mjs, isn't credited and isn't used.
- The core set is about 10 texture sets, roughly 5 MB of KTX2. Ship the cave textures as standalone KTX2 assets, like `cart/tex/terrain_*`, because the cave material is built at runtime.

**Poly Haven models** (verified, CC0)
- **rock_face_02**: 4.9×3.5×4.7 m, 29.6k polys. Use as the brow over the cave mouth.
- Already in the project: rock_face_01, boulder_01, rock_moss_set_01/02 (rubble and mouth collar).
- **root_cluster_01**: 4.1×2.7×1.5 m, 225k polys, so simplify it hard. Hanging roots in the exit tunnel.
- **moss_01**, **dead_tree_trunk_02**.
- Dressing: **wine_barrel_01**, **wooden_crate_02**, **wooden_table_02** (196 polys), **wooden_stool_02**, **treasure_chest** (103k polys, simplify).

## 3. Keep interior
Write it as a room-graph generator, `tools/gen/keepinterior.mjs`, reusing `wallX`/`wallZ`/`box` and adding face subdivision.

**Coordinates.** All values are in the keep's local frame, which matches `buildKeep`. World = (60+x, 37.73+y, −662+z), where 37.73 is `heightAt(60,−662)−0.2`.
- The shell's inner space is x ±11.8, z ±7.8.
- The gate is x ±2 on the z 7.8–9.0 face.
- The ground-floor top is y = 0.4, the height of the top front step.

**Ground floor**
| Room | Extent (x, z) | Height / details |
|---|---|---|
| Entry hall | x −6.0…6.0, z −1.6…7.8 (12 × 9.4 m) | 6.0 m clear; ceiling at y 6.4 with 0.3×0.4 beams; two 0.9 m pillars at (±3, 2). Keep 2.2 m clear around the door hinges (leaves swing inward). |
| Storeroom | x 6.6…11.8, z 1.2…7.8 | 4.0 m clear |
| Stairwell | x 6.6…11.8, z −7.8…0.6 | Open down to the basement |
| West guard room, partly collapsed | x −11.8…−6.6 | Hole in the roof shows fire glow |
| North room | x −6…6, z −7.8…−2.2 | Where the first fight happens |

- Partition walls are 0.6 m thick. Doors are 1.4 × 2.4 m.
- **Stair down** (dog-leg, 2 × 14 steps, rise 0.214 m, run 0.30 m, width 1.7 m):
  - Top landing at z −1.2…0.6.
  - Flight A runs −Z at x 9.9…11.6, from y 0.4 to −2.6.
  - Landing at z −7.6…−5.4.
  - Flight B runs +Z at x 6.8…8.5, down to −5.6.
  - 1.0 m railing around the void.

**Basement** (floor y −5.6, world ≈ 32.1)
- Stair foot: x 6.6…11.8, z −1.2…7.8, 3.6 m clear.
- Corridor: x −1…6.6, z 4.4…6.8, 3.0 m clear.
- Torture room: x −10.6…−1.0, z −1.4…7.6, 4.4 m barrel vault.
- Cell corridor: x −7.1…−4.7 (2.4 m wide), running z −1.4 → −26, 3.2 m clear.
- 8 cells, each 3.0 × 3.4 m: west side x −10.5…−7.1, east side x −4.7…−1.3, in bands of 3.4 m from z −3.0.
  - Bars: 15 mm radius, 0.12 m apart, 2.6 m tall. Doors 0.9 × 2.1 m.
- Collapsed passage: z −26…−34. Walls crack, then a rubble ramp drops 2.1 m (about 25°) into the cave at world (54, 30.0, −697).
- Rock cover over the basement ceiling is at least 2.3 m (terrain about 38 m at z −680).

**Changes needed to `buildKeep`**
- Remove or hide the `dark` box that fills the gate passage.
- Optionally add 0.2 × 1.2 m arrow slits so shafts of daylight come in.

**Geometry and baking**
- Subdivide wall and floor faces into cells of about 0.5 m. Otherwise vertex AO can't vary across a 4-vertex wall.
- Bake AO by treating the interior as a union of boxes (`sdBox`) and using the same 5-probe SDF AO estimator as the cave.
- Bake grime too: darker below 0.6 m, and soot above torch anchors.
- Doors, bars, the cage and the bridge go in separate nodes. Light, spawn and zone anchors go in empty nodes, using `finalize(doc,{keepLeaves:true})` as the wagon seats do.
- Expected size: about 30–40k triangles.

## 4. Cave
I recommend an SDF over spline-swept tubes, rather than explicit tube meshes. Joins and chambers merge cleanly, and the AO comes almost for free.

**SDF**
- Each tunnel is a Catmull-Rom spline with control points `[x, floorY, z, halfWidth, clearHeight]`.
- Each segment is a "D-shaped" capsule: an elliptical section with its centre at 35% of the clear height, cut flat at `floorY`.
- Chambers are ellipsoids with a flat floor. The stream is a trench SDF along its own spline.
- Combine everything with polynomial `smin` (k 1.2 m for tunnels, 2 m for chambers, 0.8 m for the channel).
- Add 3D fbm noise: amplitude 0.55 m on walls and ceiling, 0.12 m within 0.6 m of the floor so it stays walkable.
- **Every tunnel must start and end inside the chamber it connects to.** In my first layout, ending tunnels short left 2 m gaps.
- For a less tube-like look, add lateral domain warp (0.5–1.2 m at 8–15 m wavelength) and strata (`sin(y·2.5+fbm)·0.15`).

**Mesh extraction** (sparse naive surface nets)
- 0.5 m grid, 8³-cell blocks. Skip a block if |base SDF at its centre| exceeds its radius + 1.2 m; this skipped 94% of blocks.
- One vertex per cell, then project 1–2 steps along the gradient. Clamp each step to 0.6×cell size to avoid spikes.
- Normal = −∇SDF, pointing into the air.
- **Winding:** the face normal must point into the air. In the prototype, 99.5% of faces agree after the fix. This matters because Jolt's ray casts ignore back faces by default.

**Prototype results** (275 m path, 5,437 m² of surface)
- 30.7k vertices, 61.5k triangles.
- Simplified with meshopt: 21.5k triangles for rendering (35%), 7.4k for the collider (12%).
- Minimum rock cover 9.6 m. Minimum clearance 3.75 m. Minimum half-width 1.9 m.
- Build time 26 s single-threaded. A segment spatial hash or worker_threads (as `lib/ktx.mjs` does) should bring that to a few seconds.
- The inside renders show a coherent flat-floored tunnel with noisy walls.

**Layout** (world coordinates, all checked against `world.mjs`)
| Section | Position / extent | Size and contents |
|---|---|---|
| Entry tunnel | From (54, 30, −697), about 50 m | 3.2–4.4 m wide, 2.8–3.6 m clear |
| Spider chamber | Centre (42, 27, −742) | About 18 × 14 m, dome 8.5 m. 2.5 m ceiling chimney for the spider. Webs across both entrances. |
| Tunnel to the stream gallery | About 45 m | |
| Stream gallery | Centre (0, 26, −765) | Ledges at 26 m; 3 m channel; bed at 22.5; water surface 23.1 (0.6 m deep) |
| Bridge | Across the gallery | 7.2 × 1.4 m deck, 1.0 m rope rails. Hinged at the east end; the far end drops and the player falls 3 m into the water. |
| Wading section | Down the stream to the bear den, about 50 m | Water 0.3 m deep |
| Bear den | Centre (−28, 23, −715) | About 14 × 12 m, 5.5 m clear. Daylight crack in the ceiling: a 1.2 × 6 m slot faked with an emissive disk and a spot light. |
| Exit tunnel | About 90 m | Average climb about 12° from 23 m to the mouth. Width grows from 4 m to 7 m. |

- **Exit mouth:** move it to about (−37, 42.5, −646) instead of my first try at 48.4 m. That spot is on a ~60° slope facing SE (yaw about 45°), with a view over the keep 100 m away.
- Where the tunnel climbs more than 20°, terrace the floor into rock steps of 0.4 m or less. The player's step-up is 0.45 m. My 25° test section dipped by up to 1.3 m where segments joined.

**Mouth integration**
- Clip cave triangles that lie above terrain + 0.3 m (2.2k triangles in the prototype).
- Flatten a 6×6 m apron in `world.mjs` `sample()`.
- Skip terrain-render quads inside the mouth outline. The terrain chunk there uses a 2 m grid.
- In the Jolt heightfield, set samples in that outline to `cNoCollisionValue` (FLT_MAX). The binding exposes `HeightFieldShapeConstantValues.cNoCollisionValue`.
- Cover the 2 m-quantised seam with rock_face_02 and boulders.
- Add a scatter exclusion of about 8 m around the mouth.

**Zones**
- Split the mesh into 5 zones (entry, spider, gallery+stream, den, exit) by nearest spline.
- Each zone gets its own material instance (wall/floor texture choice) and is used for zone culling.

**Triplanar plugin**
- Write a `MaterialPluginBase` in GLSL and WGSL, like `TerrainSplatPlugin`.
- Wall layer: triplanar, blend sharpness `pow(abs(N),4)`. Use proper per-axis normal swizzle (whiteout/UDN). The terrain plugin uses only the top projection for normals.
- Floor layer: top projection, weighted by `smoothstep(0.55,0.8,N.y)` plus noise.
- Wetness factor: albedo ×0.55 and roughness → 0.15, near the stream and drip zones.
- Cap it at 2 layers × (D, N, ARM). PBR plus IBL plus clustered textures then stays at about 13 samplers or fewer. WebGPU allows 16 samplers per stage, and Babylon uses one per texture.
- On low quality use biplanar mapping.

## 5. Lighting (WebGPU/WebGL2)
**Interior profiles**, faded by zone triggers. Each sets env intensity, sun, fog colour and density, and exposure:

| Zone | Env intensity | Sun | Fog colour | Fog density | Exposure |
|---|---|---|---|---|---|
| Ground floor | 0.25 | — | (0.08, 0.06, 0.05) | 0.02 | 1.25 |
| Basement | 0.08 | off | (0.03, 0.03, 0.035) | 0.035 | 1.45 |
| Cave | 0.05 | off | (0.02, 0.025, 0.03) | 0.04 | 1.6 |
| Exit tunnel (last 40 m) | Blend toward outdoors by distance to the mouth | | | | |

- Turn CSM shadow refresh off while inside.
- Hide outdoor sets once the keep door closes.

**Keep the sun and hemispheric fill off interior meshes**
- Put interior meshes on `layerMask` 0x2 and set `sun.includeOnlyWithLayerMask=1`. I confirmed this API exists in Babylon 9.29.
- On low quality there are no shadows at all, so without this the sun would light the interiors.
- Add one dim interior hemispheric fill on layer 2: 0.04, bluish, no specular.

**Point lights: use Babylon's `ClusteredLightContainer`** (present in Babylon 9.29, both GLSL and WGSL)
- The container takes one of the 4 default light slots on PBR materials (`maxSimultaneousLights=4`).
- Per batch: WebGPU 32 lights; WebGL2 needs float colour buffers and float blending, about 23 lights per batch; mobile 8.
- Its rules: point or spot lights only, no shadows, `FALLOFF_DEFAULT`.
- Choose the range so the cutoff is invisible (intensity ÷ range² < 0.02):
  - Torch: intensity 5–7, range 16, colour (1, 0.58, 0.28). Sconces at 2.0 m, every 5–6 m.
  - Brazier: intensity 10, range 20.
  - Fungus: intensity 0.6, range 5, teal.
  - Daylight shaft: spot light, intensity about 30, range 25.
- Fallback when `ClusteredLightContainer.IsLightSupported()` is false: a pool of 3–4 point lights, reassigned every 0.25 s to the nearest torches with crossfades.
- Place lights at least their range away from unrelated tunnels, because clustered lights don't use include lists.

**Vertex AO**
- Store AO in COLOR_0 RGB. gltf-transform's `prune` keeps COLOR_0.
- Gotcha: Babylon's glTF loader sets `hasVertexAlpha=true` for VEC4 colours. Reset it to false after load, as `World.ts` already does for the terrain.

**Emissive fungus**
- Procedural caps (radius 0.04–0.16 m), 5–12 per cluster, 40–80 clusters drawn as thin instances.
- Place them where AO < 0.6 and within 3 m of the stream.
- Emissive (0.25, 0.85, 0.75) × 1.5–2.5. Bloom only appears on high quality. Give 6–10 hero clusters a real light.

## 6. Water
- A ribbon mesh along the stream spline at water level, 0.6 m wider than the channel. UVs: u = arc length / 2 (flow direction), v across.
- PBR material: albedo (0.02, 0.035, 0.04), alpha about 0.75, roughness 0.08.
- A small plugin samples the normal map twice, at two scales and speeds (about 0.6 m/s along u). Foam at the edges comes from vertex alpha.
- Generate the normal map at build time: a sum of integer-wavevector sines, so it tiles perfectly and needs no licence. Fallback: `assets.babylonjs.com/textures/waterbump.png`, CC BY 4.0, already in the credits family.
- No water collider. A trigger volume slows the player to 0.65×, plays splashes and spawns ripple particles.

## 7. Spider webs (alpha cards)
- Generate the web textures as SVG and rasterise with **sharp**, which is already a devDependency. I confirmed librsvg works here: a 1024² RGBA orb web, 192 KB PNG.
- Make a 2×2 atlas: orb, corner, sheet, cocoon wrap. Encode with `toKTX2` using `colorHQ`.
- Material: double-sided, roughness 0.35, alpha blend with depth write off, emissive 0.05.
- Placement:
  - Web walls at the spider chamber entrances: 3 stacked cards, 4.4 × 3.6 m, 0.15 m apart, each with a removable box collider. They dissolve when cut or burned.
  - 12–20 corner and ceiling webs, 1.5–4 m.
  - 5–8 cocoons: capsules with radius 0.35 m, 1.2–1.8 m long.
  - Glowing egg sacs, 0.4–0.7 m.

## 8. Jolt colliders
- Emit separate `*_col` nodes or a .bin; don't reuse the render meshes:
  - Keep: unsubdivided boxes, plus **one ramp per stair flight** (35.5°, under the 50° slope limit).
  - Bars: one thin box per cell front.
  - Doors: separate bodies.
  - Cave: the 12% simplified mesh, split per zone and built across frames. Use `mBuildQuality=FavorBuildSpeed` if needed.
- Removable bodies: the bridge deck, which becomes Debris-layer planks like the tower breach, plus the web walls and the rubble.
- Add per-triangle material IDs (stone, wood, dirt, water bed) for footstep sounds. Today `addStaticMesh` passes an empty material list.
- Clearance rules: at least 2.6 m high and 0.9 m half-width everywhere, so the third-person camera boom fits.
- Also emit a walkable-triangle mesh (normal.y > cos 45°) for the navmesh work.

## Prototype files (scratch, not in the project)
- `/tmp/claude-0/research/env/cave_proto.mjs`: SDF, surface nets, AO, rock-cover, walkability and winding checks.
- `/tmp/claude-0/research/env/render_persp.mjs`: perspective renders from inside the cave.
- `/tmp/claude-0/research/env/web_tex.mjs`: web texture generator.
- Output images: `views.jpg`, `cave_top.png`, `web_orb_preview.jpg`.
- Texture contact sheets: `sheet_rock.jpg`, `sheet_keep.jpg`.
- `exit.mjs` and `mouth.mjs`: terrain probes used to find the exit.

## Recommendations
- Approach for keep interior + cave geometry: Procedural generation in tools/gen (keepinterior.mjs room graph with subdivided boxes + cave.mjs SDF/surface nets), Poly Haven PBR textures; no third-party dungeon kit | Existing pipeline: tools/gen/townbuildings.mjs, terrain.mjs, lib/gltf.mjs MeshBuilder/finalize; prototype /tmp/claude-0/research/env/cave_proto.mjs | Own code + Poly Haven CC0 | verified=True | New files tools/gen/keepinterior.mjs, tools/gen/cave.mjs, tools/lib/sdf.mjs; new build-assets steps keep/interior, cave/mesh, cave/tex/*
- Keep ground-floor walls: castle_wall_slates (reuse; 2.5 m tile) | https://polyhaven.com/a/castle_wall_slates | CC0 1.0 | verified=True | Already in PH_TEXTURES / assets-src/textures/castle_wall_slates
- Keep basement walls/vaults: stone_brick_wall_001 (2.5 m; dark dungeon blocks) | https://polyhaven.com/a/stone_brick_wall_001 | CC0 1.0 | verified=True | tools/sources.mjs PH_TEXTURES: stone_brick_wall_001: { res: "1k", maps: ["Diffuse","nor_gl","arm"] }; add to credits phIds list in build-assets.mjs
- Damp cell-block walls (wet stone): castle_brick_01 (1.5 m; tags damp/wet/moss) | https://polyhaven.com/a/castle_brick_01 | CC0 1.0 | verified=True | PH_TEXTURES castle_brick_01 { res: "1k", maps: ["Diffuse","nor_gl","arm"] }
- Keep floors: rock_tile_floor (ground floor, 1.96 m), stone_floor (basement corridor and torture room, 1.85 m), cobblestone_floor_04 (wet cells and collapse, 1.5 m) | https://polyhaven.com/a/rock_tile_floor ; https://polyhaven.com/a/stone_floor ; https://polyhaven.com/a/cobblestone_floor_04 | CC0 1.0 | verified=True | PH_TEXTURES entries with res 1k, maps Diffuse/nor_gl/arm
- Wood (doors, rack, bridge) and metal: dark_wooden_planks (2 m), weathered_planks (2 m, bridge deck); reuse old_planks_02, rough_wood (0.5 m physical), rusty_metal_02 | https://polyhaven.com/a/dark_wooden_planks ; https://polyhaven.com/a/weathered_planks | CC0 1.0 | verified=True | PH_TEXTURES entries res 1k Diffuse/nor_gl/arm (others already present)
- Cave rock walls: rock_face_03 (main, 2.7 m); dark_rock_02 (spider chamber, 2.0 m, optional); mossy_rock (last 25 m to the exit, 3.0 m) | https://polyhaven.com/a/rock_face_03 ; https://polyhaven.com/a/dark_rock_02 ; https://polyhaven.com/a/mossy_rock | CC0 1.0 | verified=True | PH_TEXTURES res 1k Diffuse/nor_gl/arm; emit as standalone KTX2 (like cart/tex/terrain_*) for the runtime triplanar plugin
- Cave floor / stream bed / den floor: rocks_ground_08 (damp mud+rocks, 3.0 m); ganges_river_pebbles (stream bed, 2.16 m); roots (bear den, 1.67 m, optional) | https://polyhaven.com/a/rocks_ground_08 ; https://polyhaven.com/a/ganges_river_pebbles ; https://polyhaven.com/a/roots | CC0 1.0 | verified=True | PH_TEXTURES res 1k Diffuse/nor_gl/arm
- Cave mouth brow, rubble, roots, dressing: rock_face_02 (4.9x3.5x4.7 m brow); reuse rock_face_01, boulder_01, rock_moss_set_01/02; root_cluster_01 (simplify heavily), moss_01, dead_tree_trunk_02; props wine_barrel_01, wooden_crate_02, wooden_table_02, wooden_stool_02, treasure_chest | https://polyhaven.com/a/<slug> | CC0 1.0 | verified=True | PH_MODELS in tools/sources.mjs ("1k"), then a PH entry in build-assets with simplify ratio (permissive for scans)
- Cave tunnel geometry: SDF union of D-shaped swept capsules along Catmull-Rom splines + flat-floored ellipsoid chambers + stream trench; fbm noise (0.55 m walls, 0.12 m floor); sparse naive surface nets at 0.5 m; gradient normals; SDF AO; clip above terrain+0.3 m; meshopt simplify (35% render / 12% collider) | Prototype /tmp/claude-0/research/env/cave_proto.mjs (61k raw tris -> 21.5k render / 7.4k collider for 275 m; min cover 9.6 m; clearance >= 3.75 m) | Own code | verified=True | Port into tools/gen/cave.mjs; add a validator (cover >= 1.5 m, clearance >= 2.6 m, half-width >= 0.9 m, floor slope <= 35 deg, winding check)
- Cave texturing: Runtime MaterialPluginBase (GLSL+WGSL, modelled on TerrainSplatPlugin): triplanar wall layer with per-axis normal swizzle, top-projected floor by N.y, wetness from vertex alpha / stream proximity; 2 layers max; biplanar on low quality | src/world/materials.ts pattern | Own code | verified=False | src/world/caveMaterial.ts
- Many point lights (torches, braziers, fungus): Babylon ClusteredLightContainer (point/spot, no shadows, FALLOFF_DEFAULT; 32 lights per batch on WebGPU, float-blend WebGL2 about 23, mobile 8); fallback pool of 3-4 nearest lights; interior meshes on layerMask 0x2 with sun.includeOnlyWithLayerMask=1; zone ambience profiles | node_modules/@babylonjs/core/Lights/Clustered/clusteredLightContainer (Babylon 9.29.0, confirmed present with GLSL+WGSL shader paths) | Apache-2.0 (Babylon.js, already credited) | verified=True | import { ClusteredLightContainer } from "@babylonjs/core/Lights/Clustered/clusteredLightContainer" + clusteredLightingSceneComponent
- Spider web alpha textures: Procedural SVG orb/corner/sheet/cocoon webs rasterised by sharp (librsvg) -> KTX2 colorHQ atlas; double-sided alpha-blend cards | Prototype /tmp/claude-0/research/env/web_tex.mjs (1024^2 RGBA, 192 KB PNG) | Own generated (no credit needed) | verified=True | tools/gen/webtex.mjs in build-assets using sharp (already a devDependency)
- Water normal map: Build-time tileable normal map from a sum of integer-wavevector sines; fallback Babylon waterbump.png | Own generator; fallback https://assets.babylonjs.com/textures/waterbump.png (HTTP 200, 60 KB) | Own (generated) / fallback CC BY 4.0 (BabylonJS/Assets README) | verified=True | tools/gen/watertex.mjs -> toKTX2 preset normal; fallback via fetch-extra download + EXTRA_CREDITS entry
- Jolt colliders: Separate low-poly collision nodes: keep = unsubdivided boxes + one ramp per stair flight; cave = 12% simplified mesh per zone; removable bodies for bridge deck, web walls, rubble; heightfield hole at the mouth via cNoCollisionValue; per-triangle material IDs for footsteps | src/physics/Physics.ts addStaticMesh/addHeightField; jolt-physics typings (HeightFieldShapeConstantValues.cNoCollisionValue, MeshShapeSettings.mBuildQuality) | MIT (Jolt) | verified=True | Extend Physics.addHeightField with a hole predicate and addStaticMesh with a material list
- Third-party modular dungeon kit: Not used. Quaternius Modular Dungeons/Dungeon/Ultimate Modular Ruins (CC0, FBX/OBJ/Blend only, stylised) and KayKit Dungeon Pack 1.1 (CC0, glTF, 1024 gradient atlas, 4x4x1 m modules) both clash with the photoreal Poly Haven town and contain no caves | https://quaternius.com/packs/modulardungeon.html ; https://kaylousberg.itch.io/kaykit-dungeon-remastered ; github KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | CC0 1.0 (verified License.txt / LICENSE.txt / itch metadata) | verified=True | n/a (KayKit glbs reachable via cdn.jsdelivr.net/gh/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0@main/addons/kaykit_dungeon_remastered/Assets/gltf/<name>.gltf.glb if ever needed for scale reference)

## Risks
- Exit mouth on the west valley wall at about (-37, 42.5, -646) needs four changes: a terrain hole in both the render chunks and the Jolt heightfield (cNoCollisionValue, quantised to 2 m), a flattened apron in world.mjs sample(), a scatter exclusion, and a rock collar to hide the seam. My first spline ended at 48.4 m, which left the tunnel floating 6-9 m above the slope.
- The terrain is not a reliable sun-shadow occluder, and on low quality there are no shadows at all. Unless interior meshes go on a separate layer mask (sun.includeOnlyWithLayerMask), the sun and hemispheric fill will light the keep and cave interiors.
- Babylon's glTF loader sets hasVertexAlpha=true for VEC4 COLOR_0 (from MeshBuilder), which would push the AO-coloured meshes into transparent sorting. Reset it after load.
- ClusteredLightContainer does not support shadows or non-default falloff, and probably not include lists. With physical falloff, a range that is too short shows a hard cutoff, so keep intensity/range^2 below 0.02. Some WebGL2 devices lack float blending and need the pooled fallback.
- Sampler budget: WebGPU usually allows 16 samplers per stage. PBR + IBL + clustered lighting + a 2-layer triplanar plugin comes to about 13; adding a third full layer or shadow maps can exceed it.
- Surface-nets projection can create spikes (seen in my renders); clamp the step. Smooth-min joins on tunnels steeper than 20 deg dip the floor by up to 1.3 m. Terrace steep sections into steps of 0.4 m or less (player step-up is 0.45 m).
- The cave build takes about 26 s single-threaded in the naive prototype and will grow with detail; it needs a spatial hash or worker threads.
- About 13 new Poly Haven texture sets add roughly 5-7 MB of KTX2 over the keep and cave segments. These need manifest segments and prefetch during the dragon chapter; trim the optional sets (dark_rock_02, roots, stone_floor) if the budget is tight.
- castle_brick_07 is sitting in assets-src/textures but is not in sources.mjs or the credits. New slugs must also be added to the hard-coded phIds credits list in build-assets.mjs.
- Exit-tunnel light leaks: unshadowed torch light can reach neighbouring spaces through rock. Keep lights at least their range away from unrelated tunnels.