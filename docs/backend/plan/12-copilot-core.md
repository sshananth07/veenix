# 12: Copilot core and in-app chat

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** a signed-in staff member can chat with an assistant inside Veenix to add project updates, create tasks, change a project's stage and ask open questions about their projects and tasks, under their own permissions, with undo, approvals and an action catalogue in place for later plans.

**Architecture:**
- `apps/api/src/assistant/` holds plain modules of functions: models, a tool registry, the LLM call and the turn loop. It is a module in the existing API, in `AppModule`.
- A message becomes an `assistant.turn` job. The job runs as the sender, loops over Claude tool calls, and publishes an event when the reply is ready. The browser refetches.
- Tools call existing services and never write domain collections directly.

**Tech stack:** `@anthropic-ai/sdk`, Zod 4 (`z.toJSONSchema`), the job queue (plan 05), SSE (plan 05), React.

**Spec:** [../copilot-spec.md](../copilot-spec.md) §3, §5.1–§5.3, §5.5–§5.9, §6, §9, §14.

## Global constraints
- **Don't run:** nothing here provisions Vercel, Meta or vendor accounts. Paid API calls need the owner's approval.
- **Model:** `claude-opus-5-5` at `medium` effort, `tool_choice: auto`, `strict: true` on tools, `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`. Forced `tool_choice` returns a 400. ⚠ Verify against the installed SDK.
- **Limits (constants in `assistant/limits.ts`):** 8 loop turns per message, 10 tool calls per message, 20 inbound messages per sender per minute, a daily LLM spend cap per organisation.
- **Tools never accept** an organisation, user, file URL or raw field map. Every ID is loaded through the tenant plugin.
- **Writes run one at a time** because `projects` uses `optimisticConcurrency`. Reads may run in parallel. All results for one model response go back in one user message, with `is_error: true` on failures.
- **Assistant history is append-only** and stored exactly as returned, because thinking blocks must be replayed unchanged.
- **Quotation `lineItems` are never written by this code.**
- **The LLM never supplies code or pipeline stages.** New tools are added in reviewed code. Automations, saved reports and dashboards aren't part of this plan (spec §14).

## Review focus
- **A site worker's message asks to edit a project they aren't assigned to:** the tool reports not found and nothing changes. Tested in Task 12.5.
- **The LLM calls a tool the role doesn't have (it wasn't offered):** refused at execution. Tested in Task 12.5.
- **A job dies after a write and is retried:** the write doesn't happen twice. Tested in Task 12.5.
- **Two messages sent quickly in one conversation:** handled in order, never together. Tested in Task 12.2.
- **A member removed mid-conversation:** the next message stops before any LLM call. Tested in Task 12.3.
- **A query asks for a field or entity the role can't see:** refused, and nothing outside the entity map can be read. Tested in Task 12.5b.
- **A new catalogue action has no undo:** it stays at approval, and an apply-level tool can't be registered without an undo. Tested in Tasks 12.5 and 12.7.

---

### Task 12.1: Before building (owner)

**Files:** none in the repo.

- [ ] **Step 1: Check Meta's terms.** Read Meta's current WhatsApp Business Solution terms on AI use. Decide whether a staff-only CRM assistant is allowed. If it isn't, plans 14 and 15 change. Record the outcome in [../copilot-spec.md](../copilot-spec.md) §10.
- [ ] **Step 2: Run the speech spike** (spec §10, paid calls, owner approves). Throwaway script outside `apps/`, on 20–30 real voice notes including Manglish and Malay, through a few providers. Record the chosen provider, whether it accepts OGG directly, and the error rate on names and amounts in §10.

### Task 12.2: Job lanes and per-type retries

**Files:**
- Modify: `apps/api/src/jobs/job.model.ts`, `apps/api/src/jobs/jobs.ts`
- Test: `apps/api/src/jobs/jobs.test.ts`

