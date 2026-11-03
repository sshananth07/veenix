# 14: Copilot on WhatsApp

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** a linked staff member can send text, voice notes and photos to one Veenix WhatsApp number. The same assistant acts on them, under that person's permissions, and replies with what it heard and what changed, plus Approve and Undo buttons.

**Architecture:**
- A public webhook verifies Meta's signature, saves the event and a job in one transaction, and returns 200.
- A `whatsapp.inbound` job downloads media, transcribes audio and calls `startTurn` from plan 12. All of a sender's work runs in one job lane.
- Button taps are handled by server code, never by the LLM.

**Tech stack:** WhatsApp Cloud API over `fetch`, the speech provider chosen in Task 12.1, plan 12.

**Spec:** [../copilot-spec.md](../copilot-spec.md) §5.4, §8, §10.

## Global constraints
- **Prerequisite:** Task 12.1 must have found Meta's terms acceptable. Local development uses a test number and a tunnel, set up by the owner. Nothing here provisions accounts.
- **Environment (all optional, so the API boots without them; the webhook returns 503 when unset):** `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_NUMBER`, `STT_API_KEY`.
- **No media or LLM work in the webhook request.** Event and job are committed in MongoDB before the 200.
- **Free-form replies only inside the 24-hour window.** Outside it, approved templates only (plan 15).
- **A typed "yes" never approves anything.**
- **Delete temp files in `finally`.** Reject media over 16 MB with a friendly reply.

## Review focus
- **A voice note and a photo sent a few seconds apart:** they arrive as separate events, and the voice note uses the photo. Tested in Task 14.4.
- **Unintelligible or silent audio:** the assistant says it couldn't hear and asks for a retry, with no tool calls. Tested in Task 14.4.
- **An old Approve button tapped after a linked number is unlinked:** refused. Tested in Task 14.4.
- **A person in two organisations with no active one chosen:** asked which, and no action runs. Tested in Task 14.4.
- **An unlinked number sending many messages:** one refusal per day, no LLM call, no records. Tested in Task 14.2.

---

### Task 14.1: Phone linking

**Files:**
- Create: `apps/api/src/whatsapp/link.model.ts`, `phone.ts`, `links.service.ts`, `links.controller.ts`, `apps/web/components/settings/WhatsAppLink.tsx`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/config/env.ts`, `apps/api/.env.example`, `apps/web/app/(dashboard)/settings/page.tsx`, `apps/web/actions/settings.ts`
- Test: `apps/api/src/whatsapp/links.test.ts`

**Interfaces:**
- Produces:
  - `normalizePhone(raw: string): string | null`: digits only with country code; `012-345 6789` and `+60123456789` both give `60123456789`.
  - `WhatsAppLinkModel`, **not** under `tenantPlugin` because the webhook reads it with no context: `phone` (unique), `userId`, `activeOrgId` (nullable), `verifiedAt`, `lastInboundAt`, `notify: boolean` (default true).
  - `startLink(): Promise<{ code: string; waUrl: string }>`: a 6-digit code in Redis for 10 minutes, tied to the signed-in user and organisation. `waUrl` is `https://wa.me/<WHATSAPP_NUMBER>?text=LINK%20<code>`.
  - `confirmLink(phone: string, code: string): Promise<boolean>`: called by the webhook; single use.
  - `unlink()`, `myLink()`
  - Routes: `POST /v1/whatsapp/link`, `DELETE /v1/whatsapp/link`, `GET /v1/whatsapp/link` (`@Can()`, `@RateLimit(10)` on POST).

- [x] **Step 1: Write the failing tests**

```ts
it("normalizes Malaysian numbers and WhatsApp IDs to the same form", ...);
it("a code works once and expires", ...);
it("a number already linked to another user is refused", ...);
it("linking needs a signed-in session: the webhook alone can't create a link without a code", ...);
```

