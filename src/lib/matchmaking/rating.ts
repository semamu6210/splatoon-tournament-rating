import { Prisma } from "@prisma/client";

export const LOSING_STREAK_MATCHING_POWER_PENALTY = 50;

export function calculateMatchingPower(params: {
  areaXp: number;
  losingStreak: number;
}) {
  const areaXp = new Prisma.Decimal(params.areaXp);
  const penalty = new Prisma.Decimal(LOSING_STREAK_MATCHING_POWER_PENALTY).mul(params.losingStreak);

  return areaXp.sub(penalty);
}