**Interfaces:**
- Produces:
  - `enqueue(type, payload, runAt = new Date(), lane: string | null = null)`
  - `registerJob(type, handler, opts?: { lockMs?: number; retryDelayMs?: (attempts: number) => number; maxAttempts?: number; onGiveUp?: (payload, error: string) => Promise<void> })`
  - `JobType` gains `"assistant.turn"`

The database enforces one running job per lane, in the repo's usual style:

```ts
jobSchema.index({ lane: 1 }, { unique: true, partialFilterExpression: { status: "running", lane: { $type: "string" } } });
```

- [x] **Step 1: Write the failing tests**

```ts
it("runs jobs in one lane in order, oldest first", async () => {
  // enqueue a, b in lane "c1"; runDue(); handler records order
  expect(order).toEqual(["a", "b"]);
});
it("a claim loses when another job in the lane is running", async () => {
  // insert a running job in lane "c2" with a future lockedUntil, and a pending one
  await runDue();
  expect((await JobModel.findById(pendingId).lean())!.status).toBe("pending");
  expect((await JobModel.findById(pendingId).lean())!.attempts).toBe(0);
});
it("a failed job holds back newer jobs in its lane", async () => {
  // a fails with retry delay; b is due now; after runDue(), b is still pending
});
it("uses the type's retry delay and calls onGiveUp at the last attempt", async () => { /* ... */ });
```

- [x] **Step 2: Run them to confirm they fail**

Run: `pnpm --filter api test jobs`
Expected: FAIL.

- [x] **Step 3: Implement**

`claimNext(skipLanes: Set<string>)`:
1. Find the oldest due job (`sort: { runAt: 1, _id: 1 }`) with `lane` not in `skipLanes`.
2. If it has a lane and an older unfinished job exists in that lane (`_id: { $lt }`, status `pending`), add the lane to `skipLanes` and repeat.
3. Claim it with `findOneAndUpdate({ _id, ...still due }, ...)`, using the type's lock.
4. On E11000, add the lane to `skipLanes` and repeat. Neither step 2 nor step 4 changes `attempts`.

`runBatch` keeps one `skipLanes` set per batch. Existing types keep `2^attempts` minutes, 8 attempts and 120 s. Mark the serial runner with `// ponytail: one runner per instance, so a slow assistant turn delays mail on that instance; run assistant jobs on their own kick if this shows up.`

- [x] **Step 4: Run the tests**

Run: `pnpm --filter api test jobs`
Expected: PASS, including the two existing tests.

- [x] **Step 5: Commit**: `feat(api): job lanes and per-type retries`

### Task 12.3: Running as a member, permissions, personal live events

**Files:**
- Create: `apps/api/src/auth/member-ctx.ts`
- Modify:
  - `apps/api/src/auth/access.guard.ts` (use `memberCtx`)
  - `packages/shared/src/permissions.ts`
  - `apps/api/src/live/live.ts`, `apps/api/src/live/live.controller.ts`
- Test: `apps/api/src/auth/member-ctx.test.ts`, `apps/api/src/live/live.test.ts`

**Interfaces:**
- Produces:
  - `memberCtx(orgId, userId): Promise<RequestContext | null>`: null without an active membership; role and project scope read fresh.
  - `runAsMember<T>(orgId, userId, fn: () => Promise<T>): Promise<T | "not_a_member">`
  - Permissions `update:write`, `task:write`, `concept:generate`
  - `LiveEvent` kind `"assistant"` with `userId`; `visible(e, scope, userId)`

Add to roles:
- `update:write`: project_manager, site_staff, procurement (owner and admin get all).
- `task:write`: sales, project_manager, site_staff, procurement, finance.
- `concept:generate`: sales, project_manager.

- [x] **Step 1: Write the failing tests**

```ts
it("a removed member gets null", async () => { expect(await memberCtx(org, removedUser)).toBeNull(); });
it("site staff get only their assigned projects", async () => {
  expect((await memberCtx(org, staff))!.projectScope).toEqual([assignedProject]);
});
it("an event with a userId only reaches that user", () => {
  const e = { kind: "assistant", userId: "u1" } as const;
  expect(visible(e, "all", "u1")).toBe(true);
  expect(visible(e, "all", "u2")).toBe(false); // owners don't see other people's chats
});
```

