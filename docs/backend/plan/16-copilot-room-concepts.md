# 16: Copilot 3D room concepts

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** a contractor attaches a room photo and a design brief in chat, and a rotatable 3D concept appears inside the chat message, ready to present full screen to the client. On WhatsApp, the same request returns a preview image and a link to the 3D view.

**Architecture:**
- `generate_room_concept` saves a concept and a job, and returns right away. Short jobs restyle the photo, start the 3D generation and poll for it, then copy the results into Veenix's storage.
- One viewer component serves the chat message and a full page at `/concepts/:id`.

**Tech stack:** the vendors confirmed in Task 16.1, a splat renderer on Three.js, `next/dynamic`.

**Spec:** [../copilot-spec.md](../copilot-spec.md) §7, §8, §10.

## Global constraints
- **Don't start Tasks 16.2 onward until the owner has approved the spike result in Task 16.1.** If 3D fails but the restyled image passes, build this plan without Task 16.4's 3D renderer.
- **"AI concept, not to scale" is always visible**, including full screen and in WhatsApp's message text.
- **Concepts are never attached to quotations or other client documents.**
- **Quota:** 20 renders per organisation per day. Failures don't count.
- **Vendors get short-lived presigned URLs only.** Results are copied to our storage immediately. Vendor links aren't stored for display.
- **The link grants nothing.** `/concepts/:id` needs normal login, MFA and permission.
- **Vendor code is plain functions in one file.** No provider interface.

## Review focus
- **WebGL missing, or the context lost during a client presentation:** the restyled image shows, with no blank screen. Tested in Task 16.4 by forcing the failure.
- **The vendor never finishes:** after 15 minutes the concept is `failed`, the chat says so, and quota is returned. Tested in Task 16.2.
- **A concept on a lead, viewed by site staff:** not found. Tested in Task 16.2.
- **A very large 3D file on a slow connection:** a progress state, and the image remains available. Checked by hand in Task 16.4.
- **A job retried after a paid call:** no second render. Tested in Task 16.2.

---

### Task 16.1: Spike (owner judges)

**Files:** throwaway, outside `apps/`. Not committed.

- [ ] **Step 1: Run the pipeline** (paid, owner approves). Take 5–10 real Malaysian room photos through a layout-preserving restyle and World Labs Marble. ⚠ Verify the API, price and whether commercial use is allowed on the chosen plan. Find a splat viewer that works on React 18.
- [ ] **Step 2: Show the owner** on a laptop or tablet and on a phone. Would a contractor show this to a client?
- [ ] **Step 3: Record the outcome** in [../copilot-spec.md](../copilot-spec.md) §7: vendors, output format and file size, viewer library, typical time and cost. If it fails, stop and decide: ship the restyled image only, or re-plan for a room shell with a furniture catalogue.

### Task 16.2: Concepts and generation jobs

