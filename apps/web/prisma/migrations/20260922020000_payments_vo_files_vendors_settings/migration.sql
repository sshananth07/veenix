-- AlterTable
ALTER TABLE "VariationOrder" ADD COLUMN "attachmentName" TEXT;
ALTER TABLE "VariationOrder" ADD COLUMN "attachmentPath" TEXT;
ALTER TABLE "VariationOrder" ADD COLUMN "reason" TEXT;
ALTER TABLE "VariationOrder" ADD COLUMN "title" TEXT;

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "companyName" TEXT NOT NULL DEFAULT 'Wawasan Interior Sdn Bhd',
    "companyReg" TEXT NOT NULL DEFAULT 'SST W10-1808-31000123',
    "companyAddress" TEXT NOT NULL DEFAULT 'Jalan Rimbayu, Bandar Rimbayu, Selangor',
    "companyPhone" TEXT NOT NULL DEFAULT '+60 3-1234 5678',
    "bankName" TEXT NOT NULL DEFAULT 'Maybank',
    "bankAccountName" TEXT NOT NULL DEFAULT 'Wawasan Interior Sdn Bhd',
    "bankAccount" TEXT NOT NULL DEFAULT '5123 4567 8901',
    "swiftCode" TEXT,
    "logoPath" TEXT,
    "defaultMarkupPct" INTEGER NOT NULL DEFAULT 40,
    "minMarkupPct" INTEGER NOT NULL DEFAULT 20
);
INSERT INTO "new_Settings" ("bankAccount", "bankName", "companyAddress", "companyName", "companyPhone", "companyReg", "defaultMarkupPct", "id", "minMarkupPct") SELECT "bankAccount", "bankName", "companyAddress", "companyName", "companyPhone", "companyReg", "defaultMarkupPct", "id", "minMarkupPct" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
CREATE TABLE "new_Vendor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "registrationNo" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "location" TEXT,
    "experienceYears" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "jobsCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT
);
INSERT INTO "new_Vendor" ("id", "jobsCount", "name", "notes", "type") SELECT "id", "jobsCount", "name", "notes", "type" FROM "Vendor";
DROP TABLE "Vendor";
ALTER TABLE "new_Vendor" RENAME TO "Vendor";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

