# 18: Copilot room concepts, a 3D room that matches the render

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** the interactive 3D room shows the same room as the presentation render: same layout, real depth on feature walls, composed furniture groups, lit like a studio model. It still rotates, walks in and edits.

**Why (owner, 2026-11-06):** after plan 17, the presentation render looked like a professional concept and the 3D still looked like a toy: loose desks, a lone partition, ball plants, flat slat walls, hard light. Outside review agreed on the causes:
1. **The 3D and the render are two separate guesses.** The 3D is described from the restyled eye-level photo before the render exists; the render invents the rest of the room.
2. **The model has to line up loose pieces** (desks, screens, chairs) and doesn't.
3. **Feature walls are flat textures**, one finish per wall, no columns.
4. **The ceiling glow is hidden in the overview**, and the room is lit by a hard sun on black.
5. **Plants and chairs are primitive shapes.**

**Architecture:**
- **Two passes.** Pass 1 (unchanged) describes the room from the photos; it owns the **shell**: size, walls, floor, ceiling, doors, windows, and the new **nibs** (columns). Pass 2 runs after the presentation render and describes only the **contents** (built-ins, items, wall panels) from the render, inside the fixed shell. It's applied only while the room is unedited; otherwise the viewer offers **Match render**, and **Undo match** puts the previous room back.
- **Sets.** New built-in kinds the model sizes and code assembles: `workstation`, `dining_set`, `bed_set`, `lounge_set`, `wall_shelf`. Their pure layout maths lives in `packages/shared` so it's tested.
- **Surfaces with depth.** Timber slats and fabric panels become geometry (instanced slats, padded grid), on whole walls and on new partial-wall **panels**.
- **Lighting.** Cove strips and drop bands stay on full-height walls in the overview, lit by up to four `RectAreaLight`s; "Day" becomes a light-grey **Studio** look with a ground shadow.
- **Props.** A few CC0 glTF models replace the worst catalogue shapes (plants, office and dining chairs, shelf decor), with the shapes kept as the loading and failure fallback.

**Tech stack:** OpenAI Responses structured output (as plan 17), `three` examples (`RectAreaLightUniformsLib`, `GLTFLoader`, `InstancedMesh`), CC0 models from Poly Haven (Kenney or Quaternius where Poly Haven has nothing), `@gltf-transform/cli` through `npx` at asset prep only.

**Spec:** [../copilot-spec.md](../copilot-spec.md) §7 and this plan's **Why** (owner and outside review, 2026-11-06). Task 18.8 records the revision in §7.

## Global constraints
- **No new image call and no new vendor.** Pass 2 is one text call per presentation render, counted against the daily spend cap like every call.
- **The photo shell wins.** Pass 2 never changes width, length, height, walls, floor, ceiling, openings or nibs.
- **An edited room is never overwritten automatically.**
- **Stored rooms keep opening.** The room stays `version: 2`; every new field has a default in `roomSchema` (`[]` or `null`). No migration script.
- **No new npm dependency.** `@gltf-transform/cli` runs through `npx` when preparing models and is never added to a `package.json`.
- **Models are CC0 only**, in `apps/web/public/models/` with a `LICENSE.md` listing each source. Each file ≤ 600 KB, all of them ≤ 3 MB.
- **At most 4 area lights.** WebGL2 only.
- **"AI concept, not to scale" stays visible** in every view.
- **Photos still go to OpenAI as bytes**, never as URLs.

## Review focus
- **The room was edited before the render finished:** the edits stay and Match render is offered. Tested in Task 18.2.
- **The render's layout doesn't fit the real shell** (something past a wall or in a doorway): it's pulled inside and off the door. Tested in Task 18.1 (`withContents`).
- **A room stored before this plan** (no nibs, panels or built-in colour): opens and edits normally. Tested in Task 18.1.
- **A panel across a door or window:** the opening stays open. Tested in Task 18.1 (panel pieces) and checked by hand in Task 18.4.
- **Unsaved edits when Match render is pressed:** the button is disabled until they're saved or reset. Checked by hand in Task 18.6.
- **A mid-range phone with four coves and the glTF props:** still smooth to rotate. Checked by hand in Task 18.8.

---

### Task 18.1: Room schema: sets, built-in colour, panels, nibs, contents

