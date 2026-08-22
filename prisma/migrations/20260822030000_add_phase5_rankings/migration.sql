ALTER TABLE "TournamentParticipant" ADD COLUMN "blockName" TEXT;
ALTER TABLE "TournamentParticipant" ADD COLUMN "advancedToMainEvent" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "TournamentParticipant_tournamentId_blockName_rating_idx"
ON "TournamentParticipant"("tournamentId", "blockName", "rating");

CREATE INDEX "TournamentParticipant_tournamentId_advancedToMainEvent_idx"
ON "TournamentParticipant"("tournamentId", "advancedToMainEvent");
