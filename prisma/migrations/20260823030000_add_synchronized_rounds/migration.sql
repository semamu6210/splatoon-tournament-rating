CREATE TYPE "TournamentPhaseRoundStatus" AS ENUM ('PENDING', 'MATCHING', 'ACTIVE', 'COMPLETED');

ALTER TABLE "Match" ADD COLUMN "startedAt" TIMESTAMP(3);
ALTER TABLE "Match" ADD COLUMN "roundNumber" INTEGER;

CREATE TABLE "TournamentPhaseRound" (
  "id" TEXT NOT NULL,
  "phaseId" TEXT NOT NULL,
  "roundNumber" INTEGER NOT NULL,
  "status" "TournamentPhaseRoundStatus" NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentPhaseRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentPhaseRoundBlock" (
  "id" TEXT NOT NULL,
  "phaseId" TEXT NOT NULL,
  "roundId" TEXT NOT NULL,
  "blockId" TEXT NOT NULL,
  "roundNumber" INTEGER NOT NULL,
  "status" "TournamentPhaseRoundStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentPhaseRoundBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TournamentPhaseRound_phaseId_roundNumber_key" ON "TournamentPhaseRound"("phaseId", "roundNumber");
CREATE INDEX "TournamentPhaseRound_phaseId_status_idx" ON "TournamentPhaseRound"("phaseId", "status");
CREATE UNIQUE INDEX "TournamentPhaseRoundBlock_phaseId_blockId_roundNumber_key" ON "TournamentPhaseRoundBlock"("phaseId", "blockId", "roundNumber");
CREATE INDEX "TournamentPhaseRoundBlock_roundId_status_idx" ON "TournamentPhaseRoundBlock"("roundId", "status");
CREATE INDEX "TournamentPhaseRoundBlock_blockId_idx" ON "TournamentPhaseRoundBlock"("blockId");
CREATE INDEX "Match_phaseId_roundNumber_status_idx" ON "Match"("phaseId", "roundNumber", "status");

ALTER TABLE "TournamentPhaseRound" ADD CONSTRAINT "TournamentPhaseRound_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "TournamentPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentPhaseRoundBlock" ADD CONSTRAINT "TournamentPhaseRoundBlock_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "TournamentPhaseRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentPhaseRoundBlock" ADD CONSTRAINT "TournamentPhaseRoundBlock_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "TournamentBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_phaseId_roundNumber_fkey" FOREIGN KEY ("phaseId", "roundNumber") REFERENCES "TournamentPhaseRound"("phaseId", "roundNumber") ON DELETE NO ACTION ON UPDATE CASCADE;
