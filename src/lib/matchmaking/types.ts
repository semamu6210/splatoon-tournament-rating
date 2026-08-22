import type { Prisma } from "@prisma/client";

export type WaitingPlayer = {
  queueEntryId: string;
  userId: string;
  joinedAt: Date;
  rating: Prisma.Decimal;
  losingStreak: number;
  areaXp: number;
  isDummy: boolean;
  completedMatchesInPhase: number;
  recentOpponentIds: Set<string>;
  recentTeammateIds: Set<string>;
};

export type MatchmakingPlayer = WaitingPlayer & {
  matchingPower: Prisma.Decimal;
};

export type TeamAssignment = {
  teamA: MatchmakingPlayer[];
  teamB: MatchmakingPlayer[];
  matchingPowerDifference: Prisma.Decimal;
  averageXpDifference: number;
  teammateRepeatPenalty: number;
};
