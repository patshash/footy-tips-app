-- AlterTable
ALTER TABLE "Fixture" ADD COLUMN "awayOdds" REAL;
ALTER TABLE "Fixture" ADD COLUMN "crowd" INTEGER;
ALTER TABLE "Fixture" ADD COLUMN "halftimeAway" INTEGER;
ALTER TABLE "Fixture" ADD COLUMN "halftimeHome" INTEGER;
ALTER TABLE "Fixture" ADD COLUMN "homeOdds" REAL;
ALTER TABLE "Fixture" ADD COLUMN "matchCentreUrl" TEXT;
ALTER TABLE "Fixture" ADD COLUMN "venueCity" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LadderEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "byes" INTEGER NOT NULL DEFAULT 0,
    "pointsFor" INTEGER NOT NULL DEFAULT 0,
    "pointsAgainst" INTEGER NOT NULL DEFAULT 0,
    "pointsDiff" INTEGER NOT NULL DEFAULT 0,
    "competitionPoints" INTEGER NOT NULL DEFAULT 0,
    "homeRecord" TEXT,
    "awayRecord" TEXT,
    "streak" TEXT,
    "form" TEXT,
    "avgWinMargin" REAL,
    "avgLoseMargin" REAL,
    "titleOdds" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LadderEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_LadderEntry" ("competitionPoints", "createdAt", "draws", "id", "losses", "played", "pointsAgainst", "pointsDiff", "pointsFor", "position", "round", "season", "teamId", "wins") SELECT "competitionPoints", "createdAt", "draws", "id", "losses", "played", "pointsAgainst", "pointsDiff", "pointsFor", "position", "round", "season", "teamId", "wins" FROM "LadderEntry";
DROP TABLE "LadderEntry";
ALTER TABLE "new_LadderEntry" RENAME TO "LadderEntry";
CREATE UNIQUE INDEX "LadderEntry_teamId_season_round_key" ON "LadderEntry"("teamId", "season", "round");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
