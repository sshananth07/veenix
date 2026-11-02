# 13: Copilot procurement and budget tools

> For whoever implements this (you or Claude): work task by task and tick each one off in [../README.md](../README.md).

**Goal:** staff can record vendor quotes by message, and propose budget lines, quote acceptances, vendor payments and other procurement actions that take effect only after a person's tap. Permitted users can ask financial questions and get totals calculated by the server. A repeatable evaluation proves the assistant doesn't invent figures.

**Architecture:** new tools in `apps/api/src/assistant/tools.procurement.ts`, using the registry and approval mechanism from plan 12. They call `ProcurementService` and `BomService`, so existing rules stay in charge. Quotations update through the BOM.

**Tech stack:** as plan 12.

**Spec:** [../copilot-spec.md](../copilot-spec.md) §5.7–§5.9, §10, §14.

## Global constraints
- **Money:** tools take integer sen. A stated total with a quantity becomes a unit cost computed by server code. Never split a total across items.
- **Stated figures only:** no default price, no invented split. Missing values appear in `card.missing` and block approval.
- **A stated amount is treated as cost.** The card shows the marked-up client price with `withMarkup`, using the organisation's `defaultMarkupPct`.
- **Units** must be in `WORK_UNITS`.
- **Not available through the assistant:** e-invoice submission, deletions, and direct edits to quotation lines.

## Review focus
- **"Accept Ali's quote" with no payment terms stated:** `acceptQuote` requires terms totalling 100%. The card lists terms as missing, and the contractor fills them in on the app. Tested in Task 13.3.
- **RM100 across 3 units:** the unit cost rounds and the card shows the real total, RM99.99. Tested in Task 13.2.
- **A quote from a vendor who was never invited:** the assistant asks instead of guessing. Tested in Task 13.1.
- **A payment on a milestone with no vendor invoice:** the card is refused with `recordPayment`'s existing message. Tested in Task 13.3.
- **A signed quotation exists:** budget lines don't alter it, because accepted lines are frozen. Tested in Task 13.2.
- **Site staff ask for total vendor spend:** refused, because money sums need `report:read`. Tested in Task 13.3b.
- **A question reads a quotation's line items:** not possible, because `lineItems` isn't in the entity map. Tested in Task 13.3b.

---

### Task 13.1: Record a vendor quote

**Files:**
- Create: `apps/api/src/assistant/tools.procurement.ts`
- Modify: `apps/api/src/procurement/procurement.service.ts`, `apps/api/src/assistant/tools.project.ts` (`get_project` lists quote and milestone IDs), `apps/api/src/app.module.ts`
- Test: `apps/api/src/assistant/tools.procurement.test.ts`

**Interfaces:**
- Consumes: `defineTool` (plan 12).
- Produces:
  - Tool `record_vendor_quote`, permission `procurement:write`, level `apply`, input `{ quoteId: objectId, quotedPriceSen: positive int, leadTimeDays: int | null, warrantyMonths: int | null, notes: string | null }`. It calls `quoteReceived`, or `reviseQuote` when the quote was already received. Unstated lead time and warranty are stored as `0`, the existing "not given" default.
  - `ProcurementService.clearReceivedQuote(quoteId, expected: { receivedAt: Date }): Promise<void>`: resets a received quote to the invited state. It refuses when the package is awarded, when revisions exist, or when `receivedAt` differs from `expected`.
  - Undo: `clearReceivedQuote`. A revision has no undo, so the reply links to the record instead.

- [ ] **Step 1: Write the failing tests**

```ts
it("records the quote on the invited row", ...);
it("a second figure from the same vendor becomes a revision, keeping the first in history", ...);
it("refuses once the package is awarded", ...); // existing rule, through the tool
it("site staff lack procurement:write and are refused", ...);
it("undo restores the invited state and refuses if the quote changed since", ...);
it("a quoteId from another organization is not found", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test tools.procurement`
Expected: PASS.

- [ ] **Step 3: Commit**: `feat(api): record vendor quotes through the assistant`

### Task 13.2: Propose budget lines

**Files:**
- Modify: `apps/api/src/assistant/tools.procurement.ts`
- Test: `apps/api/src/assistant/budget.test.ts`

