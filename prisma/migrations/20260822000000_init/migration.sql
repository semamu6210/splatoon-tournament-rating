-- Initial schema for Phase 1.
-- Generated manually because this environment does not have Node/npm available.

CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'ADMIN', 'OWNER');
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'REGISTRATION', 'ACTIVE', 'FINISHED');
CREATE TYPE "TournamentPhaseType" AS ENUM ('QUALIFIER', 'MAIN_EVENT');
CREATE TYPE "TournamentPhaseStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'MATCHED', 'CANCELLED');
CREATE TYPE "MatchStatus" AS ENUM ('CREATED', 'PLAYING', 'RESULT_REPORTING', 'VOTE_REPORTING', 'CONFIRMED', 'CANCELLED');
CREATE TYPE "Team" AS ENUM ('A', 'B');
CREATE TYPE "VoteType" AS ENUM ('STRONG', 'WEAK');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "emailVerified" TIMESTAMP(3),
  "image" TEXT,
  "discordId" TEXT,
  "discordUsername" TEXT,
  "avatarUrl" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Account" (
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" INTEGER,
  "token_type" TEXT,
  "scope" TEXT,
  "id_token" TEXT,
  "session_state" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Account_pkey" PRIMARY KEY ("provider", "providerAccountId")
);

CREATE TABLE "Session" (
  "sessionToken" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "VerificationToken" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier", "token")
);

CREATE TABLE "Authenticator" (
  "credentialID" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "credentialPublicKey" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "credentialDeviceType" TEXT NOT NULL,
  "credentialBackedUp" BOOLEAN NOT NULL,
  "transports" TEXT,
  CONSTRAINT "Authenticator_pkey" PRIMARY KEY ("userId", "credentialID")
);

CREATE TABLE "Tournament" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
  "createdByUserId" TEXT NOT NULL,
  "startRatingConfigId" TEXT,
  "startRatingConfigVersion" INTEGER,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentPhase" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "phaseType" "TournamentPhaseType" NOT NULL,
  "status" "TournamentPhaseStatus" NOT NULL DEFAULT 'PENDING',
  "requiredMatchesPerPlayer" INTEGER NOT NULL,
  "advancePlayerCount" INTEGER,
  "sortOrder" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentPhase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentParticipant" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "areaXp" INTEGER NOT NULL,
  "rating" DECIMAL(12,2),
  "ratingInitializedAt" TIMESTAMP(3),
  "initialRatingConfigId" TEXT,
  "initialRatingConfigVersion" INTEGER,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
  "losingStreak" INTEGER NOT NULL DEFAULT 0,
  "finalRank" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TournamentRatingConfig" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "initialRating" DECIMAL(12,2) NOT NULL,
  "winBonus" DECIMAL(12,2) NOT NULL,
  "strongVotePoints" DECIMAL(12,2) NOT NULL,
  "weakVotePoints" DECIMAL(12,2) NOT NULL,
  "losingStreakPenalty" DECIMAL(12,2) NOT NULL,
  "xpTierStepSize" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentRatingConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TournamentRatingConfig_values_check" CHECK (
    "initialRating" >= 0 AND
    "winBonus" >= 0 AND
    "strongVotePoints" >= 0 AND
    "weakVotePoints" >= 0 AND
    "losingStreakPenalty" >= 0 AND
    "xpTierStepSize" IN (50, 100)
  )
);

CREATE TABLE "TournamentXpMultiplierTier" (
  "id" TEXT NOT NULL,
  "tournamentRatingConfigId" TEXT NOT NULL,
  "minXp" INTEGER,
  "maxXp" INTEGER,
  "multiplier" DECIMAL(8,4) NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TournamentXpMultiplierTier_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TournamentXpMultiplierTier_values_check" CHECK (
    ("minXp" IS NOT NULL OR "maxXp" IS NOT NULL) AND
    ("minXp" IS NULL OR "minXp" >= 0) AND
    ("maxXp" IS NULL OR "maxXp" >= 0) AND
    ("minXp" IS NULL OR "maxXp" IS NULL OR "minXp" <= "maxXp") AND
    "multiplier" > 0
  )
);

