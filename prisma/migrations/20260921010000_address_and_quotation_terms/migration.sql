-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "Lead" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "Lead" ADD COLUMN "addressLine3" TEXT;
ALTER TABLE "Lead" ADD COLUMN "city" TEXT;
ALTER TABLE "Lead" ADD COLUMN "postcode" TEXT;
ALTER TABLE "Lead" ADD COLUMN "state" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "addressLine1" TEXT;
ALTER TABLE "Project" ADD COLUMN "addressLine2" TEXT;
ALTER TABLE "Project" ADD COLUMN "addressLine3" TEXT;
ALTER TABLE "Project" ADD COLUMN "city" TEXT;
ALTER TABLE "Project" ADD COLUMN "postcode" TEXT;
ALTER TABLE "Project" ADD COLUMN "state" TEXT;

-- CreateTable
CREATE TABLE "QuotationTerm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quotationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "pct" INTEGER NOT NULL,
    CONSTRAINT "QuotationTerm_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);


-- Signed quotations that already have a client payment schedule carry it as
-- their payment terms, so what was agreed is visible on the quotation too.
INSERT INTO "QuotationTerm" ("id", "quotationId", "seq", "name", "trigger", "pct")
SELECT lower(hex(randomblob(12))), q."id", m."seq", m."name", m."trigger", m."pct"
FROM "PaymentMilestone" m
JOIN "Quotation" q ON q."projectId" = m."projectId" AND q."status" = 'ACCEPTED'
WHERE m."pct" IS NOT NULL;