- [x] **Step 2: Implement.** The settings section shows the linked number, an unlink button and "Link WhatsApp", which opens `waUrl`. Because login requires MFA, the code proves an MFA-verified session.

- [x] **Step 3: Run the tests**

Run: `pnpm --filter api test links; pnpm --filter web build`
Expected: PASS and a successful build.

- [x] **Step 4: Commit**: `feat(api): link WhatsApp numbers to members`

### Task 14.2: Webhook

**Files:**
- Create: `apps/api/src/whatsapp/event.model.ts`, `webhook.ts`, `whatsapp.controller.ts`, `client.ts`
- Modify: `apps/api/src/app.factory.ts` (`NestFactory.create(AppModule, { rawBody: true })`), `apps/api/src/jobs/jobs.ts` (`JobType`), `apps/api/src/app.module.ts`
- Test: `apps/api/src/whatsapp/webhook.test.ts`

**Interfaces:**
- Consumes: `normalizePhone`, `confirmLink`, `WhatsAppLinkModel`, `enqueue`.
- Produces:
  - `verifySignature(rawBody: Buffer, header: string | undefined): boolean`: HMAC-SHA256 with `timingSafeEqual`.
  - `splitMessages(payload: unknown): InboundMessage[]`, where `InboundMessage = { id: string; from: string; timestamp: number; type: "text" | "audio" | "image" | "button"; text?: string; mediaId?: string; mimeType?: string; buttonId?: string }`.
  - `ingest(payload): Promise<void>`: for each message, resolves the sender and saves the event and job together.
  - `WhatsAppEventModel`, not under `tenantPlugin`: `messageId` (unique), `orgId`, `payload`, `status`, with a 30-day TTL. ⚠ Check the right retention under spec §10.
  - `whatsapp.inbound` job, lane `wa:<phone>`.
  - `GET /v1/webhooks/whatsapp` (`@Public`) answers Meta's `hub.challenge` when `hub.verify_token` matches. `POST /v1/webhooks/whatsapp` (`@Public`).

**Handling by sender, no LLM in any of these:**
- `LINK <code>` from any number: `confirmLink`, then a reply.
- Unlinked number: a refusal at most once a day (Redis `SET NX EX 86400`), sent under `waitUntil`, with nothing saved.
- Linked number: event plus job, then `kick()`. A sender over 20 messages a minute is dropped with a log line.

Reject the request if `metadata.phone_number_id` isn't ours. Ignore status updates, except logging send failures.

- [x] **Step 1: Write the failing tests**

```ts
it("rejects a bad signature with 401 and saves nothing", ...);
it("verifies against raw bytes, not re-serialized JSON", ...);
it("answers the challenge only with the right verify token", ...);
it("a duplicate delivery does nothing", async () => { await ingest(p); await ingest(p); expect(await JobModel.countDocuments()).toBe(1); });
it("splits a batch of two messages and ignores statuses", ...);
it("an unlinked number gets one refusal a day and creates no records", ...);
it("event and job are saved together: a failed enqueue leaves no event", ...);
it("returns 503 when WhatsApp isn't configured", ...);
```

- [x] **Step 2: Implement.** `client.ts` starts with `sendText(to, text)`. ⚠ Verify payload and Graph API version against Meta's current docs.

- [x] **Step 3: Run the tests**

Run: `pnpm --filter api test webhook`
Expected: PASS, and the existing suite still passes with `rawBody` on.

- [x] **Step 4: Commit**: `feat(api): WhatsApp webhook`

### Task 14.3: Sending

**Files:**
- Modify: `apps/api/src/whatsapp/client.ts`
- Test: `apps/api/src/whatsapp/client.test.ts` (mocked `fetch`)

