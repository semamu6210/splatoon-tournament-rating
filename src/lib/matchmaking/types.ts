import type { Prisma } from "@prisma/client";

export type WaitingPlayer = {
  queueEntryId: string;
  userId: string;
  joinedAt: Date;
  rating: Prisma.Decimal;
  losingStreak: number;
  losingStreakPenalty: Prisma.Decimal;
  areaXp: number;
  isDummy: boolean;
  recentOpponentIds: Set<string>;
  recentTeammateIds: Set<string>;
};

export type MatchmakingPlayer = WaitingPlayer & {
  matchingRating: Prisma.Decimal;
};

export type TeamAssignment = {
  teamA: MatchmakingPlayer[];
  teamB: MatchmakingPlayer[];
  ratingDifference: Prisma.Decimal;
  teammateRepeatPenalty: number;
};