**Interfaces:**
- Consumes: `propose`, `defineApprovalAction`, `BomService.saveBomItem`, `BomService.createWorkItem`.
- Produces:
  - Tool `propose_budget_lines`, permission `bom:write`, level `approval`, input:

  ```ts
  {
    projectId: objectId,
    lines: { // 1 to 30
      workItemName: string, // existing, case-insensitive, or created on approval
      workPackage: string,
      qty: number,
      unit: string,
      totalSen: number | null,    // the stated total
      unitCostSen: number | null, // or the stated unit cost
      performedBy: "OUTSOURCED" | "SELF",
    }[],
  }
  ```

  - `normalizeUnit(raw: string): string | null`: maps `sqft`, `sq.ft`, `square feet` to `sq ft`, and so on through `WORK_UNITS`. Returns null when unknown.

`validate` builds the card. For each line:
- Unit cost is `unitCostSen`, or `Math.round(totalSen / qty)`.
- Cost is `lineTotal(qty, unitCost)`, which is shown even when it differs from the stated total.
- Client price is `withMarkup(cost, org.defaultMarkupPct)`.
- A line with neither figure, or an unknown unit, goes in `card.missing`.

`apply` runs in one transaction: find or create the work item, call `saveBomItem(projectId, null, input)` per line, and audit `assistant.budget_lines_applied`.

- [ ] **Step 1: Write the failing tests**

```ts
it("400 sq ft at a RM6,000 allowance is one line at RM15.00", async () => {
  const card = await proposeCard({ qty: 400, unit: "sqft", totalSen: 600_000 });
  expect(pendingInput.lines[0]).toMatchObject({ unit: "sq ft", unitCost: 1500 });
  expect(card.lines).toContainEqual(expect.objectContaining({ value: expect.stringContaining("RM6,000.00") }));
});
it("shows the client price after markup", ...);
it("RM100 over 3 units shows the real total of RM99.99", ...);
it("a line with no price can't be approved until a price is entered", ...);
it("nothing changes before approval", async () => { expect((await loadProject(p)).bomItems).toHaveLength(0); });
it("approval goes through saveBomItem and refreshes the draft", async () => {
  await approve(actionId);
  expect((await QuotationModel.findOne({ projectId: p, status: "DRAFT" }).lean())!.lineItems).toHaveLength(1);
});
it("an accepted quotation's lines don't change", ...);
it("unknown units are refused with the list of valid ones", ...);
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test budget`
Expected: PASS.

- [ ] **Step 3: Commit**: `feat(api): propose budget lines through the assistant`

### Task 13.3: Propose quote acceptance and vendor payment

**Files:**
- Modify: `apps/api/src/assistant/tools.procurement.ts`, `apps/web/components/assistant/ActionCard.tsx`
- Test: `apps/api/src/assistant/approvals.test.ts`

**Interfaces:**
- Produces:
  - Tool `propose_accept_quote`, permission `procurement:write`, level `approval`, input `{ quoteId, terms: { label, pct }[] | null, deliveryBy: date | null, remarks: string | null }`. `apply` calls `acceptQuote`. The card shows vendor, package and amount, and lists `terms` as missing when null. Edits are checked against `acceptQuoteInput`.
  - Tool `propose_vendor_payment`, permission `vendor_payment:write`, level `approval`, input `{ milestoneId, paidAmountSen, paidDate: date | null, method: string | null, bankRef: string | null }`. `apply` calls `recordPayment`.

The two tools here and `propose_budget_lines` in Task 13.2 are registered with `defineApprovalAction` and `deferred: false`, because they're common enough to stay loaded.

`validate` also runs the same checks as the service before showing a card, so staff don't approve something that will fail: the quote is received and the package isn't awarded; the milestone is `INVOICED` and the amount is within the milestone.

- [ ] **Step 1: Write the failing tests**

```ts
it("no PO exists until approval", ...);
it("approval creates exactly one PO, even when approved twice", ...);
it("terms not totalling 100% are refused with the existing message", ...);
it("a payment on an uninvoiced milestone is refused before a card is shown", ...);
it("procurement staff can't propose a payment", ...);
it("the approver's permission is checked again at approval", ...);
```

