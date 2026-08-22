import type {
  Tournament,
  TournamentParticipant,
  TournamentRatingConfig,
  TournamentXpMultiplierTier,
  User,
} from "@prisma/client";

export function serializeDecimal(value: { toString(): string } | null) {
  return value === null ? null : value.toString();
}

export function serializeRequiredDecimal(value: { toString(): string }) {
  return value.toString();
}

export function serializeTournament(tournament: Tournament) {
  return {
    ...tournament,
    startsAt: tournament.startsAt?.toISOString() ?? null,
    endsAt: tournament.endsAt?.toISOString() ?? null,
    createdAt: tournament.createdAt.toISOString(),
    updatedAt: tournament.updatedAt.toISOString(),
  };
}

export function serializeRatingConfig(
  config: TournamentRatingConfig & { xpMultiplierTiers?: TournamentXpMultiplierTier[] },
) {
  return {
    ...config,
    initialRating: serializeRequiredDecimal(config.initialRating),
    winBonus: serializeRequiredDecimal(config.winBonus),
    strongVotePoints: serializeRequiredDecimal(config.strongVotePoints),
    weakVotePoints: serializeRequiredDecimal(config.weakVotePoints),
    losingStreakPenalty: serializeRequiredDecimal(config.losingStreakPenalty),
    winningStreakBonusMultiplier: serializeRequiredDecimal(config.winningStreakBonusMultiplier),
    voteCountBonusMultiplier: serializeRequiredDecimal(config.voteCountBonusMultiplier),
    createdAt: config.createdAt.toISOString(),
    updatedAt: config.updatedAt.toISOString(),
    xpMultiplierTiers: config.xpMultiplierTiers?.map(serializeXpTier),
  };
}

export function serializeXpTier(tier: TournamentXpMultiplierTier) {
  return {
    ...tier,
    multiplier: serializeRequiredDecimal(tier.multiplier),
    createdAt: tier.createdAt.toISOString(),
    updatedAt: tier.updatedAt.toISOString(),
  };
}

export function serializeParticipant(
  participant: TournamentParticipant & {
    user?: Pick<User, "id" | "name" | "discordUsername" | "avatarUrl" | "role">;
  },
) {
  const { user, ...rest } = participant;

  return {
    ...rest,
    rating: serializeDecimal(participant.rating),
    ratingInitializedAt: participant.ratingInitializedAt?.toISOString() ?? null,
    joinedAt: participant.joinedAt.toISOString(),
    createdAt: participant.createdAt.toISOString(),
    updatedAt: participant.updatedAt.toISOString(),
    user: user
      ? {
          id: user.id,
          name: user.name,
          discordUsername: user.discordUsername,
          avatarUrl: user.avatarUrl,
          role: user.role,
        }
      : undefined,
  };
}
