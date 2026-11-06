# 17: Copilot room concepts, realistic 3D

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** the 3D room looks like a clean architectural dollhouse instead of a toy, follows the restyled photo, and works for any room type (homes, kitchens, shops, clinics, offices). It still rotates and walks in, all in the browser. A **Presentation render** button gives a photoreal still dollhouse image when the designer wants one.

**Why (owner, 2026-11-06):** on real photos the 3D room came out as boxes and blobs, didn't match the restyled photo, and had no way to show finishes (fabric panels, slats, tiles) or ceilings (cove lighting, lowered sections, AC units). A ChatGPT-style dollhouse is the look wanted, but it must stay interactive.

**Architecture:**
- **Inputs (Phase 0).** The brief is split in two. The **style** goes to the image edit, since positions in it make the edit move the camera. The **layout** goes to the room description. The room is described from the **restyled** photo plus every photo sent, at high detail, so the 3D follows the "after" picture.
- **Room v2 (Phase 1).** The room is described as a **shell** (walls, floor, ceiling, openings, a finish per wall, ceiling features), **built-ins** (cabinet runs, counters, islands, shelving, partitions, planter boxes, drawn as boxes with material keys), and **items** (loose furniture, each with a free-text description and a catalogue type as fallback). Items are placed **relative to a wall**; the server resolves positions and fits them.
- **Renderer (Phase 1).** Thick walls with dark cut tops, a cut-away view that lowers the walls facing the camera, CC0 realistic materials loaded per material key, procedural ceiling features and built-ins, and a quality tier for ambient occlusion.
- **Presentation render.** One more image call on demand, using the restyled and original photos. Stored once per concept.
- **Phase 2 (open-vocabulary furniture) starts with a coverage test** (Task 17.8) and gets its own plan only if the test passes.

**Tech stack:** OpenAI (`openai`: `images.edit`, Responses structured output), `three` (already installed: `ExtrudeGeometry`, clipping planes, `TextureLoader`, `GTAOPass`), CC0 textures from ambientCG / Poly Haven in `apps/web/public/materials/`.

**Spec:** [../copilot-spec.md](../copilot-spec.md) §7 (Task 17.7 records the revision).

## Global constraints
- **No new vendor and no new per-concept cost in Phases 0–1.** The room description call grows by a few thousand input tokens (under 1 sen). Rendering costs nothing.
- **The presentation render is on demand only**, made at most once per concept, and counted against the daily spend cap.
- **Images count toward the daily spend cap from Task 17.2 on.** Before this plan they weren't counted at all.
- **Photos still go to OpenAI as bytes**, never as URLs. Results stay under `orgs/<org>/concepts/`.
- **"AI concept, not to scale" stays visible** in every view, the presentation render included.
- **Room v1 concepts keep working:** `upgradeRoom` turns a stored v1 room into v2 when it's read. No migration script.
- **Textures are CC0 only** (ambientCG, Poly Haven), checked in under `public/materials/` with a `LICENSE.md` listing the source of each.
- **WebGL2 only.** No WebGPU: older iPhones don't support it.

## Review focus
- **A style brief with positions in it** ("desks against the left wall"): the image edit still keeps the camera, because positions go to `layout`. Checked by hand in Task 17.1.
- **No photo in this message, but one in an earlier message:** the concept uses the earlier photo instead of asking for it again. Tested in Task 17.1.
- **A retried job after the paid image calls:** no second restyle and no second presentation render. Tested in Tasks 17.1 and 17.3.
- **Over the daily spend cap:** a new concept or presentation render is refused before any paid call. Tested in Task 17.2.
- **A model room with a built-in through a door, or an item placed off its wall:** `resolveRoom` keeps it inside and off openings. Tested in Task 17.4.
- **An old v1 room:** opens and edits normally. Tested in Task 17.4.
- **An older phone:** no ambient occlusion and still smooth to rotate. Checked by hand in Task 17.5.

---

## Phase 0: inputs

### Task 17.1: Split the brief, use every photo, describe the restyled photo

