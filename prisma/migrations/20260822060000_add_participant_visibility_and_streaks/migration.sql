CREATE TYPE "RankingVisibility" AS ENUM ('OWN_BLOCK_ONLY', 'OWN_AND_OTHER_BLOCKS', 'OVERALL_ONLY', 'ALL');

ALTER TABLE "Tournament" ADD COLUMN "rankingVisibility" "RankingVisibility" NOT NULL DEFAULT 'ALL';
ALTER TABLE "TournamentParticipant" ADD COLUMN "participantName" TEXT;
ALTER TABLE "TournamentParticipant" ADD COLUMN "winningStreak" INTEGER NOT NULL DEFAULT 0;

UPDATE "TournamentParticipant" tp
SET "participantName" = COALESCE(u."discordUsername", u."name", tp."userId")
FROM "User" u
WHERE u."id" = tp."userId";

ALTER TABLE "TournamentParticipant" ALTER COLUMN "participantName" SET NOT NULL;
