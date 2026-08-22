import { Prisma, type MatchPlayer, type PlayerVote, type Team, type TournamentRatingConfig, type TournamentXpMultiplierTier } from "@prisma/client";

import { findXpTier } from "@/lib/match-flow/xp";

export type PlayerRatingResult = {
  userId: string;
  ratingBefore: Prisma.Decimal;
  strongVotesReceived: number;
  weakVotesReceived: number;
  strongVotePointsUsed: Prisma.Decimal;
  weakVotePointsUsed: Prisma.Decimal;
  winBonusUsed: Prisma.Decimal;
  losingStreakPenaltyUsed: Prisma.Decimal;
  votePoints: Prisma.Decimal;
  baseDelta: Prisma.Decimal;
  areaXpUsed: number;
  xpTierMinUsed: number | null;
  xpTierMaxUsed: number | null;
  xpMultiplierUsed: Prisma.Decimal;
  winningStreakBefore: number;
  winningStreakAfter: number;
  winningStreakBonusApplied: boolean;
  winningStreakBonusMultiplierUsed: Prisma.Decimal;
  totalVotesReceived: number;
  voteCountBonusApplied: boolean;
  voteCountBonusMultiplierUsed: Prisma.Decimal;
  finalDelta: Prisma.Decimal;
  ratingAfter: Prisma.Decimal;
  won: boolean;
};

export function calculatePlayerRatingResults(params: {
  players: MatchPlayer[];
  votes: PlayerVote[];
  config: TournamentRatingConfig;
  participantStreaks: Array<{ userId: string; winningStreak: number }>;
  xpTiers: TournamentXpMultiplierTier[];
  winnerTeam: Team;
}) {
  const winningStreakByUserId = new Map(params.participantStreaks.map((participant) => [participant.userId, participant.winningStreak]));

  return params.players.map((player): PlayerRatingResult => {
    const strongVotesReceived = params.votes.filter(
      (vote) => vote.targetUserId === player.userId && vote.voteType === "STRONG",
    ).length;
    const weakVotesReceived = params.votes.filter(
      (vote) => vote.targetUserId === player.userId && vote.voteType === "WEAK",
    ).length;
    const totalVotesReceived = strongVotesReceived + weakVotesReceived;
    const strongVotePointsUsed = new Prisma.Decimal(params.config.strongVotePoints);
    const weakVotePointsUsed = new Prisma.Decimal(params.config.weakVotePoints);
    const votePoints = strongVotePointsUsed
      .mul(strongVotesReceived)
      .add(weakVotePointsUsed.mul(weakVotesReceived));
    const won = player.team === params.winnerTeam;
    const winBonusUsed = won ? new Prisma.Decimal(params.config.winBonus) : new Prisma.Decimal(0);
    const baseDelta = votePoints.add(winBonusUsed);
    const tier = findXpTier(player.areaXpAtMatch, params.xpTiers);
    const xpMultiplierUsed = new Prisma.Decimal(tier.multiplier);
    const xpAdjustedDelta = baseDelta.mul(xpMultiplierUsed);
    const winningStreakBefore = winningStreakByUserId.get(player.userId) ?? 0;
    const winningStreakAfter = won ? winningStreakBefore + 1 : 0;
    const winningStreakBonusApplied =
      params.config.winningStreakBonusEnabled && won && winningStreakAfter >= params.config.winningStreakThreshold;
    const winningStreakBonusMultiplierUsed = winningStreakBonusApplied
      ? new Prisma.Decimal(params.config.winningStreakBonusMultiplier)
      : new Prisma.Decimal(1);
    const voteCountBonusApplied =
      params.config.voteCountBonusEnabled && totalVotesReceived >= params.config.voteCountBonusThreshold;
    const voteCountBonusMultiplierUsed = voteCountBonusApplied
      ? new Prisma.Decimal(params.config.voteCountBonusMultiplier)
      : new Prisma.Decimal(1);
    const finalDelta = xpAdjustedDelta.mul(winningStreakBonusMultiplierUsed).mul(voteCountBonusMultiplierUsed);
    const ratingBefore = new Prisma.Decimal(player.ratingBefore);
    const ratingAfter = ratingBefore.add(finalDelta);

    return {
      userId: player.userId,
      ratingBefore,
      strongVotesReceived,
      weakVotesReceived,
      strongVotePointsUsed,
      weakVotePointsUsed,
      winBonusUsed,
      losingStreakPenaltyUsed: new Prisma.Decimal(params.config.losingStreakPenalty),
      votePoints,
      baseDelta,
      areaXpUsed: player.areaXpAtMatch,
      xpTierMinUsed: tier.minXp,
      xpTierMaxUsed: tier.maxXp,
      xpMultiplierUsed,
      winningStreakBefore,
      winningStreakAfter,
      winningStreakBonusApplied,
      winningStreakBonusMultiplierUsed,
      totalVotesReceived,
      voteCountBonusApplied,
      voteCountBonusMultiplierUsed,
      finalDelta,
      ratingAfter,
      won,
    };
  });
}
