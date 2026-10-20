-- CreateTable
CREATE TABLE "PoMilestone" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "poId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "pct" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "invoiceNo" TEXT,
    "invoiceDate" DATETIME,
    "invoicePath" TEXT,
    "invoiceName" TEXT,
    "paidAmount" INTEGER,
    "paidDate" DATETIME,
    "method" TEXT,
    "bankRef" TEXT,
    "paidFrom" TEXT,
    CONSTRAINT "PoMilestone_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Carry existing vendor claims + payments across as PO payment milestones.
INSERT INTO "PoMilestone" ("id", "poId", "seq", "label", "pct", "amount", "status", "paidAmount", "paidDate", "method", "bankRef", "paidFrom")
SELECT
    'pm_' || c."id",
    c."poId",
    (SELECT COUNT(*) FROM "VendorClaim" c2 WHERE c2."poId" = c."poId" AND c2."rowid" <= c."rowid"),
    'Payment ' || (SELECT COUNT(*) FROM "VendorClaim" c2 WHERE c2."poId" = c."poId" AND c2."rowid" <= c."rowid"),
    c."claimedPct",
    COALESCE(p."amount", c."verifiedAmount", c."claimedAmount"),
    CASE WHEN p."id" IS NOT NULL THEN 'PAID' WHEN c."status" = 'APPROVED' THEN 'INVOICED' ELSE 'PENDING' END,
    p."amount",
    p."paymentDate",
    p."method",
    p."bankRef",
    p."paidFrom"
FROM "VendorClaim" c
LEFT JOIN "VendorPayment" p ON p."claimId" = c."id";

-- DropIndex
DROP INDEX "VendorClaim_code_key";

-- DropIndex
DROP INDEX "VendorPayment_claimId_key";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "budgetMax" INTEGER;
ALTER TABLE "Project" ADD COLUMN "budgetMin" INTEGER;
ALTER TABLE "Project" ADD COLUMN "builtUpArea" TEXT;
ALTER TABLE "Project" ADD COLUMN "campaign" TEXT;
ALTER TABLE "Project" ADD COLUMN "clientEmail" TEXT;
ALTER TABLE "Project" ADD COLUMN "clientPhone" TEXT;
ALTER TABLE "Project" ADD COLUMN "surveyAt" DATETIME;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "VendorClaim";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "VendorPayment";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "BomMaterial" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bomItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "qty" REAL NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'nos',
    "unitCost" REAL NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BomMaterial_bomItemId_fkey" FOREIGN KEY ("bomItemId") REFERENCES "BomItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BomItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "workItemId" TEXT,
    "seq" INTEGER NOT NULL,
    "workPackage" TEXT NOT NULL,
    "description" TEXT,
    "qty" REAL NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'lot',
    "unitCost" REAL NOT NULL DEFAULT 0,
    "estTotal" INTEGER NOT NULL DEFAULT 0,
    "performedBy" TEXT NOT NULL DEFAULT 'OUTSOURCED',
    CONSTRAINT "BomItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BomItem_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Old qtyUnit was free text ("1,850 sq ft"): split it into a number and a unit,
-- and back-solve the unit cost so the existing totals do not change.
INSERT INTO "new_BomItem" ("id", "projectId", "workItemId", "seq", "workPackage", "description", "qty", "unit", "unitCost", "estTotal", "performedBy")
SELECT "id", "projectId", "workItemId", "seq", "workPackage", NULL, "q",
       CASE WHEN "u" = '' THEN 'lot' ELSE "u" END,
       CAST("estTotal" AS REAL) / "q",
       "estTotal", "performedBy"
FROM (
    SELECT b.*,
           CASE WHEN CAST(REPLACE(b."qtyUnit", ',', '') AS REAL) > 0 THEN CAST(REPLACE(b."qtyUnit", ',', '') AS REAL) ELSE 1 END AS "q",
           TRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(b."qtyUnit",
               '0', ''), '1', ''), '2', ''), '3', ''), '4', ''), '5', ''), '6', ''), '7', ''), '8', ''), '9', ''), ',', ''), '.', '')) AS "u"
    FROM "BomItem" b
);
DROP TABLE "BomItem";
ALTER TABLE "new_BomItem" RENAME TO "BomItem";
CREATE TABLE "new_PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "rfqId" TEXT,
    "vendorId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "qty" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryBy" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    CONSTRAINT "PurchaseOrder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrder" ("amount", "code", "deliveryBy", "description", "id", "issueDate", "projectId", "qty", "rfqId", "status", "vendorId") SELECT "amount", "code", "deliveryBy", "description", "id", "issueDate", "projectId", "qty", "rfqId", "status", "vendorId" FROM "PurchaseOrder";
DROP TABLE "PurchaseOrder";
ALTER TABLE "new_PurchaseOrder" RENAME TO "PurchaseOrder";
CREATE UNIQUE INDEX "PurchaseOrder_code_key" ON "PurchaseOrder"("code");
CREATE TABLE "new_Quotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    "viewedAt" DATETIME,
    "acceptedAt" DATETIME,
    "signedBy" TEXT,
    CONSTRAINT "Quotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Quotation" ("acceptedAt", "code", "id", "projectId", "revision", "sentAt", "signedBy", "status", "viewedAt") SELECT "acceptedAt", "code", "id", "projectId", "revision", "sentAt", "signedBy", "status", "viewedAt" FROM "Quotation";