**Files:**
- Modify: `packages/shared/src/room.ts`, `packages/shared/src/materials.ts`, `packages/shared/src/index.ts`
- Create: `packages/shared/src/roomSets.ts`
- Test: `packages/shared/src/room.test.ts`, `packages/shared/src/roomSets.test.ts`, `packages/shared/src/materials.test.ts`

**Interfaces:**
- Produces:
  - `BUILT_IN_KINDS` gains `"workstation", "dining_set", "bed_set", "lounge_set", "wall_shelf"`.
  - `BUILT_IN_FINISHES.fabric = { label: "Fabric", tile: 0.8, color: "#8f9f7d", rough: 1, texture: "Fabric061" }`; `TINTED_BUILT_INS: readonly BuiltInFinish[] = ["fabric"]`.
  - Built-in field `color: hex.nullable()`. It tints the soft parts (screens, upholstery, bedding) and the `fabric` body; null means the finish's own colour.
  - Shell field `nibs: z.array(z.strictObject({ wall: z.enum(WALLS), at: 0..15, width: 0.2..2, depth: 0.1..1 })).max(4)`: full-height columns or wall returns, `at` measured like openings.
  - Top-level field `panels: z.array(z.strictObject({ wall: z.enum(WALLS), at: 0..15, width: 0.3..15, height: 0.3..4.5, finish: z.enum(WALL_FINISH_KEYS), color: hex })).max(6)`: partial-wall features from the floor up, on the inside of the wall.
  - In `roomDescriptionSchema` all three are required (OpenAI strict). In `roomSchema`: `nibs` and `panels` `.default([])`, built-in `color` `.default(null)`.
  - `fitRoom` clamps panels and nibs to their wall the way it clamps openings (width ≤ wall, `at` inside, panel height ≤ room height).
  - `roomContentsSchema = roomDescriptionSchema.pick({ panels: true, builtIns: true, items: true })`; `type RoomContents`.
  - `withContents(room: Room, contents: RoomContents): Room`: `resolveRoom` of the room's shell fields (nibs included) with the contents.
  - `panelPieces(room: Room, panel: Room["panels"][number])`: `wallPieces(panel.width, panel.height, …)` with the wall's openings moved into the panel's coordinates.
  - `roomSets.ts`:
    - `workstationSeats(length, depth) → { sides: 1 | 2; perSide: number; deskWidth: number }`: 2 sides when depth ≥ 1.2; `perSide = max(1, round(length / 1.4))`; `deskWidth = length / perSide`.
    - `diningChairs(length, depth) → { table: [number, number]; chairs: [x: number, z: number, rotation: number][] }`: table `max(0.8, length − 0.9) × max(0.7, depth − 0.9)`; each long side `max(1, floor(tableLength / 0.6))` chairs spread evenly; one chair per end when the table is ≥ 1.6 long; every chair faces the table.
    - `bedSet(length) → { bed: number; sideTables: boolean }`: side tables when length ≥ 2.4; bed width `min(1.8, length − 1.0)` then, else `min(1.8, length)`.
    - `coveSides(room) → Wall[]`: with a cove, the walls of its drops (`"all"` is all four), or all four when there are no drops; none without a cove.

- [ ] **Step 1: Write the failing tests**

```ts
// room.test.ts
it("opens a v2 room stored before plan 18 with no nibs, panels or built-in colours", ...);
it("clamps panels and nibs to their wall", ...);
it("withContents keeps the shell and resolves the new contents inside it, off the doors", ...);
it("panelPieces leaves a door and a window under a panel open", ...);
// roomSets.test.ts
it("workstationSeats: 2.8 × 1.4 is back-to-back, two 1.4 m desks a side", ...);   // { sides: 2, perSide: 2, deskWidth: 1.4 }
it("workstationSeats: 1.0 × 0.7 is one single desk", ...);                       // { sides: 1, perSide: 1, deskWidth: 1.0 }
it("diningChairs: 2.6 × 1.8 seats 2 a side and one at each end, all facing the table", ...);  // table [1.7, 0.9], 6 chairs
it("bedSet: 2.6 has side tables and a 1.6 bed; 2.0 is a 1.8 bed alone", ...);
it("coveSides: drops on back and left give those two; no drops gives all four; no cove gives none", ...);
// materials.test.ts: the existing texture check covers the new fabric finish
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @veenix/shared test`
Expected: FAIL (`withContents`, `panelPieces`, `roomSets` not defined).

