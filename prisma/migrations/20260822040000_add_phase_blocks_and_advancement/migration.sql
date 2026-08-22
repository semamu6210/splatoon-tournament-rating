CREATE TYPE "AdvancementMode" AS ENUM ('OVERALL', 'BLOCK');

ALTER TABLE "TournamentPhase" ADD COLUMN "advancementMode" "AdvancementMode" NOT NULL DEFAULT 'OVERALL';

CREATE TABLE "TournamentPhaseParticipant" (
  "id" TEXT NOT NULL,
  "phaseId" TEXT NOT NULL,
  "tournamentParticipantId" TEXT NOT NULL,
  "isEligible" BOOLEAN NOT NULL DEFAULT true,
  "isAdvancing" BOOLEAN NOT NULL DEFAULT false,
  "advancedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentPhaseParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentBlock" (
  "id" TEXT NOT NULL,
  "phaseId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentBlock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentBlockParticipant" (
  "id" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "phaseId" TEXT NOT NULL,
  "tournamentParticipantId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TournamentBlockParticipant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentPhaseParticipant_phaseId_tournamentParticipantId_key"
ON "TournamentPhaseParticipant"("phaseId", "tournamentParticipantId");

CREATE INDEX "TournamentPhaseParticipant_phaseId_isEligible_idx"
ON "TournamentPhaseParticipant"("phaseId", "isEligible");

CREATE INDEX "TournamentPhaseParticipant_phaseId_isAdvancing_idx"
ON "TournamentPhaseParticipant"("phaseId", "isAdvancing");

CREATE INDEX "TournamentPhaseParticipant_tournamentParticipantId_idx"
ON "TournamentPhaseParticipant"("tournamentParticipantId");

CREATE UNIQUE INDEX "TournamentBlock_phaseId_name_key"
ON "TournamentBlock"("phaseId", "name");

CREATE UNIQUE INDEX "TournamentBlock_phaseId_sortOrder_key"
ON "TournamentBlock"("phaseId", "sortOrder");

CREATE INDEX "TournamentBlock_phaseId_idx"
ON "TournamentBlock"("phaseId");

CREATE UNIQUE INDEX "TournamentBlockParticipant_blockId_tournamentParticipantId_key"
ON "TournamentBlockParticipant"("blockId", "tournamentParticipantId");

CREATE UNIQUE INDEX "TournamentBlockParticipant_phaseId_tournamentParticipantId_key"
ON "TournamentBlockParticipant"("phaseId", "tournamentParticipantId");

CREATE INDEX "TournamentBlockParticipant_phaseId_idx"
ON "TournamentBlockParticipant"("phaseId");

CREATE INDEX "TournamentBlockParticipant_tournamentParticipantId_idx"
ON "TournamentBlockParticipant"("tournamentParticipantId");

ALTER TABLE "TournamentPhaseParticipant"
ADD CONSTRAINT "TournamentPhaseParticipant_phaseId_fkey"
FOREIGN KEY ("phaseId") REFERENCES "TournamentPhase"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentPhaseParticipant"
ADD CONSTRAINT "TournamentPhaseParticipant_tournamentParticipantId_fkey"
FOREIGN KEY ("tournamentParticipantId") REFERENCES "TournamentParticipant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentBlock"
ADD CONSTRAINT "TournamentBlock_phaseId_fkey"
FOREIGN KEY ("phaseId") REFERENCES "TournamentPhase"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentBlockParticipant"
ADD CONSTRAINT "TournamentBlockParticipant_blockId_fkey"
FOREIGN KEY ("blockId") REFERENCES "TournamentBlock"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentBlockParticipant"
ADD CONSTRAINT "TournamentBlockParticipant_phaseId_fkey"
FOREIGN KEY ("phaseId") REFERENCES "TournamentPhase"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TournamentBlockParticipant"
ADD CONSTRAINT "TournamentBlockParticipant_tournamentParticipantId_fkey"
FOREIGN KEY ("tournamentParticipantId") REFERENCES "TournamentParticipant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