**Interfaces:**
- Produces:
  - `sendButtons(to, text, buttons: { id: string; title: string }[])`: at most 3 buttons, titles at most 20 characters.
  - `sendCtaUrl(to, { body, buttonText, url, headerImageUrl? })`: button text at most 20 characters.
  - `sendTemplate(to, name, language, components)`
  - `showTyping(messageId)`: also marks the message read; lasts up to 25 seconds.
  - `getMedia(mediaId): Promise<{ bytes: Buffer; mimeType: string }>`
  - `inWindow(link): boolean`: `lastInboundAt` within 24 hours.
  - `WhatsAppSendError` for failures, retried by the job.

- [x] **Step 1: Write the failing tests**: exact payloads for each send type, over-long button text rejected before the call, and a Meta error raising `WhatsAppSendError`.

- [x] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test client`
Expected: PASS.

- [x] **Step 3: Commit**: `feat(api): WhatsApp sending`

### Task 14.4: Inbound job, voice and buttons

**Files:**
- Create: `apps/api/src/whatsapp/inbound.ts`, `stt.ts`, `reply.ts`
- Modify: `apps/api/src/app.module.ts` (import to register the job), `apps/api/src/storage/storage.ts` (`newKey` purpose `"assistant"`), `apps/api/src/files/files.service.ts` (download kind for assistant media)
- Test: `apps/api/src/whatsapp/inbound.test.ts` (with `stt.ts`, `client.ts` and `llm.ts` mocked)

**Interfaces:**
- Consumes: `startTurn`, `registerReplySink`, `approve`, `reject`, `undoToolCall`, `runAsMember`, `getMedia`.
- Produces:
  - `transcribe(audio: Buffer, mimeType: string): Promise<{ text: string }>`: the provider from Task 12.1, in plain functions with no provider interface. Add FFmpeg only if that provider needs it.
  - Button IDs: `approve:<actionId>`, `reject:<actionId>`, `undo:<toolCallId>`, `org:<orgId>`.
  - `whatsapp` reply sink: text with "Heard: …" first for voice notes, then cards as buttons.

**Handler steps, in order:**
1. Load the link and event. No link now: reply and stop.
2. No `activeOrgId`: with one membership, set it. With several, send `org:` buttons (up to 3; beyond that, link to settings) and stop.
3. `runAsMember`. Not a member: reply and stop.
4. Update `lastInboundAt`, and call `showTyping`. The indicator clears after 25 seconds, so the turn calls it again between loop steps, and a concept request sends a short holding message.
5. **Button:** run the action directly, reply with the result, and stop.
6. **Image:** store in S3. With a caption, treat it as a message. Without one, keep it for the next message (15 minutes) and send no reply.
7. **Audio:** download and store. Over the size limit: reply and stop. Transcribe. Empty result: ask to resend and stop.
8. Call `startTurn` with the text, transcript, attachments and lane `wa:<phone>`.

Cards with `card.missing`, or with a `link`, show a "Open in Veenix" button in place of Approve.

- [ ] **Step 1: Write the failing tests**

```ts
it("a voice note is transcribed and acts as the linked member, with their scope", ...);
it("the reply starts with what was heard", ...);
it("a photo then a voice note: the voice note's turn has the photo", ...);
it("a photo older than 15 minutes isn't used", ...);
it("empty audio asks for a retry and makes no LLM call", ...);
it("too-large media gets a friendly reply and isn't downloaded twice", ...);
it("Approve taps apply without the LLM; a stranger's button ID is refused", ...);
it("typed 'yes' goes to the LLM and approves nothing", ...);
it("Approve after unlink is refused", ...);
it("a person in two organizations is asked which, and nothing runs until they choose", ...);
it("a retried job doesn't send the message to the LLM twice", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test inbound`
Expected: PASS.

- [ ] **Step 3: Live check (owner's test number and tunnel, small spend).** Send a Manglish voice note about a real test project. Expected: a correct update, "Heard: …" in the reply, Undo works, and a duplicate webhook replay from Meta's dashboard does nothing.

- [ ] **Step 4: Commit**: `feat(api): WhatsApp voice notes and buttons`
