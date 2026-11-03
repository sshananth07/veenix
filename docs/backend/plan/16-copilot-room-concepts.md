# 16: Copilot room concepts

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** a contractor attaches a room photo and a design brief in chat. A preview card appears in the chat's side rail, and **View** opens the concept full screen: the restyled photo with a before/after slider, and a 3D room the client can rotate, walk into and re-finish on the spot. On WhatsApp, the same request returns the preview image and a link to the full-screen view.

**Architecture:**
- `generate_room_concept` saves a concept and a job, and returns right away. One job makes two OpenAI calls: an image edit (the restyled photo) and a structured room description (the 3D). Each step is skipped on retry once its result is stored.
- The 3D room is drawn in the browser with Three.js from the room description. Furniture is built from simple shapes in code, so there are no model files and no vendor.
- The chat shows a card; `/concepts/:id` is the full-screen viewer and editor.

**Tech stack:** OpenAI (`openai` already installed: `images.edit` and Responses structured output), `three` (new, web only), `next/dynamic`.

**Spec:** [../copilot-spec.md](../copilot-spec.md) §7 (revised 2026-11-03), §8, §10.

## Global constraints
- **Revised 2026-11-03 by the owner:** no paid 3D vendor (World Labs was about RM6 per render). The paid spike is dropped; the owner checks the built feature on real photos in Task 16.5.
- **"AI concept, not to scale" is always visible**, in the chat card, full screen, and WhatsApp's message text.
- **Concepts are never attached to quotations or other client documents.**
- **Quota:** 20 concepts per organisation in any 24 hours. Failures don't count.
- **The photo goes to OpenAI as bytes**, never as a URL. Results are stored in our bucket under `orgs/<org>/concepts/`.
- **The link grants nothing.** `/concepts/:id` needs normal login, MFA and permission, and returns to the concept after login.
- **OpenAI code is plain functions in one file** (`concepts/ai.ts`). No provider interface.
- **`apps/web` is on React 19 and Next 16** (the old plan said React 18). Three.js is used directly, without React Three Fiber.