CREATE TABLE "QueueEntry" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "phaseId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "QueueStatus" NOT NULL DEFAULT 'WAITING',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "matchedAt" TIMESTAMP(3),
  CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Match" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "phaseId" TEXT NOT NULL,
  "ratingConfigId" TEXT NOT NULL,
  "ratingConfigVersion" INTEGER NOT NULL,
  "status" "MatchStatus" NOT NULL DEFAULT 'CREATED',
  "winnerTeam" "Team",
  "ratingAppliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchPlayer" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "team" "Team" NOT NULL,
  "ratingBefore" DECIMAL(12,2) NOT NULL,
  "matchingRatingAtMatch" DECIMAL(12,2) NOT NULL,
  "areaXpAtMatch" INTEGER NOT NULL,
  "losingStreakAtMatch" INTEGER NOT NULL,
  "ratingAfter" DECIMAL(12,2),
  CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchResultReport" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reportedWinnerTeam" "Team" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchResultReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerVote" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "voterUserId" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "voteType" "VoteType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RatingHistory" (
  "id" TEXT NOT NULL,
  "tournamentId" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "ratingConfigIdUsed" TEXT NOT NULL,
  "ratingConfigVersionUsed" INTEGER NOT NULL,
  "ratingBefore" DECIMAL(12,2) NOT NULL,
  "strongVotesReceived" INTEGER NOT NULL,
  "weakVotesReceived" INTEGER NOT NULL,
  "strongVotePointsUsed" DECIMAL(12,2) NOT NULL,
  "weakVotePointsUsed" DECIMAL(12,2) NOT NULL,
  "winBonusUsed" DECIMAL(12,2) NOT NULL,
  "losingStreakPenaltyUsed" DECIMAL(12,2) NOT NULL,
  "votePoints" DECIMAL(12,2) NOT NULL,
  "baseDelta" DECIMAL(12,2) NOT NULL,
  "areaXpUsed" INTEGER NOT NULL,
  "xpTierMinUsed" INTEGER,
  "xpTierMaxUsed" INTEGER,
  "xpMultiplierUsed" DECIMAL(8,4) NOT NULL,
  "finalDelta" DECIMAL(12,2) NOT NULL,
  "ratingAfter" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RatingHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminActionLog" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminActionLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");
