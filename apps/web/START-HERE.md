# Veenix: test copy

Veenix runs on your own computer: the web app, the API and the services they use
(MongoDB, file storage, an email catcher) all run locally. Each person signs in
with their own account and two-step verification.

## 1. Setup

1. Install Node 24, pnpm 10 and Docker Desktop.
2. pnpm install
3. pnpm services:up
4. pnpm --filter api storage:init && pnpm --filter api db:indexes
5. pnpm dev   (web on http://localhost:3100, API on http://localhost:4000)
6. Sign up at http://localhost:3100/signup. Emails arrive at http://localhost:8025.

## 2. What to try (a good first pass, about 30 minutes)

1. **Leads:** add a lead with a Malaysian address, then convert it to a project.
2. **Work & BOM:** add a work item, then add one *self-performed* line (labour +
   materials) and one *outsourced* line. Check the totals make sense.
3. **Vendors:** request quotes from two or three vendors, download the RFQ PDF,
   record each quote (try "Revised quote" on one), then **Accept quote** and set the
   payment terms.
4. **Quotation:** create the quotation, set payment terms, send it, then use
   *Client has a question* and *Log our reply* a few times, and finally *Client signed*.
5. **Payments & Invoices:** generate an invoice for the first payment and mark it paid.
6. **Variation Orders:** raise one after signing and take it through to signed.
7. **Files, Vendors, Reports, Settings:** upload a file, open a vendor page, look at
   the reports, and change the letterhead.

While testing, note anything that is **confusing, missing, or slow**, and any
number that looks wrong. Screenshots help a lot.

## 3. Things that are not finished yet (so you don't report them as bugs)

- The **client signing link is simulated:** you record what the client did using the
  buttons on the quotation.
- **LHDN MyInvois e-invoicing is not connected yet:** nothing is sent to LHDN.
- The DuitNow, FPX and bank transfer icons on invoices are informational only.
- Data lives in the local MongoDB and file storage that `pnpm services:up` starts
  (Docker). Uploaded files go straight to that storage, not an `uploads` folder.