- [x] **Step 2: Implement.** Move the membership and scope lookup out of `AccessGuard` without changing its behaviour. `readTicket` also returns `userId` from the token's `sub`, and `liveStream` takes it.

- [x] **Step 3: Run the tests**

Run: `pnpm --filter @veenix/shared build; pnpm --filter api test member-ctx live access`
Expected: PASS.

- [x] **Step 4: Commit**: `feat(api): run work as a member; personal live events`

### Task 12.4: Site updates and tasks

Projects have no activity log today. `projectUpdateInput` already means "edit project fields", so this feature is named **site updates**.

**Files:**
- Create:
  - `packages/shared/src/schemas/assistant.ts`
  - `apps/api/src/updates/site-update.model.ts`, `updates.service.ts`, `updates.controller.ts`
  - `apps/api/src/tasks/task.model.ts`, `tasks.service.ts`, `tasks.controller.ts`
- Modify: `apps/api/src/app.module.ts`, `packages/shared/src/dto.ts`, `apps/api/src/projects/projects.service.ts`
- Test: `apps/api/src/updates/updates.test.ts`, `apps/api/src/tasks/tasks.test.ts`

**Interfaces:**
- Produces:
  - `SITE_UPDATE_KINDS = ["progress", "issue", "material_request", "delivery"]`
  - `siteUpdateInput`: `{ projectId, kind, text (1–4000), photos: uploadRef[] (max 10) }`
  - `taskInput`: `{ title (1–200), assigneeId: objectId | null, dueAt: dateOrNull, projectId: objectId | null, leadId: objectId | null }`
  - `UpdatesService.add(input, source?: { messageId }) : Promise<{ id: string }>`, `.remove(id)`, `.list(projectId)`
  - `TasksService.create(input, source?) : Promise<{ id: string }>`, `.complete(id)`, `.remove(id)`, `.listMine()`, `.listForProject(projectId)`
  - `ProjectsService.setStage(id, stage, cancelReason: string | null): Promise<{ previous: { stage, cancelReason, stageEnteredAt } }>`, with an audit event
  - Routes: `GET /v1/projects/:id/updates` (`project:read`), `POST /v1/updates` (`update:write`), `DELETE /v1/updates/:id` (`update:write`), `GET /v1/tasks` (`@Can()`), `POST /v1/tasks` (`task:write`), `POST /v1/tasks/:id/complete` (`@Can()`), `DELETE /v1/tasks/:id` (`task:write`)

`site_updates` uses `tenantPlugin` with `projectField: "projectId"`. `tasks` uses `tenantPlugin` with **no** `projectField`, because the plugin's scope filter would hide a project-scoped user's own general tasks. `TasksService` applies the scope itself: scoped roles see tasks assigned to or created by them, plus tasks on projects in scope.

- [x] **Step 1: Write the failing tests**

```ts
it("site staff can add an update only on an assigned project", async () => {
  await expect(asStaff(() => updates.add({ projectId: other, kind: "progress", text: "x", photos: [] }))).rejects.toThrow();
  await expect(asStaff(() => updates.add({ projectId: mine, kind: "progress", text: "x", photos: [] }))).resolves.toBeDefined();
});
it("a scoped user sees their general task but not one on an unassigned project", async () => { /* ... */ });
it("assignee must be an active member of the organization", async () => { /* ... */ });
it("setStage records the time, the audit event, and returns the previous stage", async () => { /* ... */ });
```

- [x] **Step 2: Implement.** Photos go through `claim(ref, "photos")`. `add` publishes `changed({ kind: "project", projectId })`.

- [x] **Step 3: Run the tests**

Run: `pnpm --filter api test updates tasks`
Expected: PASS.

