# Veenix: test copy

Veenix runs on your own computer. Nothing is uploaded anywhere, and the data you
enter stays on your machine. This copy comes with **sample data** so there is
something to click through.

## 1. One-time setup (about 10 minutes)

1. **Install Node.js** (version 20 or newer, the "LTS" download) from https://nodejs.org
   and finish the installer. Restart your computer if it asks you to.
2. **Unzip** this folder somewhere easy, for example your Desktop.
3. **Open a terminal inside the folder.**
   - Mac: open the *Terminal* app, type `cd ` (with a space), drag the unzipped
     `Veenix` folder into the window, press Enter.
   - Windows: open the folder in File Explorer, click the address bar, type
     `powershell`, press Enter.
4. Run these two commands, one at a time. The first takes a few minutes and
   needs internet.

```
npm install
npx prisma generate
```

## 2. Start the app (every time)

```
npm run dev
```

Wait until it says **Ready**, then open **http://localhost:3100** in your browser.
Leave the terminal window open while you use the app. Press `Ctrl + C` in it to stop.

If it says the port is in use, close whatever else is using it, or run
`npx next dev -p 3200` and open http://localhost:3200 instead.

## 3. Resetting the data

| You want | Run this (app stopped) |
|---|---|
| Back to the sample data | `npx prisma migrate reset --force` |
| A completely empty app | `npx prisma migrate reset --force --skip-seed` |

Both commands **delete everything you entered**, so use them only when you mean to.

## 4. What to try (a good first pass, about 30 minutes)

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

## 5. Things that are not finished yet (so you don't report them as bugs)

- **There is no login.** Anyone who can open the address can see and change the
  data. Do not put this on a public website.
- The **client signing link is simulated:** you record what the client did using the
  buttons on the quotation.
- **LHDN MyInvois e-invoicing is simulated:** invoices show a validated badge, but
  nothing is sent to LHDN.
- The DuitNow, FPX and bank transfer icons on invoices are informational only.
- There are no user accounts or permissions, and no email or WhatsApp sending.
- The search box at the top right is not connected to anything yet.
- Data lives in one file, `prisma/dev.db`. To keep a backup, copy that file.
