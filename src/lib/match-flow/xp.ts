import type { TournamentXpMultiplierTier } from "@prisma/client";

import { ApiError } from "@/lib/http";

export function findXpTier(areaXp: number, tiers: TournamentXpMultiplierTier[]) {
  const matches = tiers.filter((tier) => {
    const lowerOk = tier.minXp === null || areaXp >= tier.minXp;
    const upperOk = tier.maxXp === null || areaXp <= tier.maxXp;
    return lowerOk && upperOk;
  });

  if (matches.length !== 1) {
    throw new ApiError(400, `XP tier configuration does not match areaXp ${areaXp}.`);
  }

  return matches[0];
}