- [ ] **Step 3: Implement** the fields, `fitRoom` changes, `roomContentsSchema`, `withContents`, `panelPieces` and `roomSets.ts`, and export them from `index.ts`. `resolveRoom` lists the shell fields it copies, so add `nibs` and `panels` there.

- [ ] **Step 4: Run the tests and every typecheck**

Run: `pnpm --filter @veenix/shared test; pnpm -r typecheck`
Expected: PASS. Fix any API or web type errors from the new fields (defaults keep them few).

- [ ] **Step 5: Commit** `feat(shared): room sets, built-in colour, wall panels, nibs and room contents`

---

### Task 18.2: Lay out the 3D room from the render

**Files:**
- Modify: `apps/api/src/concepts/concept.model.ts`, `ai.ts`, `concepts.jobs.ts`, `concepts.service.ts`, `concepts.controller.ts`; `packages/shared/src/dto.ts`; `apps/web/actions/concepts.ts`
- Test: `apps/api/src/concepts/concepts.test.ts`, `apps/api/src/concepts/ai.test.ts` (with `./ai` mocked in the first, as now)

**Interfaces:**
- Consumes: `roomContentsSchema`, `withContents`, `upgradeRoom` (Task 18.1).
- Produces:
  - `DesignConceptModel`: `roomEdited: Boolean` (default false), `renderRoom: Mixed` (default null), `roomBefore: Mixed` (default null).
  - `ai.ts`:
    - The room prompt is split so its placing rules are a constant shared by both prompts. It also names the sets ("a run of desks with screens is one `workstation`; a table with chairs is a `dining_set`; a bed with side tables is a `bed_set`; a sofa, rug and coffee table group is a `lounge_set`; floating shelves are a `wall_shelf`; prefer a set to loose pieces"), panels ("a feature on part of a wall, such as slats behind a TV or a bed; never across a door or window") and nibs ("columns and wall returns you can see in the original photos").
    - `dollhouse` prompt gains: "View it from above and behind where the first photo was taken, so the wall that photo faces is the far wall." The render then faces the same way as the 3D room.
    - `describeContents(render: Buffer, restyled: Buffer, room: Room, brief: string, layout: string | null): Promise<unknown>`: `detail: "high"`, render first, then the restyled photo. The text carries the shell as JSON (`width, length, height, openings, nibs`). The prompt says: the first image is a cut-away of this room from above, its far wall is the back wall; the size, doors, windows and nibs are fixed as given; place the built-ins, items and panels the cut-away shows, in metres, inside them. Output `roomContentsSchema`; spend counted as in `describeRoom`.
  - `renderConcept`: after the render is stored, when the concept has a room and no `renderRoom`, describe the contents and store `renderRoom = withContents(room, parsed)`. A failure is logged and the render still becomes ready. When `roomEdited` is false, also set `roomBefore = room` and `room = renderRoom`.
  - Service:
    - `update`: a patch with `room` also sets `roomEdited: true`.
    - `matchRender(id)`: `roomBefore = room`, `room = renderRoom`, `roomEdited = false`. Without a `renderRoom`, refuse: "This concept has no layout from its render yet."
    - `restoreRoom(id)`: `room = roomBefore`, `roomBefore = null`, `roomEdited = true`. Without a `roomBefore`, refuse: "There's no earlier room to go back to."
  - Routes: `POST concepts/:id/match-render` and `POST concepts/:id/restore-room`, both `@Can("concept:generate")`.
  - `ConceptDto` gains `canMatchRender: boolean` (a `renderRoom` exists and differs from `room`) and `canRestoreRoom: boolean` (a `roomBefore` exists).
  - Web actions `matchRender(id)` and `restoreRoom(id)`, the same shape as `renderConcept`.

- [ ] **Step 1: Write the failing tests**

```ts
// concepts.test.ts
it("after the render, lays out an unedited room from it, keeping the walls, doors and windows", ...);
it("keeps an edited room and offers the render's layout instead", ...);        // room unchanged, canMatchRender true
it("Match render swaps in the render's layout and Undo match puts the earlier room back", ...);
it("refuses Match render without a render layout and Undo match without an earlier room", ...);
it("a retried render job doesn't describe the contents again", ...);
it("a failed contents description still finishes the render", ...);            // renderStatus "ready", room unchanged
it("an image-only concept gets no render layout", ...);
// ai.test.ts
it("asks for the far wall of the render to be the wall the photo faces", ...);
it("describes the contents from the render first, with the fixed shell as text", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter api test concepts`
Expected: FAIL.

