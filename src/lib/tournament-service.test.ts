import { Prisma, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildDefaultMultiplierPayload } from "@/lib/rating-config";
import {
  createRatingConfigVersion,
  createTournament,
  joinTournament,
  openRegistration,
  startTournament,
  updateTournament,
} from "@/lib/tournament-service";

const createdUserIds: string[] = [];
const createdTournamentIds: string[] = [];

async function createUser(role: UserRole) {
  const user = await prisma.user.create({
    data: {
      name: `test-${crypto.randomUUID()}`,
      role,
    },
  });

  createdUserIds.push(user.id);
  return user;
}

async function createDraftTournament(adminUserId: string, name = `test-${crypto.randomUUID()}`) {
  const tournament = await createTournament(adminUserId, {
    name,
    startsAt: null,
    endsAt: null,
  });

  createdTournamentIds.push(tournament.id);
  return tournament;
}

function validRatingConfig(stepSize: 50 | 100 = 100) {
  return {
    initialRating: "1200",
    winBonus: "10",
    strongVotePoints: "10",
    weakVotePoints: "5",
    losingStreakPenalty: "0",
    xpTierStepSize: stepSize,
    multipliers: buildDefaultMultiplierPayload(stepSize),
  };
}

afterEach(async () => {
  await prisma.adminActionLog.deleteMany({
    where: { adminUserId: { in: createdUserIds } },
  });
  await prisma.tournament.deleteMany({
    where: { id: { in: createdTournamentIds } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: createdUserIds } },
  });
  createdUserIds.length = 0;
  createdTournamentIds.length = 0;
});

describe("authorization rules", () => {
  it("allows ADMIN and OWNER to manage, but not PLAYER", () => {
    expect(canManage("PLAYER")).toBe(false);
    expect(canManage("ADMIN")).toBe(true);
    expect(canManage("OWNER")).toBe(true);
  });
});

describe("tournament service", () => {
  it("creates a tournament as DRAFT and opens registration from DRAFT", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createDraftTournament(admin.id);

    expect(tournament.status).toBe("DRAFT");

    const opened = await openRegistration(admin.id, tournament.id);

    expect(opened.status).toBe("REGISTRATION");
  });

  it("rejects editing an ACTIVE tournament", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const player = await createUser(UserRole.PLAYER);
    const tournament = await createDraftTournament(admin.id);
    await createRatingConfigVersion(admin.id, tournament.id, validRatingConfig());
    await openRegistration(admin.id, tournament.id);
    await joinTournament(player.id, tournament.id, { areaXp: 2500 });
    await startTournament(admin.id, tournament.id);

    await expect(
      updateTournament(admin.id, tournament.id, {
        name: "blocked",
        startsAt: null,
        endsAt: null,
      }),
    ).rejects.toThrow("Only DRAFT or REGISTRATION tournaments can be edited.");
  });

  it("creates rating config version 1, then version 2 while inactivating version 1", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createDraftTournament(admin.id);

    const v1 = await createRatingConfigVersion(admin.id, tournament.id, validRatingConfig(100));
    const v2 = await createRatingConfigVersion(admin.id, tournament.id, {
      ...validRatingConfig(50),
      winBonus: "15",
    });

    const configs = await prisma.tournamentRatingConfig.findMany({
      where: { tournamentId: tournament.id },
      orderBy: { version: "asc" },
      include: { xpMultiplierTiers: true },
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(configs.map((config) => [config.version, config.isActive])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(configs[0].xpMultiplierTiers).toHaveLength(12);
    expect(configs[1].xpMultiplierTiers).toHaveLength(22);
    expect(configs.filter((config) => config.isActive)).toHaveLength(1);
  });

  it("rejects multiplier values less than or equal to zero", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createDraftTournament(admin.id);
    const invalid = validRatingConfig(100);
    invalid.multipliers[0].multiplier = "0";

    await expect(createRatingConfigVersion(admin.id, tournament.id, invalid)).rejects.toThrow(
      "multiplier must be greater than zero.",
    );
  });

  it("allows joining only during REGISTRATION and stores rating as null", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const player = await createUser(UserRole.PLAYER);
    const tournament = await createDraftTournament(admin.id);

    await expect(joinTournament(player.id, tournament.id, { areaXp: 2500 })).rejects.toThrow(
      "Tournament registration is not open.",
    );

    await openRegistration(admin.id, tournament.id);
    const participant = await joinTournament(player.id, tournament.id, { areaXp: 2500 });

    expect(participant.rating).toBeNull();

    await expect(joinTournament(player.id, tournament.id, { areaXp: 2500 })).rejects.toThrow(
      "Already joined this tournament.",
    );
  });

  it("rejects start without config or participants", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createDraftTournament(admin.id);
    await openRegistration(admin.id, tournament.id);

    await expect(startTournament(admin.id, tournament.id)).rejects.toThrow(
      "Tournament must have exactly one active rating config.",
    );

    await createRatingConfigVersion(admin.id, tournament.id, validRatingConfig());

    await expect(startTournament(admin.id, tournament.id)).rejects.toThrow(
      "Tournament must have at least one active participant.",
    );
  });

  it("starts tournament and initializes every active participant with the same initial rating", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const playerA = await createUser(UserRole.PLAYER);
    const playerB = await createUser(UserRole.PLAYER);
    const tournament = await createDraftTournament(admin.id);
    const config = await createRatingConfigVersion(admin.id, tournament.id, validRatingConfig());
    await openRegistration(admin.id, tournament.id);
    await joinTournament(playerA.id, tournament.id, { areaXp: 2367 });
    await joinTournament(playerB.id, tournament.id, { areaXp: 3042 });

    const started = await startTournament(admin.id, tournament.id);
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id, isActive: true },
      orderBy: { userId: "asc" },
    });

    expect(started.status).toBe("ACTIVE");
    expect(started.startRatingConfigId).toBe(config.id);
    expect(started.startRatingConfigVersion).toBe(1);
    expect(participants).toHaveLength(2);

    for (const participant of participants) {
      expect(new Prisma.Decimal(participant.rating ?? 0).equals("1200")).toBe(true);
      expect(participant.ratingInitializedAt).toBeInstanceOf(Date);
      expect(participant.initialRatingConfigId).toBe(config.id);
      expect(participant.initialRatingConfigVersion).toBe(1);
    }

    await expect(joinTournament(playerA.id, tournament.id, { areaXp: 2500 })).rejects.toThrow(
      "Tournament registration is not open.",
    );
  });
});
