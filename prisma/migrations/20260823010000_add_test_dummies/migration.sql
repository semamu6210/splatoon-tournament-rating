ALTER TABLE "Tournament" ADD COLUMN "isTestTournament" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TournamentParticipant" ADD COLUMN "isDummy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TournamentParticipant" ADD COLUMN "dummyName" TEXT;

CREATE INDEX "TournamentParticipant_tournamentId_isDummy_idx" ON "TournamentParticipant"("tournamentId", "isDummy");