**Files:**
- Create: `apps/api/src/concepts/concept.model.ts`, `vendors.ts`, `concepts.service.ts`, `concepts.jobs.ts`, `concepts.controller.ts`, `apps/api/src/assistant/tools.concepts.ts`
- Modify:
  - `apps/api/src/jobs/jobs.ts` (`JobType`), `apps/api/src/app.module.ts`, `apps/api/src/config/env.ts`, `apps/api/.env.example`
  - `apps/api/src/storage/storage.ts` (`newKey` purpose `"concepts"`), `apps/api/src/files/files.service.ts` (download kinds `concept-image`, `concept-scene`)
  - `apps/api/src/leads/leads.service.ts` (`convert` moves a lead's concepts to the new project), `packages/shared/src/dto.ts`
- Test: `apps/api/src/concepts/concepts.test.ts` (with `vendors.ts` mocked)

**Interfaces:**
- Consumes: `defineTool`, `ToolContext.attachments`, `enqueue`, `putObject`, `changed`, `addConversationNote`.
- Produces:
  - `DesignConceptModel`, `tenantPlugin` with `projectField: "projectId"`: `projectId`, `leadId` (exactly one), `sourceKey`, `brief`, `status: "generating" | "image_ready" | "ready" | "failed"`, `imageKey`, `sceneKey`, `vendorTaskId`, `name`, `saved`, `error`, `conversationId`, `messageId`, `startedAt`.
  - Tool `generate_room_concept`, permission `concept:generate`, level `background`, input `{ projectId: objectId | null, leadId: objectId | null, brief: string (1–2000), photoIndex: int | null }`. The photo comes from `ToolContext.attachments`, never a URL. Result: "Started. It will appear in this conversation."
  - `vendors.ts`: `restyle(photoUrl: string, brief: string): Promise<Buffer>`, `startScene(imageUrl: string): Promise<string>`, `checkScene(taskId: string): Promise<{ status: "running" } | { status: "done"; bytes: Buffer; ext: string } | { status: "failed"; error: string }>`. ⚠ Exact shape from Task 16.1.
  - Jobs: `concept.restyle`, `concept.scene.start`, `concept.scene.poll` (re-enqueues itself with `runAt` 15 s later).
  - `ConceptsService.list(ref)`, `.get(id)`, `.setName(id, name)`, `.setSaved(id, saved)`
  - `GET /v1/concepts/:id` (`project:read`, plus `lead:read` for a lead's concept), `PATCH /v1/concepts/:id` (`concept:generate`), `GET /v1/projects/:id/concepts`.

Add `.spz` (and the format the spike chose) to the storage content types **without** adding it to `UPLOAD_RULES`, because only server jobs write these files.

- [ ] **Step 1: Write the failing tests**

```ts
it("saves the concept and job together and returns before any vendor call", ...);
it("refuses without an attached photo", ...);
it("refuses over 20 a day, and a failure doesn't count", ...);
it("a retried tool call doesn't start a second render", ...);
it("a retried restyle job doesn't pay twice once the image is stored", ...);
it("stores results in our bucket and never saves a vendor URL as the display link", ...);
it("the image shows while 3D is still generating", ...);
it("fails after 15 minutes, tells the conversation, and returns the quota", ...);
it("a 3D failure leaves the image usable", ...);
it("a lead's concept is hidden from site staff and finance", ...);
it("converting a lead moves its concepts to the project", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test concepts`
Expected: PASS.

- [ ] **Step 3: Commit**: `feat(api): room concept generation`

### Task 16.3: WhatsApp delivery

**Files:**
- Modify: `apps/api/src/concepts/concepts.jobs.ts`, `apps/api/src/whatsapp/reply.ts`
- Test: `apps/api/src/concepts/concepts.test.ts`

**Interfaces:**
- Consumes: `sendCtaUrl`, `sendTemplate`, `inWindow`, `downloadUrl`.
- Produces: `deliverConcept(concept): Promise<void>`, called when a concept reaches `ready`, or `image_ready` when 3D failed.

Inside the window: `cta_url` with the preview as header image, body text including "AI concept, not to scale", and the button "Open 3D view", opening `<WEB_ORIGIN>/concepts/:id`. Outside the window: the `concept_ready` template. The preview URL is presigned, because Meta must be able to fetch it. Keep it valid for at least 15 minutes, and ⚠ Verify how long Meta needs.

- [ ] **Step 1: Write the failing tests**

```ts
it("uses cta_url inside the window and the template outside", ...);
it("the button text is at most 20 characters and links only by concept id", ...);
it("the text never claims other work was done", ...);
it("an image-only concept is sent without the 3D button", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test concepts`
Expected: PASS.

- [ ] **Step 3: Commit**: `feat(api): send room concepts on WhatsApp`

### Task 16.4: Viewer in the chat and on its own page

**Files:**
- Create:
  - `apps/web/components/assistant/ConceptViewer.tsx`, `ConceptMessage.tsx`, `SplatCanvas.tsx`
  - `apps/web/app/(dashboard)/concepts/[id]/page.tsx`
- Modify: `apps/web/components/assistant/ChatMessage.tsx`, `apps/web/actions/assistant.ts`, the login redirect in `apps/web/lib/session.ts` if it doesn't already return to the requested page, `apps/web/package.json`

**Interfaces:**
- Consumes: concept routes, signed download URLs, `useLiveEvents`.
- Produces:
  - `<ConceptViewer concept={...} />`: renders the image at once and loads `SplatCanvas` only when there's a scene.
  - `SplatCanvas` is imported with `next/dynamic` and `ssr: false`, so Three.js stays out of every other page. `apps/web` is on React 18: ⚠ Verify the React Three Fiber version.

Layout follows mockup option A: the room sits inside the assistant's message, with Present full screen (browser Fullscreen API), Try another style, and Save to project. Drag to rotate, scroll or pinch to zoom. Show "AI concept, not to scale" at all times, including full screen. "Try another style" sends a normal chat message reusing the same photo.

The fallback to the image covers no WebGL, lost context, a loading failure, and any render error (an error boundary around `SplatCanvas`).

- [ ] **Step 1: Build.**

- [ ] **Step 2: Check it.**

Run: `pnpm --filter web build`
Expected: succeeds, and the build output shows Three.js only in the chunk loaded by the viewer.

In the running app:
- A photo and brief in chat show generating, then the image, then a rotating room inside the message.
- Full screen fills the display, and the label stays visible.
- Disabling WebGL in Chrome shows the image, not a blank box.
- The WhatsApp button, on a phone, goes through login and back to the room, and touch rotation works.
- Signed in as a user with no access, the concept page shows not found.

- [ ] **Step 3: Commit**: `feat(web): room concept viewer in chat`
