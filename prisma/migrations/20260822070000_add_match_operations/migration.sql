CREATE TYPE "MatchRule" AS ENUM ('AREA', 'YAGURA', 'HOKO', 'ASARI');
CREATE TYPE "StageSelectionMode" AS ENUM ('ADMIN', 'RANDOM');

CREATE TABLE "TournamentStage" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentStage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TournamentPhase" ADD COLUMN "rule" "MatchRule" NOT NULL DEFAULT 'AREA';
ALTER TABLE "TournamentPhase" ADD COLUMN "stageSelectionMode" "StageSelectionMode" NOT NULL DEFAULT 'RANDOM';
ALTER TABLE "TournamentPhase" ADD COLUMN "defaultStageId" TEXT;

ALTER TABLE "Match" ADD COLUMN "matchNumber" INTEGER;
ALTER TABLE "Match" ADD COLUMN "rule" "MatchRule" NOT NULL DEFAULT 'AREA';
ALTER TABLE "Match" ADD COLUMN "stageId" TEXT;
ALTER TABLE "Match" ADD COLUMN "stageName" TEXT;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "phaseId" ORDER BY "createdAt", "id") AS rn
  FROM "Match"
)
UPDATE "Match"
SET "matchNumber" = numbered.rn
FROM numbered
WHERE "Match"."id" = numbered."id";

CREATE UNIQUE INDEX "TournamentStage_tournamentId_name_key" ON "TournamentStage"("tournamentId", "name");
CREATE UNIQUE INDEX "TournamentStage_tournamentId_sortOrder_key" ON "TournamentStage"("tournamentId", "sortOrder");
CREATE INDEX "TournamentStage_tournamentId_isActive_idx" ON "TournamentStage"("tournamentId", "isActive");
CREATE INDEX "TournamentPhase_defaultStageId_idx" ON "TournamentPhase"("defaultStageId");
CREATE UNIQUE INDEX "Match_phaseId_matchNumber_key" ON "Match"("phaseId", "matchNumber");
CREATE INDEX "Match_stageId_idx" ON "Match"("stageId");

ALTER TABLE "TournamentStage"
ADD CONSTRAINT "TournamentStage_tournamentId_fkey"
FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentPhase"
ADD CONSTRAINT "TournamentPhase_defaultStageId_fkey"
FOREIGN KEY ("defaultStageId") REFERENCES "TournamentStage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Match"
ADD CONSTRAINT "Match_stageId_fkey"
FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