- [x] **Step 4: Commit**: `feat(api): site updates and tasks`

### Task 12.5: Tool registry

**Files:**
- Create: `apps/api/src/assistant/models.ts`, `tools.ts`, `tools.project.ts`
- Test: `apps/api/src/assistant/tools.test.ts`

**Interfaces:**
- Consumes: Tasks 12.3 and 12.4.
- Produces:

```ts
type Level = "read" | "apply" | "approval" | "background";
type ToolContext = { conversationId: Types.ObjectId; messageId: Types.ObjectId; attachments: { key: string; name: string; kind: "photo" | "audio" }[] };
type ToolResult = { content: string; display?: object; undo?: object };

interface ToolDef<I> {
  name: string;
  description: string;
  input: z.ZodType<I>;
  permission: Permission | null;      // null = any member
  level: Level;
  deferred?: boolean;                 // found through tool search instead of always loaded
  run(input: I, c: ToolContext): Promise<ToolResult>;
  undo?(data: object): Promise<void>; // required for level "apply"; defineTool throws without it
}

defineTool<I>(def: ToolDef<I>): void
toolsFor(role: Role)                                        // sorted by name, strict: true; deferred tools carry defer_loading: true; includes the tool search tool
executeTool(c: ToolContext, use: { id: string; name: string; input: unknown }): Promise<{ content: string; isError: boolean }>
```

Tool search is the server tool `{ type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" }`. At least one tool must stay non-deferred, or the API returns a 400. The search runs on Anthropic's side, so `executeTool` never sees it, and its blocks are stored with the rest of the raw response. Use the SDK's beta tool types for the return type of `toolsFor`.

- Models: `AssistantConversationModel` (`userId`, `channel: "app" | "whatsapp"`, `projectId`), `AssistantMessageModel` (`conversationId`, `role`, `content`: raw blocks, `transcript`, `attachments`, `sourceEventId`), `AssistantToolCallModel` (`conversationId`, `toolUseId`: unique together, `toolName`, `result`, `isError`, `undo`, `undoneAt`), all under `tenantPlugin`.
- Tools in `tools.project.ts`: `search_records` (`search()`), `get_project` (`ProjectsService.detail`, reduced to name, code, stage, client name, work items, packages from `getPackages`, assignees), `list_my_tasks`, `add_project_update`, `create_task`, `set_project_stage`, and `report_unsupported_request` (`{ request: string (1–500) }`, level `read`, recorded with `audit("assistant.unsupported_request", "conversation", c.conversationId, { request })`, and returning "Noted. Tell the user this isn't available yet.").

`executeTool` order:
1. A recorded call for this `toolUseId` returns its stored result.
2. Unknown tool: `isError`.
3. `can(role, permission)` fails: `isError`, "You don't have permission to do that."
4. `input.safeParse` fails: `isError` with the Zod message.
5. Run. `AppError` messages become the result. Anything else logs and returns "That didn't work."
6. Record the result, in the same transaction as the write where the handler uses `tx`.

⚠ Verify: `z.toJSONSchema(input, { io: "input" })` output against what `strict: true` accepts. Claude's strict mode supports a subset of JSON Schema, so LLM-facing tool inputs may need simple schemas of their own. Keep them in `packages/shared/src/schemas/assistant.ts` and let the existing service validate again.

- [x] **Step 1: Write the failing tests**

