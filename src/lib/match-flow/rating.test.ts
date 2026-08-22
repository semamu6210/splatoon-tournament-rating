import { Prisma, type MatchPlayer, type PlayerVote, type TournamentRatingConfig, type TournamentXpMultiplierTier } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { calculatePlayerRatingResults } from "@/lib/match-flow/rating";

function config(overrides: Partial<TournamentRatingConfig> = {}): TournamentRatingConfig {
  return {
    id: "config-1",
    tournamentId: "tournament-1",
    version: 1,
    initialRating: new Prisma.Decimal(1000),
    winBonus: new Prisma.Decimal(10),
    strongVotePoints: new Prisma.Decimal(10),
    weakVotePoints: new Prisma.Decimal(5),
    losingStreakPenalty: new Prisma.Decimal(20),
    xpTierStepSize: 100,
    winningStreakBonusEnabled: false,
    winningStreakBonusMultiplier: new Prisma.Decimal("1.2"),
    winningStreakThreshold: 3,
    voteCountBonusEnabled: false,
    voteCountBonusMultiplier: new Prisma.Decimal("1.2"),
    voteCountBonusThreshold: 3,
    isActive: true,
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    updatedAt: new Date("2026-08-23T00:00:00.000Z"),
    ...overrides,
  };
}

function player(userId: string, team: "A" | "B"): MatchPlayer {
  return {
    id: `mp-${userId}`,
    matchId: "match-1",
    userId,
    team,
    ratingBefore: new Prisma.Decimal(1000),
    matchingRatingAtMatch: new Prisma.Decimal(0),
    areaXpAtMatch: 2500,
    losingStreakAtMatch: 0,
    ratingAfter: null,
  };
}

function vote(voterUserId: string, targetUserId: string, voteType: "STRONG" | "WEAK"): PlayerVote {
  return {
    id: `${voterUserId}-${targetUserId}-${voteType}`,
    matchId: "match-1",
    voterUserId,
    targetUserId,
    voteType,
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
  };
}

const xpTiers: TournamentXpMultiplierTier[] = [
  {
    id: "tier-1",
    tournamentRatingConfigId: "config-1",
    minXp: null,
    maxXp: null,
    multiplier: new Prisma.Decimal(1),
    sortOrder: 1,
    createdAt: new Date("2026-08-23T00:00:00.000Z"),
    updatedAt: new Date("2026-08-23T00:00:00.000Z"),
  },
];

function resultForTarget(params: {
  config?: TournamentRatingConfig;
  streakBefore?: number;
  votes?: PlayerVote[];
  winnerTeam?: "A" | "B";
  xpMultiplier?: string;
}) {
  const target = player("target", "A");
  const other = player("other", "B");
  const tiers = [{ ...xpTiers[0], multiplier: new Prisma.Decimal(params.xpMultiplier ?? "1") }];
  return calculatePlayerRatingResults({
    players: [target, other],
    votes: params.votes ?? [],
    config: params.config ?? config(),
    participantStreaks: [{ userId: "target", winningStreak: params.streakBefore ?? 0 }],
    xpTiers: tiers,
    winnerTeam: params.winnerTeam ?? "A",
  }).find((result) => result.userId === "target")!;
}

describe("rating bonus modes", () => {
  it("does not apply streak bonus when a 2-streak player loses", () => {
    const result = resultForTarget({
      config: config({ winningStreakBonusEnabled: true }),
      streakBefore: 2,
      winnerTeam: "B",
    });
    expect(result.winningStreakAfter).toBe(0);
    expect(result.winningStreakBonusApplied).toBe(false);
    expect(result.finalDelta.equals(0)).toBe(true);
  });

  it("applies the same x1.2 streak bonus at 2->3, 3->4, and 5->6 wins", () => {
    for (const streakBefore of [2, 3, 5]) {
      const result = resultForTarget({
        config: config({ winningStreakBonusEnabled: true }),
        streakBefore,
      });
      expect(result.winningStreakAfter).toBe(streakBefore + 1);
      expect(result.winningStreakBonusApplied).toBe(true);
      expect(result.winningStreakBonusMultiplierUsed.equals("1.2")).toBe(true);
      expect(result.finalDelta.equals("12")).toBe(true);
    }
  });

  it("does not apply streak bonus when the feature is off", () => {
    const result = resultForTarget({ streakBefore: 5 });
    expect(result.winningStreakBonusApplied).toBe(false);
    expect(result.finalDelta.equals("10")).toBe(true);
  });

  it("applies vote-count bonus at 3 or more total received votes only", () => {
    const enabled = config({ voteCountBonusEnabled: true });
    expect(resultForTarget({ config: enabled, votes: [] }).voteCountBonusApplied).toBe(false);
    expect(
      resultForTarget({
        config: enabled,
        votes: [vote("v1", "target", "STRONG"), vote("v2", "target", "WEAK")],
      }).voteCountBonusApplied,
    ).toBe(false);

    for (const votes of [
      [vote("v1", "target", "STRONG"), vote("v2", "target", "STRONG"), vote("v3", "target", "WEAK")],
      [
        vote("v1", "target", "STRONG"),
        vote("v2", "target", "WEAK"),
        vote("v3", "target", "WEAK"),
        vote("v4", "target", "STRONG"),
      ],
    ]) {
      const result = resultForTarget({ config: enabled, votes });
      expect(result.voteCountBonusApplied).toBe(true);
      expect(result.voteCountBonusMultiplierUsed.equals("1.2")).toBe(true);
    }
  });

  it("does not apply vote-count bonus when the feature is off", () => {
    const result = resultForTarget({
      votes: [vote("v1", "target", "STRONG"), vote("v2", "target", "STRONG"), vote("v3", "target", "WEAK")],
    });
    expect(result.totalVotesReceived).toBe(3);
    expect(result.voteCountBonusApplied).toBe(false);
  });

  it("multiplies streak, vote-count, and XP bonuses independently with Decimal precision", () => {
    const result = resultForTarget({
      config: config({ winningStreakBonusEnabled: true, voteCountBonusEnabled: true }),
      streakBefore: 2,
      xpMultiplier: "0.9",
      votes: [vote("v1", "target", "STRONG"), vote("v2", "target", "STRONG"), vote("v3", "target", "WEAK")],
    });
    expect(result.baseDelta.equals("35")).toBe(true);
    expect(result.xpMultiplierUsed.equals("0.9")).toBe(true);
    expect(result.finalDelta.equals("45.36")).toBe(true);
    expect(result.ratingAfter.equals("1045.36")).toBe(true);
    expect(result.finalDelta.gte(0)).toBe(true);
  });
});
