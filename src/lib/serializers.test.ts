import { Prisma, UserRole } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { serializeParticipant } from "@/lib/serializers";

describe("serializeParticipant", () => {
  it("exposes participantName and avatarUrl but not discordId", () => {
    const serialized = serializeParticipant({
      id: "participant-id",
      tournamentId: "tournament-id",
      userId: "user-id",
      areaXp: 2500,
      rating: new Prisma.Decimal("1450"),
      ratingInitializedAt: null,
      initialRatingConfigId: null,
      initialRatingConfigVersion: null,
      wins: 3,
      losses: 1,
      matchesPlayed: 4,
      losingStreak: 0,
      finalRank: null,
      isActive: true,
      joinedAt: new Date("2026-08-23T00:00:00Z"),
      createdAt: new Date("2026-08-23T00:00:00Z"),
      updatedAt: new Date("2026-08-23T00:00:00Z"),
      blockName: null,
      advancedToMainEvent: false,
      participantName: "せまむ",
      winningStreak: 3,
      isDummy: false,
      dummyName: null,
      user: {
        id: "user-id",
        name: "Discord User",
        discordUsername: "semamu6210",
        avatarUrl: "https://cdn.discordapp.com/avatars/user/hash.png",
        role: UserRole.PLAYER,
      },
    });

    expect(serialized.participantName).toBe("せまむ");
    expect(serialized.user?.avatarUrl).toBe("https://cdn.discordapp.com/avatars/user/hash.png");
    expect(JSON.stringify(serialized)).not.toContain("discordId");
  });
});