```ts
it("offers each role only its tools, in a stable order", () => {
  const names = toolsFor("site_staff").map((t) => t.name);
  expect(names).toContain("add_project_update");
  expect(names).not.toContain("set_project_stage");
  expect(names).toEqual([...names].sort());
});
it("refuses a tool the role lacks even if the LLM calls it", async () => {
  const r = await asStaff(() => executeTool(c, { id: "t1", name: "set_project_stage", input: valid }));
  expect(r.isError).toBe(true);
  expect((await loadProjectLean(p)).stage).toBe("SITE_VISIT");
});
it("can't reach an unassigned project", async () => { /* add_project_update on another project: isError, no record */ });
it("a retried tool call doesn't write twice", async () => {
  await executeTool(c, use); await executeTool(c, use);
  expect(await SiteUpdateModel.countDocuments({ projectId: p })).toBe(1);
});
it("returns invalid input as an error for the LLM to correct", async () => { /* ... */ });
it("marks deferred tools with defer_loading and keeps at least one tool loaded", () => { /* ... */ });
it("hides a deferred tool from a role without its permission", () => { /* ... */ });
it("refuses to register an apply tool with no undo", () => {
  expect(() => defineTool({ ...validTool, level: "apply", undo: undefined })).toThrow();
});
it("no registered tool uses a forbidden permission or deletes anything", () => {
  const forbidden = ["einvoice:submit", "org:manage", "member:manage"];
  expect(allTools().filter((t) => forbidden.includes(t.permission as string))).toEqual([]);
  expect(allTools().filter((t) => /delete|remove/.test(t.name))).toEqual([]);
});
it("report_unsupported_request records an audit event and changes nothing else", async () => { /* ... */ });
```

- [x] **Step 2: Implement.**

- [x] **Step 3: Run the tests**

Run: `pnpm --filter api test tools`
Expected: PASS.

- [x] **Step 4: Commit**: `feat(api): assistant tool registry and project tools`

### Task 12.5b: `query_records`

The lettered number keeps the later task numbers stable.

**Files:**
- Create: `apps/api/src/assistant/tools.query.ts`
- Modify: `apps/api/src/tasks/tasks.service.ts` (export the scope filter), `apps/api/src/app.module.ts`
- Test: `apps/api/src/assistant/tools.query.test.ts`

**Interfaces:**
- Consumes: `defineTool` (Task 12.5), `TasksService` scope (Task 12.4).
- Produces:

```ts
type QueryField = { type: "string" | "number" | "money" | "date" | "boolean" | "id"; label: string };

interface QueryEntity {
  model: Model<any>;                   // always a tenantPlugin model
  permission: Permission | null;
  fields: Record<string, QueryField>;  // nothing else can be read
  unwind?: string;                     // fixed by the map, for embedded lists such as milestones
  scope?: () => object;                // for services that apply their own scope
}

defineQueryEntity(name: string, entity: QueryEntity): void
```

- Tool `query_records`, level `read`, permission `null` (checked per entity), input:

```ts
{
  entity: string,
  filters: { field: string, op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in", value: string | number | boolean | null | (string | number)[] }[], // max 10
  groupBy: string | null,
  metric: { type: "rows" } | { type: "count" } | { type: "sum", field: string },
  sort: { field: string, dir: "asc" | "desc" } | null,
  limit: number | null, // max 50
}
```

- Plan 12 entities: `projects`, `tasks`, `site_updates`. Money fields on `projects` wait for plan 13.

**Pipeline, built only by the server:** `$match` from the entity's `scope()`, then the optional `$unwind`, then `$match` from the filters, then `$group`, `$sort`, and `$limit` (default 20, max 50). `tenantPlugin` adds its own filter first. Pass `maxTimeMS(5000)`.

**Checks, before any query runs:**
1. The entity exists and the role has its permission. `can()` fails: `isError`.
2. Every field is in the map. An error lists the allowed fields, so the LLM can correct itself.
3. Each value is cast to its field's type, and a value that won't cast is refused. Objects never reach `$match`.
4. A `sum` on a `money` field needs `report:read`.

The result's `content` holds the rows plus `truncated: true` when the limit cut them off. `display` holds `{ type: "table", columns, rows }`, with money formatted in RM by server code. The tool description lists each entity's fields, in a stable order so the prompt cache holds.

Mark it with `// ponytail: no joins, so a cross-entity question takes several calls; add a fixed join to the map when the log shows one is common.`

- [x] **Step 1: Write the failing tests**

