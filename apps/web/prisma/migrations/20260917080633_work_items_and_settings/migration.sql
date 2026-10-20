-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "companyName" TEXT NOT NULL DEFAULT 'Wawasan Interior Sdn Bhd',
    "companyReg" TEXT NOT NULL DEFAULT 'SST W10-1808-31000123',
    "companyAddress" TEXT NOT NULL DEFAULT 'Jalan Rimbayu, Bandar Rimbayu, Selangor',
    "companyPhone" TEXT NOT NULL DEFAULT '+60 3-1234 5678',
    "bankName" TEXT NOT NULL DEFAULT 'Maybank',
    "bankAccount" TEXT NOT NULL DEFAULT '5123 4567 8901',
    "defaultMarkupPct" INTEGER NOT NULL DEFAULT 40,
    "minMarginPct" INTEGER NOT NULL DEFAULT 20
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    CONSTRAINT "WorkItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "qtyUnit" TEXT NOT NULL,
    "estUnitCost" INTEGER NOT NULL,
    "estTotal" INTEGER NOT NULL,
    "performedBy" TEXT NOT NULL DEFAULT 'OUTSOURCED',
    "rfqStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
    CONSTRAINT "BomItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BomItem_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_BomItem" ("estTotal", "estUnitCost", "id", "projectId", "qtyUnit", "rfqStatus", "seq", "workPackage") SELECT "estTotal", "estUnitCost", "id", "projectId", "qtyUnit", "rfqStatus", "seq", "workPackage" FROM "BomItem";
DROP TABLE "BomItem";
ALTER TABLE "new_BomItem" RENAME TO "BomItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