## Review focus
- **WebGL missing, or the context lost during a client presentation:** the restyled photo shows, never a blank box. Checked by hand in Task 16.4 by forcing the failure.
- **The model places furniture through a wall or outside the room:** `fitRoom` pulls it inside. Tested in Task 16.1.
- **A job retried after the paid image call:** no second image. Tested in Task 16.1.
- **A concept on a lead, viewed by site staff or finance:** not found. Tested in Task 16.1.
- **A saved room edit with junk (hundreds of items, a colour that isn't hex):** refused. Tested in Task 16.1.

---

### Task 16.1: Concepts and generation jobs

**Files:**
- Create:
  - `packages/shared/src/room.ts` (exported from `index.ts`), `packages/shared/src/room.test.ts`
  - `apps/api/src/concepts/concept.model.ts`, `ai.ts`, `concepts.service.ts`, `concepts.jobs.ts`, `concepts.controller.ts`
  - `apps/api/src/assistant/tools.concepts.ts`
- Modify:
  - `apps/api/src/jobs/jobs.ts` (`JobType`), `apps/api/src/app.module.ts`
  - `apps/api/src/storage/storage.ts`: `newKey` purpose `"concepts"`; `downloadUrl(key, filename, inline = true, expiresIn = 300)`
  - `apps/api/src/leads/leads.service.ts`: `convert` moves a lead's concepts to the new project, in its transaction
  - `apps/api/src/assistant/assistant.controller.ts` (`getConversation` fills `concepts`), `packages/shared/src/dto.ts`
- Test: `apps/api/src/concepts/concepts.test.ts`, with `./ai` mocked

**Interfaces:**
- Consumes: `defineTool`, `ToolContext.attachments`, `enqueue`, `registerJob`, `runAsMember`, `putObject`, `getObject`, `changed`, `addConversationNote`, `createMessage`, `strictSchema`.
- Produces:
  - `room.ts`:
    - `FURNITURE`: `Record<FurnitureType, { label: string; w: number; d: number; h: number }>` in metres, for `sofa, armchair, coffee_table, side_table, dining_table, dining_chair, bed, bedside_table, wardrobe, tv_console, tv, bookshelf, desk, office_chair, rug, floor_lamp, pendant_light, plant, kitchen_counter, kitchen_island, bar_stool, vanity`.
    - `FLOORS = ["light_oak", "walnut", "white_tile", "grey_tile", "marble", "concrete", "carpet"]`.
    - `roomSchema` (`z.strictObject`, every field required): `width` and `length` 2–15, `height` 2.4–4.5, `wallColor` hex `#rrggbb`, `floor`, `openings` (at most 8) of `{ wall: "back" | "left" | "right" | "front", kind: "window" | "door", at, width, height, sill }`, and `items` (at most 40) of `{ type, x, z, rotation, color }`. `Room = z.infer<typeof roomSchema>`.
    - Coordinates: the room is centred on the origin, with x across the width and z along the length. `back` is the wall the photo faces (z = −length/2), `front` is the camera's side. `at` is the opening's centre, in metres from the wall's left end as seen from inside the room. `rotation` is in degrees.
    - `fitRoom(room: Room): Room`: moves each item so its rotated footprint sits inside the walls, and clamps each opening to its wall's length and the room's height.
  - `ConceptDto`: `{ id, name, brief, status: "generating" | "ready" | "failed", error: string | null, projectId: Id | null, leadId: Id | null, photoUrl: string, imageUrl: string | null, room: Room | null, saved: boolean, createdAt }`. `AssistantMessageDto.concepts: ConceptDto[]`. `conceptPatchInput`: `{ name?: string (1–80), saved?: boolean, room?: Room }`.
  - `DesignConceptModel` (collection `design_concepts`), `tenantPlugin` with `projectField: "projectId"`: `projectId`, `leadId` (exactly one), `sourceKey`, `brief`, `name` (the brief, cut to 60 characters), `status`, `imageKey`, `room`, `error`, `conversationId`, `createdBy`, `saved`.
  - `ai.ts`:
    - `restyle(photo: Buffer, ext: string, brief: string): Promise<Buffer>` uses `images.edit` with model `gpt-image-2` (a constant with a `ponytail:` note, as in `stt.ts`), `quality: "medium"`, `size: "auto"`, `output_format: "jpeg"`, a 180-second timeout, and the prompt: *"Redesign this room as: {brief}. Keep the camera angle, walls, windows, doors, ceiling and proportions exactly. Change only furniture, finishes, colours and lighting. Photorealistic interior photograph."*
    - `describeRoom(photo: Buffer, ext: string, brief: string): Promise<unknown>` uses `createMessage` with `text.format` set to the strict JSON schema of `roomSchema`, and records its spend with `addSpend`.
  - Job `concept.generate`, payload `{ conceptId, userId }`, run with `runAsMember`. Settings: `lockMs: 300_000`, retries after 30 s and then 2 minutes, `maxAttempts: 3`. `onGiveUp` marks the concept `failed`. Steps:
    1. If the image isn't stored, restyle and store it.
    2. If the room isn't stored, try `fitRoom(roomSchema.parse(await describeRoom(...)))`. A failure here is logged, the room stays null, and the step is not retried.
    3. Mark the concept `ready`.
    4. On `ready` and on `failed`, call `conceptFinished(concept)`: `changed({ kind: "assistant", userId })` and `addConversationNote`. Task 16.2 adds WhatsApp delivery here.
  - Tool `generate_room_concept`: permission `concept:generate`, level `background`, input `{ projectId: id | null, leadId: id | null, brief: string (1–2000), photoIndex: int | null, fromConceptId: id | null }`.
    - The photo comes from `ToolContext.attachments[photoIndex ?? 0]`, or from `fromConceptId`'s `sourceKey` for "try another style". It never comes from a URL.
    - Refusals: no photo gives "Attach a room photo first."; neither or both of project and lead gives "Say which project or lead this is for."
    - Result: `Started concept <id> ("<name>"). It will appear in this conversation in about a minute.`, with display `{ type: "concept", conceptId }`.
  - `ConceptsService`: `.list({ projectId } | { leadId })` (saved only), `.get(id)`, `.update(id, patch)`. A lead's concept needs `lead:read`; without it the concept is not found.
  - Routes:
    - `GET /v1/concepts/:id` (`project:read`)
    - `PATCH /v1/concepts/:id` (`concept:generate`)
    - `GET /v1/projects/:id/concepts` (`project:read`)
    - `GET /v1/leads/:id/concepts` (`lead:read`)

- [x] **Step 1: Write the failing tests**

```ts
// room.test.ts
it("fitRoom keeps every item inside the walls, rotation included", ...);
it("fitRoom clamps openings to their wall and the ceiling", ...);
// concepts.test.ts
it("saves the concept and job together and returns before any OpenAI call", ...);
it("refuses without an attached photo, and without exactly one of project or lead", ...);
it("another style reuses the earlier concept's photo", ...);
it("refuses over 20 in 24 hours, and a failure doesn't count", ...);
it("a retried tool call doesn't start a second concept", ...);
it("a retried job doesn't pay for the image twice once it's stored", ...);
it("stores the image in our bucket and the room after fitRoom", ...);
it("a failed room description leaves a ready, image-only concept", ...);
it("after the last attempt it's failed, the conversation is told, and the quota returns", ...);
it("a lead's concept is hidden from site staff and finance", ...);
it("converting a lead moves its concepts to the project", ...);
it("PATCH refuses a room that fails the schema", ...);
```

- [x] **Step 2: Implement, then run the tests**

Run: `pnpm --filter @veenix/shared test room; pnpm --filter api test concepts; pnpm --filter api typecheck`
Expected: PASS.

- [x] **Step 3: Commit**: `feat(api): room concept generation`

### Task 16.2: WhatsApp delivery

**Files:**
- Modify: `apps/api/src/concepts/concepts.jobs.ts`
- Test: `apps/api/src/concepts/concepts.test.ts`

**Interfaces:**
- Consumes: `sendCtaUrl`, `sendTemplate`, `sendText`, `inWindow`, `downloadUrl` (with `expiresIn`), `WhatsAppLinkModel`.
- Produces: `deliverConcept(concept): Promise<void>`, called from `conceptFinished` when the concept's conversation is on WhatsApp.

**Inside the window:**
- A `cta_url` message with the restyled image as header.
- The header image URL is presigned for 1 hour, because Meta fetches it. ⚠ Verify how long Meta needs.
- Body: `<name>` then `AI concept, not to scale.`
- Button: "Open 3D view" when there's a room, "View concept" when the concept is image-only. Either way it opens `<WEB_ORIGIN>/concepts/:id`.
- A failed concept gets `sendText`: "Sorry, the room concept didn't work. Please try again."

**Outside the window:** the `concept_ready` template, with the name as its one body parameter. A failed concept sends nothing.

- [x] **Step 1: Write the failing tests**

```ts
it("uses cta_url inside the window and the template outside", ...);
it("the button text is at most 20 characters and links only by concept id", ...);
it("the text says AI concept, not to scale and never claims other work was done", ...);
it("an image-only concept gets View concept instead of Open 3D view", ...);
it("a failed concept sends an apology inside the window and nothing outside", ...);
```

- [x] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test concepts`
Expected: PASS.

- [x] **Step 3: Commit**: `feat(api): send room concepts on WhatsApp`

### Task 16.3: Chat card and the concept page

**Files:**
- Create:
  - `apps/web/components/concepts/ConceptCard.tsx`, `BeforeAfter.tsx`, `ConceptViewer.tsx`, `ConceptList.tsx`
  - `apps/web/app/(dashboard)/concepts/[id]/page.tsx`, `apps/web/actions/concepts.ts`
- Modify:
  - `apps/web/components/assistant/ChatMessage.tsx` (render `message.concepts`; step label "Started a room concept")
  - The project and lead detail pages (a `ConceptList` of saved concepts)
  - `apps/web/proxy.ts` (redirect to `/login?next=<path>`)
  - The login and verify-MFA pages (after sign-in, go to `next` if it starts with `/` and not `//`; it survives the MFA step in `sessionStorage`)

**Interfaces:**
- Consumes: Task 16.1's routes and `ConceptDto`.
- Produces:
  - `<ConceptCard concept onTryAnother={(name) => void} />`:
    - While `generating`: "Designing your room…". When `failed`: the error.
    - When `ready`: `BeforeAfter`, the label, **View** (a link to `/concepts/:id`), **Try another style** (prefills the composer with `Try another style for "<name>": `) and **Save** / **Saved**.
  - `<BeforeAfter before after />`: a draggable divider. Keyboard-accessible: a range input with a label.
  - `<ConceptViewer concept />`: a full-viewport client component.
    - Top bar: name, label, **Present** (Fullscreen API on the viewer element), **Save**, and back.
    - A **Photo / 3D** switch. The 3D side is a placeholder until Task 16.4; when `room` is null it's hidden.
    - While `generating`, it refreshes every 5 seconds.
  - The page renders `notFound()` when the API says not found.

- [x] **Step 1: Build.**

- [x] **Step 2: Check it.**

Run: `pnpm --filter web typecheck; pnpm --filter web build`
Expected: both succeed.

In the running app, with a ready concept inserted by hand (OpenAI isn't needed for this):
- The chat card shows the slider, and View opens the full page.
- Present fills the display, and the label stays visible.
- Signed out, opening `/concepts/:id` goes through login and MFA and comes back to the concept.
- Signed in as site staff, a lead's concept shows not found.

- [x] **Step 3: Commit**: `feat(web): room concept card and page`

### Task 16.4: The 3D room

**Files:**
- Create: `apps/web/components/concepts/RoomCanvas.tsx`, `furniture.ts`, `RoomEditor.tsx`
- Modify: `apps/web/components/concepts/ConceptViewer.tsx`, `apps/web/package.json` (`three`, `@types/three`)

**Interfaces:**
- Consumes: `Room`, `FURNITURE`, `FLOORS`, `fitRoom` from `@veenix/shared`; `PATCH /v1/concepts/:id`.
- Produces:
  - `furniture.ts`: `buildItem(type: FurnitureType, color: string): THREE.Group`, built from rounded boxes and cylinders to `FURNITURE`'s sizes.
  - `<RoomCanvas room light: "day" | "evening" walk selected onSelect onMove onError />`, loaded with `next/dynamic` and `ssr: false`.
    - Scene: walls with openings cut out, floor finishes as procedural materials, soft shadows, `RoomEnvironment`, ACES tone mapping and `OrbitControls`.
    - `walk` moves the camera to 1.6 m inside the front wall.
    - Dragging a selected item moves it along the floor (a ray against the floor plane).
    - `onError` fires when there's no WebGL, the context is lost (`webglcontextlost`), or the scene throws (an error boundary around the canvas).
  - `<RoomEditor room onChange />`:
    - Wall colour swatches, floor buttons, and width, length and height inputs.
    - For the selected item: rotate 90°, colour swatches and delete.
    - **Add** from the catalogue.
    - Every change goes through `fitRoom`.
    - **Save changes** sends `PATCH { room }`; **Reset** returns to the stored room.

- [ ] **Step 1: Build.**

- [ ] **Step 2: Check it.**

Run: `pnpm --filter web build`
Expected: succeeds, and the build output shows `three` only in the chunk the concept page loads.

In the running app, with the hand-inserted concept:
- 3D shows the room. Drag rotates it, and scroll or pinch zooms.
- Walk in, Day / Evening, the swatches, moving, adding and deleting items, and Save changes all work. After a reload, the edits are still there.
- Full screen keeps the label visible.
- With WebGL disabled in Chrome, the photo shows, not a blank box.
- On a phone (or Chrome's device mode), touch rotation works.

- [ ] **Step 3: Commit**: `feat(web): 3D room viewer and editor`

### Task 16.5: Owner check on real photos (needs `OPENAI_API_KEY`)

- [ ] **Step 1: Run it.** In the app, send 5–10 real Malaysian room photos with briefs. Note:
  - the time to ready
  - the cost per concept (from OpenAI's usage page)
  - whether the restyle kept walls and windows in place
  - whether the 3D room roughly matches the photo
- [ ] **Step 2: The owner judges** on a laptop or tablet and on a phone: would a contractor show this to a client? Then try the WhatsApp button on a phone (with the Meta test number from plan 14).
- [ ] **Step 3: Record the outcome** in [../copilot-spec.md](../copilot-spec.md) §7: the image model, time, cost and quality. If the restyle moves walls, swap `restyle` in `concepts/ai.ts` for a depth-guided interior model and re-check.