```ts
it("counts site updates per project", async () => { /* groupBy projectId, metric count */ });
it("site staff only get assigned projects", async () => { /* a project outside scope never appears */ });
it("another organization's data never appears", async () => { /* ... */ });
it("a task query follows the same scope as TasksService", async () => { /* matches listMine and project tasks for a scoped user */ });
it("refuses a field outside the map, including orgId", async () => { /* isError, and the message lists allowed fields */ });
it("refuses an entity the role has no permission for", async () => { /* ... */ });
it("an object as a filter value is refused", async () => { /* { $ne: null } as value: isError */ });
it("a sum on a money field needs report:read", async () => { /* ... */ });
it("caps rows at 50 and reports truncation", async () => { /* ... */ });
it("the pipeline contains only allowed stages", () => {
  const stages = buildPipeline(entity, input).map((s) => Object.keys(s)[0]);
  expect(stages.every((k) => ["$match", "$unwind", "$group", "$sort", "$limit"].includes(k))).toBe(true);
});
```

- [x] **Step 2: Implement.**

- [x] **Step 3: Run the tests**

Run: `pnpm --filter api test tools.query`
Expected: PASS.

- [x] **Step 4: Commit**: `feat(api): query_records for open questions`

### Task 12.6: Turn loop

**Files:**
- Create: `apps/api/src/assistant/llm.ts`, `prompt.ts`, `limits.ts`, `turn.ts`
- Modify: `apps/api/src/config/env.ts`, `apps/api/.env.example`, `apps/api/src/app.module.ts`, `apps/api/package.json`
- Test: `apps/api/src/assistant/turn.test.ts` (with `llm.ts` mocked; no network)

**Interfaces:**
- Consumes: Tasks 12.2, 12.3 and 12.5.
- Produces:
  - `createMessage(params): Promise<Anthropic.Beta.BetaMessage>` in `llm.ts`, the only file that imports the SDK.
  - `SYSTEM_PROMPT` in `prompt.ts`: exact text from spec §5.6.
  - `startTurn(input: { conversationId; userId; orgId; text: string; attachments; transcript?: string; lane?: string }): Promise<void>`: saves the user message and enqueues `assistant.turn`, in one transaction. The lane defaults to `conv:<conversationId>`.
  - `runTurn(conversationId, messageId): Promise<void>`
  - `registerReplySink(channel, (conversation, reply: { text: string; cards: object[] }) => Promise<void>)`; the `app` sink calls `changed({ kind: "assistant", userId })`.
  - `addConversationNote(conversationId, note: string): Promise<void>`: server-written facts given to the model in the next turn's context message.

`ANTHROPIC_API_KEY` is `z.string().optional()`, so the API still boots without it. `llm.ts` throws a clear error when it's missing.

**Each request:** `system` is the cached `SYSTEM_PROMPT`; `tools` is `toolsFor(role)`; `messages` is about the last 15 stored messages, then the user's message, then a `{ role: "system" }` context message with today's date, role, current project and any notes. ⚠ Verify the mid-conversation system message rules for this model. Store the context message so later requests replay the same prefix.

- [ ] **Step 1: Write the failing tests**

```ts
it("loops until end_turn and saves every response before running its tools", async () => { /* ... */ });
it("returns all tool results in one user message with is_error on failures", async () => { /* ... */ });
it("stops at 8 loop turns with a plain message", async () => { /* mock always returns tool_use */ });
it("stops at 10 tool calls in one message", async () => { /* ... */ });
it("stops before the LLM for a removed member", async () => { expect(createMessage).not.toHaveBeenCalled(); });
it("stops at the daily spend cap", async () => { /* ... */ });
it("checks stop_reason before running tools: refusal and max_tokens run nothing", async () => { /* ... */ });
it("resumes after a crash without repeating tools", async () => {
  // persisted assistant message + one recorded tool call; run again; handler ran once
});
```

