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
  finalDelta: Prisma.Decimal;
  ratingAfter: Prisma.Decimal;
  won: boolean;
};

export function calculatePlayerRatingResults(params: {
  players: MatchPlayer[];
  votes: PlayerVote[];
  config: TournamentRatingConfig;
  xpTiers: TournamentXpMultiplierTier[];
  winnerTeam: Team;
}) {
  return params.players.map((player): PlayerRatingResult => {
    const strongVotesReceived = params.votes.filter(
      (vote) => vote.targetUserId === player.userId && vote.voteType === "STRONG",
    ).length;
    const weakVotesReceived = params.votes.filter(
      (vote) => vote.targetUserId === player.userId && vote.voteType === "WEAK",
    ).length;
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
    const finalDelta = baseDelta.mul(xpMultiplierUsed);
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
      finalDelta,
      ratingAfter,
      won,
    };
  });
}