CREATE INDEX "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE UNIQUE INDEX "Authenticator_credentialID_key" ON "Authenticator"("credentialID");
CREATE INDEX "Tournament_status_idx" ON "Tournament"("status");
CREATE INDEX "Tournament_createdByUserId_idx" ON "Tournament"("createdByUserId");
CREATE UNIQUE INDEX "TournamentPhase_tournamentId_phaseType_key" ON "TournamentPhase"("tournamentId", "phaseType");
CREATE UNIQUE INDEX "TournamentPhase_tournamentId_sortOrder_key" ON "TournamentPhase"("tournamentId", "sortOrder");
CREATE INDEX "TournamentPhase_tournamentId_status_idx" ON "TournamentPhase"("tournamentId", "status");
CREATE UNIQUE INDEX "TournamentParticipant_tournamentId_userId_key" ON "TournamentParticipant"("tournamentId", "userId");
CREATE INDEX "TournamentParticipant_tournamentId_idx" ON "TournamentParticipant"("tournamentId");
CREATE INDEX "TournamentParticipant_userId_idx" ON "TournamentParticipant"("userId");
CREATE INDEX "TournamentParticipant_rating_idx" ON "TournamentParticipant"("rating");
CREATE UNIQUE INDEX "TournamentRatingConfig_tournamentId_version_key" ON "TournamentRatingConfig"("tournamentId", "version");
CREATE UNIQUE INDEX "TournamentRatingConfig_one_active_per_tournament_idx" ON "TournamentRatingConfig"("tournamentId") WHERE "isActive" = true;
CREATE INDEX "TournamentRatingConfig_tournamentId_idx" ON "TournamentRatingConfig"("tournamentId");
CREATE UNIQUE INDEX "XpMultiplierTier_config_sortOrder_key" ON "TournamentXpMultiplierTier"("tournamentRatingConfigId", "sortOrder");
CREATE INDEX "TournamentXpMultiplierTier_tournamentRatingConfigId_idx" ON "TournamentXpMultiplierTier"("tournamentRatingConfigId");
CREATE INDEX "QueueEntry_phaseId_status_joinedAt_idx" ON "QueueEntry"("phaseId", "status", "joinedAt");
CREATE INDEX "QueueEntry_tournamentId_idx" ON "QueueEntry"("tournamentId");
CREATE INDEX "QueueEntry_userId_idx" ON "QueueEntry"("userId");
CREATE INDEX "Match_tournamentId_phaseId_status_createdAt_idx" ON "Match"("tournamentId", "phaseId", "status", "createdAt");
CREATE INDEX "Match_ratingConfigId_idx" ON "Match"("ratingConfigId");
CREATE UNIQUE INDEX "MatchPlayer_matchId_userId_key" ON "MatchPlayer"("matchId", "userId");
CREATE INDEX "MatchPlayer_matchId_team_idx" ON "MatchPlayer"("matchId", "team");
CREATE INDEX "MatchPlayer_userId_idx" ON "MatchPlayer"("userId");
CREATE UNIQUE INDEX "MatchResultReport_matchId_userId_key" ON "MatchResultReport"("matchId", "userId");
CREATE INDEX "MatchResultReport_userId_idx" ON "MatchResultReport"("userId");
CREATE UNIQUE INDEX "PlayerVote_matchId_voterUserId_voteType_key" ON "PlayerVote"("matchId", "voterUserId", "voteType");
CREATE UNIQUE INDEX "PlayerVote_matchId_voterUserId_targetUserId_key" ON "PlayerVote"("matchId", "voterUserId", "targetUserId");
CREATE INDEX "PlayerVote_matchId_voterUserId_idx" ON "PlayerVote"("matchId", "voterUserId");
CREATE INDEX "PlayerVote_matchId_targetUserId_idx" ON "PlayerVote"("matchId", "targetUserId");
CREATE UNIQUE INDEX "RatingHistory_matchId_userId_key" ON "RatingHistory"("matchId", "userId");
CREATE INDEX "RatingHistory_tournamentId_userId_matchId_idx" ON "RatingHistory"("tournamentId", "userId", "matchId");
CREATE INDEX "RatingHistory_ratingConfigIdUsed_idx" ON "RatingHistory"("ratingConfigIdUsed");
CREATE INDEX "AdminActionLog_adminUserId_idx" ON "AdminActionLog"("adminUserId");
CREATE INDEX "AdminActionLog_targetType_targetId_idx" ON "AdminActionLog"("targetType", "targetId");
CREATE INDEX "AdminActionLog_createdAt_idx" ON "AdminActionLog"("createdAt");

ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Authenticator" ADD CONSTRAINT "Authenticator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_startRatingConfigId_fkey" FOREIGN KEY ("startRatingConfigId") REFERENCES "TournamentRatingConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TournamentPhase" ADD CONSTRAINT "TournamentPhase_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_initialRatingConfigId_fkey" FOREIGN KEY ("initialRatingConfigId") REFERENCES "TournamentRatingConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TournamentRatingConfig" ADD CONSTRAINT "TournamentRatingConfig_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TournamentXpMultiplierTier" ADD CONSTRAINT "TournamentXpMultiplierTier_tournamentRatingConfigId_fkey" FOREIGN KEY ("tournamentRatingConfigId") REFERENCES "TournamentRatingConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "TournamentPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "TournamentPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Match" ADD CONSTRAINT "Match_ratingConfigId_fkey" FOREIGN KEY ("ratingConfigId") REFERENCES "TournamentRatingConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchResultReport" ADD CONSTRAINT "MatchResultReport_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatchResultReport" ADD CONSTRAINT "MatchResultReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerVote" ADD CONSTRAINT "PlayerVote_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerVote" ADD CONSTRAINT "PlayerVote_voterUserId_fkey" FOREIGN KEY ("voterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerVote" ADD CONSTRAINT "PlayerVote_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RatingHistory" ADD CONSTRAINT "RatingHistory_ratingConfigIdUsed_fkey" FOREIGN KEY ("ratingConfigIdUsed") REFERENCES "TournamentRatingConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AdminActionLog" ADD CONSTRAINT "AdminActionLog_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
