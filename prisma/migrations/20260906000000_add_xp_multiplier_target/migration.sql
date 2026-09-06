CREATE TYPE "XpMultiplierTarget" AS ENUM ('TOTAL_DELTA', 'VOTE_POINTS_ONLY');

ALTER TABLE "TournamentRatingConfig"
ADD COLUMN "xpMultiplierTarget" "XpMultiplierTarget" NOT NULL DEFAULT 'TOTAL_DELTA';