- [ ] **Step 2: Implement.** Register `assistant.turn` with retry delays of 5 s, 20 s and 60 s, `maxAttempts: 4`, and `onGiveUp` sending "Sorry, that didn't go through. Please try again." through the reply sink. The handler wraps everything in `runAsMember`. Spend is tracked per organisation per day in Redis from `response.usage`.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter api test turn`
Expected: PASS.

- [ ] **Step 4: Live check (owner approves the small spend).** With a real key and the local stack: send "add a progress update to <project>: tiling done" through a scratch script. Expected: one site update, one audit event, a sensible reply. Also confirm `usage.cache_read_input_tokens` is above zero on the second message.

Then send a request that needs a deferred tool, to confirm tool search works with `strict: true` on this model and that the cache still hits afterwards. If they don't combine, turn `strict` off on deferred tools only, because `executeTool` already validates with Zod. Record the outcome in spec §5.7.

- [ ] **Step 5: Commit**: `feat(api): assistant turn loop`

### Task 12.7: Approval and undo

**Files:**
- Create: `apps/api/src/assistant/pending.ts`, `assistant.controller.ts`
- Modify: `apps/api/src/assistant/models.ts`, `tools.ts`, `apps/api/src/app.module.ts`
- Test: `apps/api/src/assistant/pending.test.ts`

**Interfaces:**
- Consumes: Task 12.5, `addConversationNote`.
- Produces:
  - `PendingActionModel`: `userId`, `conversationId`, `toolName`, `input`, `card`, `status: "pending" | "applied" | "rejected"`, `expiresAt`, `result`, under `tenantPlugin`.
  - `defineApprovalAction<I>({ name, description, input, permission, deferred = true, validate(input): Promise<Card>, apply(input): Promise<object> })`: this is the action catalogue. Registering an action also calls `defineTool` for `propose_<name>` at level `approval`, whose `run` calls `propose`. An entry is a few lines around an existing service method.
  - `propose(c: ToolContext, name, input): Promise<ToolResult>`: runs `validate`, saves the action, and returns the content "Shown to the user for approval. Not applied."
  - `approve(actionId, edits?: object): Promise<{ status: "applied"; result: object }>`, `reject(actionId)`, `undoToolCall(toolCallId)`
  - `Card = { title: string; lines: { label: string; value: string }[]; changes: { label: string; before: string; after: string }[]; missing: string[]; link?: string }`
  - First catalogue entry: `propose_assign_project_staff`, permission `project:assign`, input `assigneesInput` plus `projectId`. `validate` loads the project and fills `changes` with the current and new assignees. `apply` calls `ProjectsService.setAssignees`. Further entries are added in batches, led by the unsupported-request log.

**`approve` rules, in one transaction:**
1. Load the action. The user must be its creator, or refuse.
2. Refuse if expired (24 hours) or already used.
3. Re-check the permission for the current role.
4. Re-run `validate` with any edits. Refuse while `card.missing` isn't empty.
5. Run `apply`, set `applied`, and add a conversation note.

A failure rolls everything back and the action stays pending.

`undoToolCall`: same user, within 24 hours, not already undone. It calls the tool's `undo`, which refuses with "This has changed since. Open it in Veenix." when the record changed.

Routes, all `@Can()` with the permission checked inside: `POST /v1/assistant/actions/:id/approve`, `POST /v1/assistant/actions/:id/reject`, `POST /v1/assistant/tool-calls/:id/undo`.

- [ ] **Step 1: Write the failing tests**

```ts
it("another user can't approve", ...);
it("can't approve twice: apply runs once", ...);
it("refuses after 24 hours", ...);
it("re-checks permission: a demoted user is refused", ...);
it("refuses while the card has missing fields, and accepts edits that fill them", ...);
it("a failed apply leaves the action pending", ...);
it("no tool can approve: approve isn't in the registry and proposing never applies", ...);
it("undo removes the update; undo refuses when the stage changed since", ...);
it("registering an action creates a deferred propose_ tool at approval level", ...);
it("propose_assign_project_staff shows current and new assignees and changes nothing before approval", ...);
```

- [ ] **Step 2: Implement.** Add `undo` to `add_project_update` (remove it), `create_task` (remove it) and `set_project_stage` (restore the previous values, only if `stage` still matches).

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter api test pending`
Expected: PASS.