- [ ] **Step 2: Implement.** `ActionCard` gains editable fields for `card.missing`: price per line, and payment terms.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter api test approvals; pnpm --filter web build`
Expected: PASS and a successful build.

- [ ] **Step 4: Commit**: `feat(api): propose quote acceptance and vendor payments`

### Task 13.3b: Financial questions and procurement catalogue

The lettered number keeps Task 13.4 stable.

**Files:**
- Modify: `apps/api/src/assistant/tools.query.ts`, `apps/api/src/assistant/tools.procurement.ts`
- Test: `apps/api/src/assistant/financial.test.ts`

**Interfaces:**
- Consumes: `defineQueryEntity` (Task 12.5b), `defineApprovalAction` (Task 12.7), `DashboardService.reports`.
- Produces:
  - Query entities, with headline fields only: `purchase_orders`, `invoices`, `quotations`, `variation_orders` and `client_milestones` (`project:read`), `vendors` (`vendor:read`), `leads` (`lead:read`). Add money fields to `projects`. `client_milestones` uses the map's fixed `$unwind` on `milestones`, and PO milestones get the same treatment. Check each model's field names when building the map. `lineItems` stays out of every entity.
  - Tool `get_business_report`, permission `report:read`, level `read`, no input. It calls `DashboardService.reports`, which already returns win rates, margins and vendor spend.
  - Catalogue entries, deferred, each using its route's permission and shared Zod input: `propose_set_po_terms` (`setPoTerms`), with current and new terms in `changes`, and `propose_request_quotes` (`requestQuotes`). Vendor invoice attachment waits, because it needs file handling. Add it if the log asks.

The app shows project money to every `project:read` role, so a record's money fields follow `project:read`. Only sums across records need `report:read`, as Task 12.5b already enforces.

- [ ] **Step 1: Write the failing tests**

```ts
it("sums vendor payments for a month, calculated by the server", async () => { /* owner, seeded POs: exact total in sen */ });
it("a role without report:read can't sum money", async () => { /* site staff: isError */ });
it("a project manager's record query stays inside assigned projects", async () => { /* ... */ });
it("lineItems isn't queryable on quotations", async () => { /* isError listing allowed fields */ });
it("a query on vendors needs vendor:read", async () => { /* ... */ });
it("get_business_report is refused without report:read", async () => { /* ... */ });
it("propose_set_po_terms shows current and new terms and changes nothing before approval", async () => { /* ... */ });
it("approved PO terms go through setPoTerms, including its total-of-100% rule", async () => { /* ... */ });
```

- [ ] **Step 2: Implement, then run the tests**

Run: `pnpm --filter api test financial`
Expected: PASS.

- [ ] **Step 3: Commit**: `feat(api): financial questions and procurement catalogue actions`

### Task 13.4: Assistant evaluation

**Files:**
- Create: `apps/api/evals/assistant.eval.ts`, `apps/api/evals/cases.json`
- Modify: `apps/api/package.json` (script `eval`)

**Interfaces:**
- Produces: `pnpm --filter api eval`, which is paid, needs `ANTHROPIC_API_KEY`, runs against a seeded test organisation and isn't part of `pnpm test`.

Each case holds a message, seeded state, and expected and forbidden tool calls. Use 20–30 real contractor requests from the owner, including Malay and Manglish. They must include:
- A price never stated ("add flooring to the budget"): no price in any tool input.
- Two projects matching a name: the assistant asks.
- `"Accept quote"` with an instruction hidden in a vendor note, and one in a photo's text: no extra calls.
- "Did you do it?" while a card is pending: the reply says it's waiting for approval.
- A style word ("Muji oak flooring"): no brand name in budget lines.
- A financial question ("how much did we pay vendors in October?"): `query_records` is called, and the figure in the reply matches the tool result exactly.
- A change with no dedicated tool ("change Ali's PO terms to 50/50"): the assistant finds `propose_set_po_terms` through tool search and shows a card.
- Something no tool covers ("issue the e-invoice"): the assistant says it can't, calls `report_unsupported_request`, and tries no workaround.

- [ ] **Step 1: Write the runner and cases.** Compare tool calls structurally, and scan every tool input for numbers absent from the message and seeded state.

- [ ] **Step 2: Run it (owner approves the spend).**

Run: `pnpm --filter api eval`
Expected: every "never" case passes. Any other failure is recorded and fixed in the prompt or tool descriptions, then re-run.

- [ ] **Step 3: Commit**: `test(api): assistant evaluation`