- [ ] **Step 3: Implement** as above.

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter api test concepts; pnpm --filter api typecheck; pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** `feat(api): lay out the 3D room from the presentation render`

Until Tasks 18.3–18.5 land, the new kinds draw as plain boxes and panels and nibs don't draw. That's fine on this branch.

---

### Task 18.3: Lighting: coves in the overview, area lights, Studio

**Files:**
- Modify: `apps/web/components/concepts/shell.ts`, `RoomCanvas.tsx`, `ConceptViewer.tsx`

**Interfaces:**
- Consumes: `coveSides` (Task 18.1).
- Produces:
  - `WallPart` gains `trim: THREE.Group`: that wall's drop bands, cove strip and `ac_wall` units, in room coordinates. The animation loop shows it whenever the wall is full height (all of them when walking). The main ceiling plane, downlights, cassettes and fans stay in `ceiling` (walk only).
  - `RectAreaLightUniformsLib.init()` is called once, in the setup effect.
  - `buildLights` adds one `RectAreaLight` per `coveSides(room)` wall: wall length − 0.2 wide, 0.05 high, on the cove line (the drop's underside, or 0.03 below the ceiling with no drops), 0.1 m in from the wall, aimed at the wall 1 m below the line. Intensity 3 in Studio and 8 in Evening, as starting values to tune by eye.
  - Studio (still `light: "day"` in code): background `#e6e5e2`; sun 1.2 (was 2.2); hemisphere 1.0; `environmentIntensity` 0.7; a `ShadowMaterial` ground (opacity 0.2) just under the plinth, three times the room's size. Evening: background `#16181b`, otherwise as now. Exposure stays 0.85.
  - The viewer's light chip reads **Studio** and **Evening**.

- [ ] **Step 1: Implement** as above.
- [ ] **Step 2: Typecheck and lint**

Run: `pnpm --filter web typecheck; pnpm --filter web lint`
Expected: PASS.

- [ ] **Step 3: Check by hand** on the seeded concepts (office and kitchen): cove glow along the far walls in the overview; none above the cut near walls; the walls get a soft gradient below the cove; Studio on light grey with a soft ground shadow; Evening as before plus cove light; walking in still shows the full ceiling. Record the final intensities in the code if they changed.
- [ ] **Step 4: Commit** `feat(web): studio lighting, cove light in the overview`

---

### Task 18.4: Slats and fabric with depth, wall panels, nibs

**Files:**
- Create: `apps/web/components/concepts/surfaces.ts`
- Modify: `apps/web/components/concepts/shell.ts`, `builtins.ts`

**Interfaces:**
- Consumes: `panelPieces`, `TINTED_BUILT_INS` (Task 18.1); `material`, `metreBox` from `materials.ts`.
- Produces:
  - `surface(finish: WallFinish, color: string, w: number, h: number): THREE.Group`, with local x from 0 to w, y from 0 to h and its front facing +z:
    - `timber_slats`: one `InstancedMesh` of 0.04 × 0.02 slats with 0.03 gaps in the finish's material, on a `#2b2a28` backing.
    - `fabric_panel`: padded tiles at most 0.6 wide × 1.2 high, 0.02 thick, tinted with `color`, with 6 mm gaps in the colour darkened 30%.
    - Any other finish: one 18 mm board in that finish.
  - Whole walls finished in `timber_slats` or `fabric_panel` draw `surface()` on each solid piece instead of the flat skin. Other finishes are unchanged.
  - Panels: `surface()` on each of `panelPieces`, on the wall's full group, and cut to the wall's height on the low group.
  - Nibs: a box `width × depth × wall height` in the wall's finish with the dark cap on top, in both the full and the low wall.
  - Built-ins with the `fabric` body take `color` as the tint: `material("body:fabric", …, b.color ?? undefined)`.

- [ ] **Step 1: Implement** as above.
- [ ] **Step 2: Typecheck and lint** (as Task 18.3).
- [ ] **Step 3: Check by hand.** Put a slat panel and a fabric wall on the seeded office (edit the DB room or use Task 18.6's editor if it's done): the slats cast shadows into their gaps; a panel over the door leaves the doorway open; a nib shows in both wall heights; at most one draw call per slat panel (check `renderer.info.render.calls` before and after adding one).
- [ ] **Step 4: Commit** `feat(web): slat and fabric surfaces with depth, wall panels, nibs`

---

### Task 18.5: Sets and wall shelves

**Files:**
- Modify: `apps/web/components/concepts/builtins.ts`, `furniture.ts`

**Interfaces:**
- Consumes: `workstationSeats`, `diningChairs`, `bedSet` (Task 18.1); `buildItem`.
- Produces:
  - `furniture.ts` exports `buildSized(type: FurnitureType, size: { w: number; d: number; h: number }, color: string): THREE.Group`, which `buildItem` now calls with the catalogue size.
  - `buildBuiltIn` draws the new kinds. The footprint is `length × depth`, the front faces +z, the soft colour is `b.color ?? "#8f9f7d"`, the desktop is `b.top` (oak when null) and the frame is `b.body`:
    - `workstation`: desks from `workstationSeats`, desktops 25 mm thick at 0.73 m; a 30 mm frame panel at every desk edge, the full depth of its side; a pedestal (0.4 × 0.6 × 0.5) under each desk's right end; a spine screen from the desktop to `h` (at least 1.0) along the middle (2 sides) or the back edge (1 side), 30 mm, in the soft colour; cross screens between seats, the same height; an office chair per seat, 0.25 m out from the desk front, facing it.
    - `dining_set`: the table and chairs from `diningChairs`, with the chairs in the soft colour.
    - `bed_set`: `bedSet(length)`; a bed `bed × depth` with headboard height `h` and bedding in the soft colour; bedside tables in the body finish's colour on each side when there's room.
    - `lounge_set`: a sofa `min(length, 2.6) × 0.9` along the back edge in the soft colour; a rug `length × (depth − 0.3)` under it all; a 1.1 × 0.6 coffee table 0.45 m in front of the sofa.
    - `wall_shelf`: mounted with its bottom board at 1.1 m; `max(1, round(h / 0.35))` boards 30 mm thick and `depth` deep in the body finish; a glow strip under each board's front edge (the cove glow colour); decor on each board in turn: books, a trailing plant, a frame with a small vase (procedural now, glTF from Task 18.7).

- [ ] **Step 1: Implement** as above.
- [ ] **Step 2: Typecheck and lint** (as Task 18.3).
- [ ] **Step 3: Check by hand.** Add one of each kind to a seeded room at a small and a large size, for example a workstation at 1.2 × 0.7 and 4.2 × 1.4, and a dining set at 1.6 × 1.6 and 3.0 × 1.9. Nothing pokes out of its footprint's selection box, chairs face their desk or table, a rotated set rotates as one, and dragging moves the whole set.
- [ ] **Step 4: Commit** `feat(web): workstation, dining, bed, lounge sets and wall shelves`

---

### Task 18.6: The editor and Match render

**Files:**
- Modify: `apps/web/components/concepts/RoomEditor.tsx`, `ConceptViewer.tsx`

**Interfaces:**
- Consumes: Task 18.1 kinds and fields; Task 18.2 actions and DTO flags.
- Produces:
  - `BUILT_IN_LABELS` and `NEW_BUILT_IN` for the new kinds (length, depth, height, body, top):

    | Kind | length | depth | height | body | top |
    |---|---|---|---|---|---|
    | workstation | 2.8 | 1.4 | 1.2 | white_laminate | oak |
    | dining_set | 2.4 | 1.8 | 0.75 | oak_veneer | oak |
    | bed_set | 2.6 | 2.1 | 1.1 | oak_veneer | null |
    | lounge_set | 2.8 | 2.4 | 0.85 | oak_veneer | null |
    | wall_shelf | 1.2 | 0.25 | 0.7 | oak_veneer | null |

    New built-ins start with `color: null`.
  - A selected set, partition or `fabric`-bodied built-in shows colour swatches (`WALL_COLOURS`) for `color`.
  - The wall section lists the panels on the shown wall, each with finish chips, a width input, colour swatches and Remove. **Add panel** adds a 1.2 m, full-height timber slat panel in the middle of that wall; it's disabled at 6.
  - The 3D chip row shows **Match render** when `canMatchRender` and **Undo match** when `canRestoreRoom`. Each calls its action, shows any error the way Save does, and refreshes. Both are disabled while there are unsaved edits, with the title "Save or reset your changes first".

- [ ] **Step 1: Implement** as above.
- [ ] **Step 2: Typecheck and lint** (as Task 18.3).
- [ ] **Step 3: Check by hand:** add, recolour, resize and remove each set and a panel, then save and reload; Match render on an edited concept, then Undo match; both buttons disabled with unsaved edits; a viewer without `concept:generate` sees neither.
- [ ] **Step 4: Commit** `feat(web): edit sets, colours and wall panels; match the render`

---

### Task 18.7: glTF props

**Files:**
- Create: `apps/web/components/concepts/props.ts`, `apps/web/public/models/*.glb`, `apps/web/public/models/LICENSE.md`
- Modify: `apps/web/components/concepts/furniture.ts`, `builtins.ts`, `RoomCanvas.tsx` (`dispose`)

**Interfaces:**
- Produces:
  - `type PropName = "plant" | "plant_small" | "office_chair" | "dining_chair" | "books" | "frame"`.
  - `PROPS: Record<PropName, { file: string; facing: number; tint: string | null }>`: `facing` is the degrees that turn the model's front to +z; `tint` is the material name the item's colour replaces (the pot on plants, the seat on chairs), or null.
  - `withProp(group: THREE.Group, name: PropName, size: { w: number; d: number; h: number }, color: string): void`. It loads each file once (`GLTFLoader`, cached promise), scales it uniformly to `size.h`, centres the footprint on the origin with its base at y = 0, and turns it by `facing`. It then clones it into `group`, tints the `tint` material (a cloned material per colour, cached), and disposes the procedural children it replaces. A failed load keeps the procedural shape. Cloned geometries and materials are marked `userData.shared`, and `dispose` in `RoomCanvas` skips shared geometry as it already skips shared materials.
  - `buildSized` calls `withProp` for `plant`, `office_chair` and `dining_chair`. Planter boxes use `plant`; wall shelf decor uses `plant_small`, `books` and `frame`.

- [ ] **Step 1: Source candidates.** Two or three CC0 candidates per prop from Poly Haven, then Kenney or Quaternius where Poly Haven has none. Make a contact sheet and **the owner picks** one per prop.
- [ ] **Step 2: Prepare the files.** `npx @gltf-transform/cli optimize <in> apps/web/public/models/<name>.glb --texture-compress webp --texture-size 512`. Check each is ≤ 600 KB and all are ≤ 3 MB, and write `LICENSE.md` with each source URL and its CC0 licence.
- [ ] **Step 3: Implement** `props.ts` and the calls above.
- [ ] **Step 4: Typecheck and lint** (as Task 18.3).
- [ ] **Step 5: Check by hand:** the props face the right way at catalogue size; recolouring a chair changes its seat; blocking `/models/` in devtools keeps the procedural shapes with no console errors; reopening the concept ten times shows no growth in `renderer.info.memory.geometries`.
- [ ] **Step 6: Commit** `feat(web): CC0 glTF plants, chairs and shelf decor`

---

### Task 18.8: Owner check on real photos (needs `OPENAI_API_KEY`)

This replaces Task 17.7 (which replaced 16.5). Tick 16.5 and 17.7 when it's done.

- [ ] **Step 1: Run it.** Send 5–10 real photos of different room types: kitchen, bedroom, living room, office, a shop or clinic. For each, note:
  - the time to ready and the cost from today's spend
  - whether the restyle kept the camera
  - for at least four, a presentation render: its time, its cost, the far wall is the photo's wall, and the 3D room laid out from it matches it (sets, panels, built-ins)
  - one concept edited before its render: the edits stay; Match render and Undo match work
- [ ] **Step 2: The owner judges** on a laptop and a mid-range phone: would a contractor show this 3D room to a client next to the render? Rotation stays smooth with coves and props. Also check that an old concept opens, that WebGL off falls back to the photo, that blocked textures and models fall back, and the WhatsApp button.
- [ ] **Step 3: Record the outcome** in [../copilot-spec.md](../copilot-spec.md) §7: the two passes, sets, panels, nibs, lighting, props, and the times, costs and quality.

Task 17.8 (the furniture library coverage test) still gates the open-vocabulary furniture library, which becomes plan 19.
