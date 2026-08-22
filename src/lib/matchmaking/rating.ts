import { Prisma } from "@prisma/client";

export function calculateMatchingRating(params: {
  rating: Prisma.Decimal.Value;
  losingStreak: number;
  losingStreakPenalty: Prisma.Decimal.Value;
}) {
  const rating = new Prisma.Decimal(params.rating);
  const penalty = new Prisma.Decimal(params.losingStreakPenalty).mul(params.losingStreak);

  return rating.sub(penalty);
}