**Files:**
- Modify:
  - `apps/api/src/assistant/tools.concepts.ts`: input and photo lookup
  - `apps/api/src/concepts/concept.model.ts`: `style`, `layout`, `extraKeys`
  - `apps/api/src/concepts/concepts.service.ts` (`startConcept`), `concepts.jobs.ts`, `ai.ts`
  - `packages/shared/src/dto.ts` (`ConceptDto`)
- Test: `apps/api/src/concepts/concepts.test.ts`, with `./ai` mocked

**Interfaces:**
- Consumes: `ToolContext.attachments`, `AssistantMessageModel`, `getObject`.
- Produces:
  - Tool `generate_room_concept` input: `{ projectId, leadId, style: string (1–1000), layout: string (0–1000) | null, photoIndexes: int[] | null, fromConceptId }`. `photoIndexes` null means every photo, at most 3.
    - The tool description tells the model what goes where: *style* is finishes, materials, colours, plants and lighting; *layout* is sizes, which wall the door is on, and where things go.
    - Photo lookup: this message's photos; if none, the photos of the latest earlier user message in the conversation that has any. Never a URL. "Attach a room photo first." only when neither has one.
  - `DesignConceptModel`: `style` (replaces `brief`; old documents read `brief` as `style`), `layout: string | null`, `extraKeys: string[]` (photos after the first). `sourceKey` stays the first photo and the "before" image.
  - `ai.ts`:
    - `restyle(photo, ext, style)`: same prompt as before, with the style only.
    - `describeRoom(restyled: Buffer, originals: { photo: Buffer; ext: string }[], style, layout)`: `detail: "high"`, the restyled image first, then the originals. The prompt says the restyled photo decides finishes and furniture, and the originals show the walls it can't see.
  - "Try another style" (`fromConceptId`) reuses `sourceKey`, `extraKeys` and `layout`.

- [ ] **Step 1: Write the failing tests**

