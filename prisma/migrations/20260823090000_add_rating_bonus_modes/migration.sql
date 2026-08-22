ALTER TABLE "TournamentRatingConfig"
ADD COLUMN "winningStreakBonusEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "winningStreakBonusMultiplier" DECIMAL(8,4) NOT NULL DEFAULT 1.20,
ADD COLUMN "winningStreakThreshold" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "voteCountBonusEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "voteCountBonusMultiplier" DECIMAL(8,4) NOT NULL DEFAULT 1.20,
ADD COLUMN "voteCountBonusThreshold" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "RatingHistory"
ADD COLUMN "winningStreakBefore" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "winningStreakAfter" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "winningStreakBonusApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "winningStreakBonusMultiplierUsed" DECIMAL(8,4) NOT NULL DEFAULT 1.00,
ADD COLUMN "totalVotesReceived" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "voteCountBonusApplied" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "voteCountBonusMultiplierUsed" DECIMAL(8,4) NOT NULL DEFAULT 1.00;