DROP TABLE "Quotation";
ALTER TABLE "new_Quotation" RENAME TO "Quotation";
CREATE UNIQUE INDEX "Quotation_code_key" ON "Quotation"("code");
CREATE UNIQUE INDEX "Quotation_projectId_revision_key" ON "Quotation"("projectId", "revision");
CREATE TABLE "new_QuotationLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quotationId" TEXT NOT NULL,
    "bomItemId" TEXT,
    "workItemName" TEXT,
    "workPackage" TEXT NOT NULL,
    "qty" REAL NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'lot',
    "bomCost" INTEGER NOT NULL,
    "markupPct" INTEGER NOT NULL,
    "clientPrice" INTEGER NOT NULL,
    "seq" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "QuotationLineItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuotationLineItem_bomItemId_fkey" FOREIGN KEY ("bomItemId") REFERENCES "BomItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Snapshot the work item name / qty / unit of the linked BOM line onto each existing quotation line.
INSERT INTO "new_QuotationLineItem" ("id", "quotationId", "bomItemId", "workItemName", "workPackage", "qty", "unit", "bomCost", "markupPct", "clientPrice", "seq")
SELECT l."id", l."quotationId", l."bomItemId",
       (SELECT w."name" FROM "BomItem" b JOIN "WorkItem" w ON w."id" = b."workItemId" WHERE b."id" = l."bomItemId"),
       l."workPackage",
       COALESCE((SELECT b."qty" FROM "BomItem" b WHERE b."id" = l."bomItemId"), 1),
       COALESCE((SELECT b."unit" FROM "BomItem" b WHERE b."id" = l."bomItemId"), 'lot'),
       l."bomCost", l."markupPct", l."clientPrice",
       (SELECT COUNT(*) FROM "QuotationLineItem" l2 WHERE l2."quotationId" = l."quotationId" AND l2."rowid" <= l."rowid")
FROM "QuotationLineItem" l;
DROP TABLE "QuotationLineItem";
ALTER TABLE "new_QuotationLineItem" RENAME TO "QuotationLineItem";
CREATE TABLE "new_Rfq" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "bomItemId" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "respondBy" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rfq_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rfq_bomItemId_fkey" FOREIGN KEY ("bomItemId") REFERENCES "BomItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Rfq" ("bomItemId", "code", "createdAt", "id", "note", "projectId", "quantity", "respondBy") SELECT "bomItemId", "code", "createdAt", "id", "note", "projectId", "quantity", "respondBy" FROM "Rfq";
DROP TABLE "Rfq";
ALTER TABLE "new_Rfq" RENAME TO "Rfq";
CREATE UNIQUE INDEX "Rfq_code_key" ON "Rfq"("code");
CREATE TABLE "new_RfqVendorQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rfqId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" DATETIME,
    "quotedPrice" INTEGER NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "attachmentPath" TEXT,
    "attachmentName" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RfqVendorQuote_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "Rfq" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RfqVendorQuote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RfqVendorQuote" ("id", "leadTimeDays", "notes", "quotedPrice", "receivedAt", "rfqId", "selected", "vendorId", "warrantyMonths")
SELECT "id", "leadTimeDays", "notes", "quotedPrice", CASE WHEN "quotedPrice" > 0 THEN CURRENT_TIMESTAMP ELSE NULL END, "rfqId", "selected", "vendorId", "warrantyMonths" FROM "RfqVendorQuote";
DROP TABLE "RfqVendorQuote";
ALTER TABLE "new_RfqVendorQuote" RENAME TO "RfqVendorQuote";
CREATE UNIQUE INDEX "RfqVendorQuote_rfqId_vendorId_key" ON "RfqVendorQuote"("rfqId", "vendorId");
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "companyName" TEXT NOT NULL DEFAULT 'Wawasan Interior Sdn Bhd',
    "companyReg" TEXT NOT NULL DEFAULT 'SST W10-1808-31000123',
    "companyAddress" TEXT NOT NULL DEFAULT 'Jalan Rimbayu, Bandar Rimbayu, Selangor',
    "companyPhone" TEXT NOT NULL DEFAULT '+60 3-1234 5678',
    "bankName" TEXT NOT NULL DEFAULT 'Maybank',
    "bankAccount" TEXT NOT NULL DEFAULT '5123 4567 8901',
    "defaultMarkupPct" INTEGER NOT NULL DEFAULT 40,
    "minMarkupPct" INTEGER NOT NULL DEFAULT 20
);
INSERT INTO "new_Settings" ("bankAccount", "bankName", "companyAddress", "companyName", "companyPhone", "companyReg", "defaultMarkupPct", "id", "minMarkupPct") SELECT "bankAccount", "bankName", "companyAddress", "companyName", "companyPhone", "companyReg", "defaultMarkupPct", "id", "minMarginPct" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
