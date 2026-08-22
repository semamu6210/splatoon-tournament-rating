import { Prisma, type TournamentRatingConfig, type TournamentXpMultiplierTier } from "@prisma/client";

import { ApiError } from "@/lib/http";
import { buildXpTierRanges } from "@/lib/xp-tiers";
import {
  integerIn,
  nonNegativeDecimalString,
  positiveDecimalString,
} from "@/lib/validation";

export type RatingConfigInput = {
  initialRating: unknown;
  winBonus: unknown;
  strongVotePoints: unknown;
  weakVotePoints: unknown;
  losingStreakPenalty: unknown;
  xpTierStepSize: unknown;
  winningStreakBonusEnabled?: unknown;
  winningStreakBonusMultiplier?: unknown;
  winningStreakThreshold?: unknown;
  voteCountBonusEnabled?: unknown;
  voteCountBonusMultiplier?: unknown;
  voteCountBonusThreshold?: unknown;
  multipliers: unknown;
};

export type NormalizedRatingConfigInput = {
  initialRating: string;
  winBonus: string;
  strongVotePoints: string;
  weakVotePoints: string;
  losingStreakPenalty: string;
  xpTierStepSize: 50 | 100;
  winningStreakBonusEnabled: boolean;
  winningStreakBonusMultiplier: string;
  winningStreakThreshold: number;
  voteCountBonusEnabled: boolean;
  voteCountBonusMultiplier: string;
  voteCountBonusThreshold: number;
  tiers: Array<{
    minXp: number | null;
    maxXp: number | null;
    multiplier: string;
    sortOrder: number;
  }>;
};

function booleanValue(value: unknown) {
  return value === true || value === "true" || value === "on";
}

function positiveInteger(value: unknown, field: string, defaultValue: number) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new ApiError(400, `${field} must be a positive integer.`);
  }
  return numberValue;
}

type MultiplierInput = {
  sortOrder?: unknown;
  multiplier?: unknown;
};

export function normalizeRatingConfigInput(input: RatingConfigInput): NormalizedRatingConfigInput {
  const xpTierStepSize = integerIn(input.xpTierStepSize, "xpTierStepSize", [50, 100]) as 50 | 100;
  const ranges = buildXpTierRanges(xpTierStepSize);

  if (!Array.isArray(input.multipliers)) {
    throw new ApiError(400, "multipliers must be an array.");
  }

  if (input.multipliers.length !== ranges.length) {
    throw new ApiError(400, `multipliers must contain exactly ${ranges.length} entries.`);
  }

  const bySortOrder = new Map<number, string>();

  for (const item of input.multipliers as MultiplierInput[]) {
    if (typeof item !== "object" || item === null) {
      throw new ApiError(400, "Each multiplier entry must be an object.");
    }

    if (typeof item.sortOrder !== "number" || !Number.isInteger(item.sortOrder)) {
      throw new ApiError(400, "multiplier sortOrder must be an integer.");
    }

    if (bySortOrder.has(item.sortOrder)) {
      throw new ApiError(400, "Duplicate multiplier sortOrder.");
    }

    bySortOrder.set(item.sortOrder, positiveDecimalString(item.multiplier, "multiplier"));
  }

  const tiers = ranges.map((range) => {
    const multiplier = bySortOrder.get(range.sortOrder);

    if (!multiplier) {
      throw new ApiError(400, `Missing multiplier for sortOrder ${range.sortOrder}.`);
    }

    return {
      ...range,
      multiplier,
    };
  });

  return {
    initialRating: nonNegativeDecimalString(input.initialRating, "initialRating"),
    winBonus: nonNegativeDecimalString(input.winBonus, "winBonus"),
    strongVotePoints: nonNegativeDecimalString(input.strongVotePoints, "strongVotePoints"),
    weakVotePoints: nonNegativeDecimalString(input.weakVotePoints, "weakVotePoints"),
    losingStreakPenalty: nonNegativeDecimalString(input.losingStreakPenalty, "losingStreakPenalty"),
    xpTierStepSize,
    winningStreakBonusEnabled: booleanValue(input.winningStreakBonusEnabled),
    winningStreakBonusMultiplier: positiveDecimalString(input.winningStreakBonusMultiplier ?? "1.2", "winningStreakBonusMultiplier"),
    winningStreakThreshold: positiveInteger(input.winningStreakThreshold, "winningStreakThreshold", 3),
    voteCountBonusEnabled: booleanValue(input.voteCountBonusEnabled),
    voteCountBonusMultiplier: positiveDecimalString(input.voteCountBonusMultiplier ?? "1.2", "voteCountBonusMultiplier"),
    voteCountBonusThreshold: positiveInteger(input.voteCountBonusThreshold, "voteCountBonusThreshold", 3),
    tiers,
  };
}

