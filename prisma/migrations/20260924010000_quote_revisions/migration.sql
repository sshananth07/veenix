-- CreateTable
CREATE TABLE "RfqQuoteRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quoteId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "quotedPrice" INTEGER NOT NULL,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "attachmentPath" TEXT,
    "attachmentName" TEXT,
    "receivedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RfqQuoteRevision_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "RfqVendorQuote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

