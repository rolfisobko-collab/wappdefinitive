-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AIConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'default',
    "systemPrompt" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'llama-3.3-70b-versatile',
    "temperature" REAL NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER NOT NULL DEFAULT 500,
    "includeProducts" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "groqApiKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AIConfig" ("active", "createdAt", "id", "includeProducts", "maxTokens", "model", "name", "systemPrompt", "temperature", "updatedAt") SELECT "active", "createdAt", "id", "includeProducts", "maxTokens", "model", "name", "systemPrompt", "temperature", "updatedAt" FROM "AIConfig";
DROP TABLE "AIConfig";
ALTER TABLE "new_AIConfig" RENAME TO "AIConfig";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
