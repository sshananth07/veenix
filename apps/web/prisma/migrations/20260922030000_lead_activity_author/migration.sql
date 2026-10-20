-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LeadActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'You',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_LeadActivity" ("createdAt", "id", "leadId", "note") SELECT "createdAt", "id", "leadId", "note" FROM "LeadActivity";
DROP TABLE "LeadActivity";
ALTER TABLE "new_LeadActivity" RENAME TO "LeadActivity";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