- [ ] **Step 4: Commit**: `feat(api): approval cards and undo`

### Task 12.8: In-app chat

**Files:**
- Create:
  - `apps/web/actions/assistant.ts`
  - `apps/web/components/assistant/AssistantPanel.tsx`, `ChatMessage.tsx`, `ActionCard.tsx`
  - `apps/web/lib/useLiveEvents.ts`
- Modify:
  - `apps/api/src/assistant/assistant.controller.ts`, `packages/shared/src/dto.ts`, `packages/shared/src/schemas/assistant.ts`
  - `apps/web/app/(dashboard)/layout.tsx`, `apps/web/components/LiveRefresh.tsx` (use the hook)
- Test: `apps/api/src/assistant/assistant.controller.test.ts`

**Interfaces:**
- Consumes: Tasks 12.3, 12.6 and 12.7.
- Produces:
  - `POST /v1/assistant/messages` (`@Can()`, `@RateLimit(20)`): `{ projectId: objectId | null, text (1–4000), photos: uploadRef[] (max 5) }` → `{ conversationId }`
  - `GET /v1/assistant/conversation?projectId=` → `AssistantConversationDto`: `{ id, messages: { id, role: "user" | "assistant", text, photos, cards, tables, createdAt, status }[], busy: boolean }`. `tables` holds the `display` values from `query_records`.
  - One conversation per user and project in-app.

The DTO is built for display. It never exposes raw blocks, tool inputs or thinking.

- [ ] **Step 1: Write the failing test**

```ts
it("a user only ever gets their own conversation", ...);
it("the display DTO contains no thinking or tool_use blocks", ...);
it("photos must be real uploads in this organization", ...); // through claim()
```

- [ ] **Step 2: Implement the API, then run its tests**

Run: `pnpm --filter api test assistant.controller`
Expected: PASS.

- [ ] **Step 3: Build the panel.** A button in the dashboard layout opens a right-side panel available on every screen, showing the current project's conversation when opened from a project page. It has a text box, photo upload (existing presign flow, purpose `photos`), a busy state, action cards with Approve and Reject, and Undo on applied replies. `ActionCard` shows `changes` as current and new values. `ChatMessage` shows `tables` as plain tables, with no charts. `useLiveEvents` refetches on `kind: "assistant"`. Show the role's error when an action is refused.

- [ ] **Step 4: Check it.**

Run: `pnpm --filter web build; pnpm -r typecheck`
Expected: both succeed. Then, in the running app, as site staff: add an update to an assigned project, undo it, and ask about an unassigned project (the assistant can't find it).

- [ ] **Step 5: Commit**: `feat(web): assistant chat panel`

### Task 12.9: Updates tab and tasks screen

**Files:**
- Create: `apps/web/components/projects/UpdatesTab.tsx`, `apps/web/app/(dashboard)/tasks/page.tsx`, `apps/web/actions/tasks.ts`
- Modify: `apps/web/lib/projectQuery.ts` (`{ key: "updates", label: "Updates" }`), `apps/web/app/(dashboard)/projects/[id]/page.tsx`, `apps/web/components/NavBar.tsx`

Staff must be able to check and correct what the assistant did without WhatsApp.

- [ ] **Step 1: Build.** The Updates tab lists a project's updates: kind, text, photos, author, time and whether it came from the assistant. Anyone with `update:write` can add or delete one. The Tasks page lists the user's tasks with complete and delete, and a project's tasks appear on its tab.

- [ ] **Step 2: Check it.**

Run: `pnpm --filter web build`
Expected: succeeds. Then an update added through chat appears on the tab without a manual reload.

- [ ] **Step 3: Commit**: `feat(web): project updates tab and tasks screen`