export function validateCompleteRatingConfig(
  config: TournamentRatingConfig & { xpMultiplierTiers: TournamentXpMultiplierTier[] },
) {
  if (new Prisma.Decimal(config.initialRating).lt(0)) {
    throw new ApiError(400, "initialRating is invalid.");
  }

  if (new Prisma.Decimal(config.winBonus).lt(0)) {
    throw new ApiError(400, "winBonus is invalid.");
  }

  if (new Prisma.Decimal(config.strongVotePoints).lt(0)) {
    throw new ApiError(400, "strongVotePoints is invalid.");
  }

  if (new Prisma.Decimal(config.weakVotePoints).lt(0)) {
    throw new ApiError(400, "weakVotePoints is invalid.");
  }

  if (new Prisma.Decimal(config.losingStreakPenalty).lt(0)) {
    throw new ApiError(400, "losingStreakPenalty is invalid.");
  }

  if (config.xpTierStepSize !== 50 && config.xpTierStepSize !== 100) {
    throw new ApiError(400, "xpTierStepSize is invalid.");
  }
  if (new Prisma.Decimal(config.winningStreakBonusMultiplier).lte(0)) {
    throw new ApiError(400, "winningStreakBonusMultiplier is invalid.");
  }
  if (config.winningStreakThreshold <= 0) {
    throw new ApiError(400, "winningStreakThreshold is invalid.");
  }
  if (new Prisma.Decimal(config.voteCountBonusMultiplier).lte(0)) {
    throw new ApiError(400, "voteCountBonusMultiplier is invalid.");
  }
  if (config.voteCountBonusThreshold <= 0) {
    throw new ApiError(400, "voteCountBonusThreshold is invalid.");
  }

  const expected = buildXpTierRanges(config.xpTierStepSize);
  const actual = [...config.xpMultiplierTiers].sort((a, b) => a.sortOrder - b.sortOrder);

  if (actual.length !== expected.length) {
    throw new ApiError(400, "XP multiplier tiers are incomplete.");
  }

  for (let index = 0; index < expected.length; index += 1) {
    const expectedTier = expected[index];
    const actualTier = actual[index];

    if (
      actualTier.sortOrder !== expectedTier.sortOrder ||
      actualTier.minXp !== expectedTier.minXp ||
      actualTier.maxXp !== expectedTier.maxXp
    ) {
      throw new ApiError(400, "XP multiplier tiers do not match the configured step size.");
    }

    if (new Prisma.Decimal(actualTier.multiplier).lte(0)) {
      throw new ApiError(400, "All XP multipliers must be greater than zero.");
    }
  }
}

export function buildDefaultMultiplierPayload(stepSize: 50 | 100, multiplier = "1.0") {
  return buildXpTierRanges(stepSize).map((tier) => ({
    ...tier,
    multiplier,
  }));
}

export function configSnapshot(
  config: TournamentRatingConfig & { xpMultiplierTiers: TournamentXpMultiplierTier[] },
) {
  return {
    id: config.id,
    version: config.version,
    initialRating: config.initialRating.toString(),
    winBonus: config.winBonus.toString(),
    strongVotePoints: config.strongVotePoints.toString(),
    weakVotePoints: config.weakVotePoints.toString(),
    losingStreakPenalty: config.losingStreakPenalty.toString(),
    xpTierStepSize: config.xpTierStepSize,
    winningStreakBonusEnabled: config.winningStreakBonusEnabled,
    winningStreakBonusMultiplier: config.winningStreakBonusMultiplier.toString(),
    winningStreakThreshold: config.winningStreakThreshold,
    voteCountBonusEnabled: config.voteCountBonusEnabled,
    voteCountBonusMultiplier: config.voteCountBonusMultiplier.toString(),
    voteCountBonusThreshold: config.voteCountBonusThreshold,
    isActive: config.isActive,
    xpMultiplierTiers: config.xpMultiplierTiers
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((tier) => ({
        minXp: tier.minXp,
        maxXp: tier.maxXp,
        multiplier: tier.multiplier.toString(),
        sortOrder: tier.sortOrder,
      })),
  };
}