```ts
it("sends only the style to the image edit and the layout to the room description", ...);
it("uses a photo from an earlier message when this one has none", ...);
it("uses up to three photos, the first as the before image", ...);
it("describes the room from the restyled photo, then the originals", ...);
it("another style keeps the earlier concept's photos and layout", ...);
it("an old concept with only brief still reads as its style", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test concepts; pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 3: Check by hand** (needs `OPENAI_API_KEY`). Send the office photos with *"biophilic office; desks against the left wall, door on the back wall"*. The restyle keeps the original camera, and the 3D room has the desks on the left.

- [ ] **Step 4: Commit**: `feat(api): split room concept style and layout, use every photo`

### Task 17.2: Count image costs against the daily cap

**Files:**
- Modify: `apps/api/src/assistant/limits.ts`, `apps/api/src/concepts/ai.ts`, `apps/api/src/assistant/tools.concepts.ts`
- Test: `apps/api/src/assistant/limits.test.ts` (create if missing), `apps/api/src/concepts/concepts.test.ts`

**Interfaces:**
- Produces:
  - `imageCostMicros(usage: { input_tokens_details: { text_tokens, image_tokens }, output_tokens }): number`, priced for `gpt-image-2` in a `ponytail:` comment like `costMicros`. ⚠ Verify the `images.edit` response's `usage` shape and `gpt-image-2`'s prices before writing the constants.
  - `restyle` and `dollhouse` (Task 17.3) call `addSpend` with it.
  - `generate_room_concept` and `POST /v1/concepts/:id/render` refuse with "Today's AI budget for this organisation is used up. Try again tomorrow." when `overSpendCap`, before anything is enqueued.

- [ ] **Step 1: Write the failing tests**

```ts
it("prices image input, text input and output tokens", ...);
it("a restyle adds its cost to today's spend", ...);
it("refuses a new concept over the daily cap without a paid call", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test limits concepts`
Expected: PASS.

- [ ] **Step 3: Commit**: `feat(api): count image costs against the daily AI cap`

### Task 17.3: Presentation render (on demand)

**Files:**
- Modify:
  - `apps/api/src/concepts/ai.ts`, `concepts.jobs.ts`, `concepts.controller.ts`, `concepts.service.ts`, `concept.model.ts`
  - `apps/api/src/jobs/jobs.ts` (`JobType`)
  - `packages/shared/src/dto.ts`
  - `apps/web/components/concepts/ConceptViewer.tsx`, `apps/web/actions/concepts.ts`
- Test: `apps/api/src/concepts/concepts.test.ts`

**Interfaces:**
- Produces:
  - `dollhouse(restyled: Buffer, originals: { photo: Buffer; ext: string }[], style: string): Promise<Buffer>`: `images.edit` with every image, `quality: "high"`, `background: "transparent"`, `output_format: "webp"`. ⚠ Verify `gpt-image-2` supports a transparent background; if not, use a plain light grey background. Prompt: *"Turn this room into a 3D dollhouse cut-away view from a high three-quarter angle with the ceiling removed. The first image is the redesigned room: keep its finishes, colours, furniture and lighting. The other images show the same room before; use them for walls the first image doesn't show. Keep every wall, door, window and piece of furniture where the photos show them. Thick walls with clean dark cut tops, realistic textures, soft daylight, architectural visualisation quality. Do not change the layout."*
  - Concept fields: `renderKey: string | null`, `renderStatus: "none" | "generating" | "ready" | "failed"`.
  - `POST /v1/concepts/:id/render` (`concept:generate`): only for a `ready` concept; does nothing when the status is already `generating` or `ready`. Enqueues `concept.render`.
  - Job `concept.render`: same lock and retry settings as `concept.generate`; skips the image call when `renderKey` is stored. `onGiveUp` sets `renderStatus: "failed"`.
  - `ConceptDto.renderUrl: string | null`, `renderStatus`.
  - Viewer: a **Render** tab next to Photo / 3D. With no render, it shows a **Make presentation render** button with "Takes about a minute" under it. While generating, it refreshes like the main concept. The label stays visible.

- [ ] **Step 1: Write the failing tests**

```ts
it("starts a render only for a ready concept, and only once", ...);
it("a retried render job doesn't pay for the image twice", ...);
it("a failed render leaves the concept ready and the render failed", ...);
it("refuses a render over the daily cap", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test concepts; pnpm --filter api typecheck; pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Check by hand** (needs `OPENAI_API_KEY`). Make a render for the kitchen concept. Compare it with the ChatGPT result, and note the time and the cost from today's spend.

- [ ] **Step 4: Commit**: `feat: on-demand presentation render for room concepts`

---

## Phase 1: realistic 3D

### Task 17.4: Room v2: shell, built-ins, items placed by wall

**Files:**
- Modify: `packages/shared/src/room.ts`, `packages/shared/src/room.test.ts`, `apps/api/src/concepts/ai.ts` (`ROOM_PROMPT`, schema), `concepts.jobs.ts`, `concepts.service.ts` (read path uses `upgradeRoom`)
- Create: `packages/shared/src/materials.ts` (exported from `index.ts`)

**Interfaces:**
- Produces:
  - `materials.ts`: `WALL_FINISHES` (e.g. `paint, timber_slats, oak_veneer, walnut_veneer, fabric_panel, subway_tile, large_tile, terrazzo, marble, concrete, brick, linen_wallpaper, stone, mirror`), `FLOOR_FINISHES` (e.g. `light_oak, oak_herringbone, walnut, white_tile, grey_tile, terrazzo, marble, concrete, carpet, vinyl_plank`), `BUILT_IN_FINISHES` (e.g. `white_laminate, oak_veneer, walnut_veneer, fluted_oak, matte_grey, black_metal, glass, rattan`) and `TOP_FINISHES` (`quartz_white, marble, terrazzo, oak, concrete, stainless`). Each key has `{ label, tile: metres }`. The final lists are the implementer's call, limited to textures that exist in Task 17.5.
  - `roomDescriptionSchema`: what the model returns (strict; every field required, `null` where unused):
    - `width`, `length`, `height`, `openings` (as v1)
    - `floor: FloorFinish`
    - `walls: { back, left, right, front }`, each `{ finish: WallFinish, color: hex }`. `color` tints `paint`, `fabric_panel` and `linen_wallpaper`, and is ignored otherwise.
    - `ceiling: { color, drops: { wall: Wall | "all", depth, gap }[] (≤4), cove: boolean, downlights: int 0–12, units: { kind: "ac_cassette" | "ac_wall" | "ceiling_fan", wall: Wall | null, along: number }[] (≤4) }`
    - `builtIns` (≤12): `{ kind: "base_run" | "tall_run" | "wall_run" | "island" | "bar" | "shelving" | "banquette" | "partition" | "planter_box" | "counter", wall: Wall | null, along, out, length, depth, height, body: BuiltInFinish, top: TopFinish | null }`
    - `items` (≤40): `{ description: string (≤80), type: FurnitureType, wall: Wall | null, along, out, rotation, color }`
    - Placement: with a `wall`, `along` is metres from the wall's left end seen from inside, and `out` is the distance from the wall. Rotation is relative to facing into the room. Without a wall, `along` and `out` are x and z from the room's centre.
  - `Room` v2 (stored and edited): the same shell, with `version: 2`, and built-ins and items resolved to `{ x, z, rotation }` plus their original fields.
  - `resolveRoom(d: RoomDescription): Room`: wall placements become x/z, footprints are pulled inside the walls, built-ins and items are nudged off door openings, and openings are clamped as `fitRoom` does now. `fitRoom` stays for editor edits on v2.
  - `upgradeRoom(r: unknown): Room | null`: v1 becomes v2 (all walls `paint` in `wallColor`; `light_oak` becomes `light_oak` and so on; items get `description` = their label; no built-ins or ceiling features). v2 passes through, and anything else is null.
  - `ROOM_PROMPT` asks for built-ins for anything fixed (cabinet runs, counters, shelving, partitions, planters), items only for loose furniture, and a finish per wall from the lists.

- [ ] **Step 1: Write the failing tests**

```ts
it("resolveRoom places a wall item against its wall, facing into the room", ...);
it("resolveRoom keeps built-ins and items out of door openings", ...);
it("resolveRoom pulls everything inside the walls, rotation included", ...);
it("upgradeRoom turns a v1 room into v2 and passes v2 through", ...);
it("the description schema is strict-compatible (every field required)", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter @veenix/shared test room; pnpm --filter api test concepts; pnpm --filter api typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**: `feat(shared): room v2 with finishes, built-ins and wall placement`

### Task 17.5: The renderer

**Files:**
- Create:
  - `apps/web/public/materials/<key>/{color,normal,roughness}.jpg` (1K, CC0) and `apps/web/public/materials/LICENSE.md`
  - `apps/web/components/concepts/materials.ts`, `apps/web/components/concepts/builtins.ts`
- Modify: `apps/web/components/concepts/RoomCanvas.tsx`, `furniture.ts` (pendant height from the ceiling drop)

**Interfaces:**
- Consumes: `Room` v2, `WALL_FINISHES`, `FLOOR_FINISHES`, `BUILT_IN_FINISHES`, `TOP_FINISHES`.
- Produces:
  - `materials.ts`: `material(key, color?, repeat?): THREE.MeshStandardMaterial`, cached by key. It loads the three maps on first use and repeats them by `tile` metres, with `paint` as colour only. A missing texture falls back to colour only, never an error.
  - `builtins.ts`: `buildBuiltIn(b): THREE.Group` makes the body with a toe kick and door or drawer split lines for runs and islands, plus the top. `shelving` is open boxes, `partition` is a low panel (glass above when `body` is `glass`), and `planter_box` is a box filled with `plant` items.
  - `RoomCanvas` changes:
    - **Thick walls:** 0.12 m `ExtrudeGeometry` with the openings cut through, door and window reveals, skirting, and a dark (`#2a2a2a`) cap on top.
    - **Cut-away:** in overview, the walls whose inside faces away from the camera are lowered to 0.9 m as the user rotates, and the ceiling is hidden. Walk-in shows every wall at full height and the ceiling.
    - **Ceiling:** drops as lowered bands with an emissive cove strip when `cove`; downlights as emissive discs, which in Evening also light the room (at most 4 lights, 1 with shadows); AC units and fans as simple procedural shapes.
    - **Look:** keep `RoomEnvironment`, soft shadows and ACES. Add `GTAOPass` ambient occlusion only on the high tier: `devicePixelRatio ≤ 2` and `hardwareConcurrency ≥ 8`, or a desktop pointer. `// ponytail: device heuristic; add a quality toggle if it guesses wrong`.
  - Every material key in `@veenix/shared` has a texture folder or is colour only. A test lists the keys against the folders.

- [ ] **Step 1: Build.** Fetch the textures (⚠ verify each is CC0 on its page; record the URL in `LICENSE.md`), resize them to 1K, then build the renderer.

- [ ] **Step 2: Check it.**

Run: `pnpm --filter web typecheck; pnpm --filter web build`
Expected: both succeed, and `three` and the materials load only on the concept page.

In the running app, with the office and kitchen concepts regenerated after Task 17.4:
- Overview shows a dollhouse: thick dark-topped walls, near walls lowered and changing as you rotate, no ceiling.
- Walk-in shows the ceiling: drops, cove lighting, downlights and the AC unit.
- The kitchen's runs, island and tops show their finishes. The office's fabric panels and planter boxes show.
- A v1 concept (the seeded demo) still opens.
- In Chrome device mode (a mid-range phone), rotation stays smooth and ambient occlusion is off. WebGL disabled still falls back to the photo.

- [ ] **Step 3: Commit**: `feat(web): realistic room renderer with finishes, ceilings and built-ins`

### Task 17.6: The editor for v2

**Files:**
- Modify: `apps/web/components/concepts/RoomEditor.tsx`, `RoomCanvas.tsx` (selecting built-ins), `apps/api/src/concepts/concepts.service.ts` (PATCH validates v2)

**Interfaces:**
- Produces:
  - `RoomEditor`:
    - Walls: pick a wall, then a finish and colour.
    - Floor: finish buttons.
    - Ceiling: cove on/off, number of downlights.
    - A selected built-in: finish, top, length, delete.
    - A selected item: unchanged (rotate, colour, delete). **Add** offers the catalogue and built-ins.
    - Every change goes through `fitRoom`.
  - `PATCH /v1/concepts/:id` accepts only a v2 `Room`, so a v1 room saves as v2 after `upgradeRoom`.

- [ ] **Step 1: Build.**

- [ ] **Step 2: Check it.** Change a wall to timber slats, add an island, delete a downlight, save, reload: the edits are still there. A junk PATCH (an unknown finish, 100 built-ins) is refused.

Run: `pnpm --filter api test concepts; pnpm --filter web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**: `feat(web): edit finishes, ceilings and built-ins`

### Task 17.7: Owner check on real photos (needs `OPENAI_API_KEY`)

This replaces Task 16.5. Tick 16.5 when this is done.

- [ ] **Step 1: Run it.** Send 5–10 real photos of different room types: kitchen, bedroom, living room, office, a shop or clinic. Note, for each:
  - the time to ready, and the cost from today's spend (Task 17.2)
  - whether the restyle kept the camera
  - whether the 3D room follows the restyled photo (finishes, built-ins, layout)
  - the presentation render for two of them: time, cost, and whether it looks like the ChatGPT reference
- [ ] **Step 2: The owner judges** on a laptop and a phone: would a contractor show this to a client? Try the WhatsApp button too.
- [ ] **Step 3: Record the outcome** in [../copilot-spec.md](../copilot-spec.md) §7: the revision (split brief, room v2, renderer, presentation render), times, costs and quality.

---

## Phase 2: any furniture (gated)

### Task 17.8: Furniture library coverage test

No code is merged in this task. It decides whether Phase 2 is worth a plan.

- [ ] **Step 1: Collect** the item `description`s from the Task 17.7 concepts, 20 at least, across room types.
- [ ] **Step 2: Search** the CC0 candidates (Kenney, Quaternius, Poly Haven, and any other CC0 furniture set found) for each description by hand. Score each: **good** (a client wouldn't notice), **close** (right kind, wrong style) or **none**.
- [ ] **Step 3: Decide**, and record it in [../copilot-spec.md](../copilot-spec.md) §7:
  - **Mostly good:** write plan 18. Offline import that normalises scale, facing and polygon count, files in our bucket, `text-embedding-3-small` vectors searched in memory, and the catalogue shape as the fallback.
  - **Mostly close or none:** price a licensed furniture pack (it must allow showing models in our web app), or move per-object 3D generation (a new vendor) forward. The owner decides.
  - **Not worth it:** stop at Phase 1. The catalogue shapes plus finishes and built-ins are the product.
