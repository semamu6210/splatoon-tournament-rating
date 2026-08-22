import { Prisma, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { joinQueue, runMatchmaking } from "@/lib/matchmaking/service";
import {
  createRatingConfigVersion,
  createTournament,
  deleteTournament,
  joinTournament,
  openRegistration,
  startTournament,
  updateTournament,
  updateParticipantName,
} from "@/lib/tournament-service";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildDefaultMultiplierPayload } from "@/lib/rating-config";

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
    await joinTournament(player.id, tournament.id, { areaXp: 2500, participantName: "Active Player" });
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

    await expect(joinTournament(player.id, tournament.id, { areaXp: 2500, participantName: "Before Open" })).rejects.toThrow(
      "Tournament registration is not open.",
    );

    await openRegistration(admin.id, tournament.id);
    const participant = await joinTournament(player.id, tournament.id, { areaXp: 2500, participantName: "せまむ" });

    expect(participant.rating).toBeNull();
    expect(participant.participantName).toBe("せまむ");

    await expect(joinTournament(player.id, tournament.id, { areaXp: 2500, participantName: "Duplicate" })).rejects.toThrow(
      "Already joined this tournament.",
    );
  });

  it("rejects invalid participant names", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const player = await createUser(UserRole.PLAYER);
    const tournament = await createDraftTournament(admin.id);
    await openRegistration(admin.id, tournament.id);

    await expect(joinTournament(player.id, tournament.id, { areaXp: 2500, participantName: "   " })).rejects.toThrow(
      "participantName is required.",
    );
    await expect(joinTournament(player.id, tournament.id, { areaXp: 2500, participantName: "a".repeat(21) })).rejects.toThrow(
      "participantName must be 20 characters or fewer.",
    );
  });

  it("allows participant name changes during REGISTRATION and rejects them after ACTIVE", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const player = await createUser(UserRole.PLAYER);
    const tournament = await createDraftTournament(admin.id);
    await createRatingConfigVersion(admin.id, tournament.id, validRatingConfig());
    await openRegistration(admin.id, tournament.id);
    await joinTournament(player.id, tournament.id, { areaXp: 2500, participantName: "Before" });

    const renamed = await updateParticipantName(player, tournament.id, { participantName: "After" });
    expect(renamed.participantName).toBe("After");

    await startTournament(admin.id, tournament.id);
    await expect(updateParticipantName(player, tournament.id, { participantName: "Blocked" })).rejects.toThrow(
      "participantName can be changed only during REGISTRATION.",
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
    await joinTournament(playerA.id, tournament.id, { areaXp: 2367, participantName: "Player A" });
    await joinTournament(playerB.id, tournament.id, { areaXp: 3042, participantName: "Player B" });

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

    await expect(joinTournament(playerA.id, tournament.id, { areaXp: 2500, participantName: "Late" })).rejects.toThrow(
      "Tournament registration is not open.",
    );
  });

  it("allows ADMIN to delete a tournament and cascades tournament data without deleting users or other tournaments", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const otherTournament = await createDraftTournament(admin.id, `other-${crypto.randomUUID()}`);
    const tournament = await createTournament(admin.id, {
      name: `delete-${crypto.randomUUID()}`,
      startsAt: null,
      endsAt: null,
      stagePoolEnabled: true,
      stageNames: ["ユノハナ大渓谷", "ゴンズイ地区"],
    });
    createdTournamentIds.push(tournament.id);
    await createRatingConfigVersion(admin.id, tournament.id, validRatingConfig());
    await openRegistration(admin.id, tournament.id);

    const players = [];
    for (let index = 0; index < 8; index += 1) {
      const player = await createUser(UserRole.PLAYER);
      players.push(player);
      await joinTournament(player.id, tournament.id, { areaXp: 2400 + index, participantName: `Delete ${index}` });
    }
    await startTournament(admin.id, tournament.id);
    const phase = await prisma.tournamentPhase.create({
      data: { tournamentId: tournament.id, phaseType: "QUALIFIER", status: "ACTIVE", requiredMatchesPerPlayer: 10, sortOrder: 1 },
    });
    const participant = await prisma.tournamentParticipant.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    await prisma.tournamentPhaseParticipant.create({ data: { phaseId: phase.id, tournamentParticipantId: participant.id } });
    const block = await prisma.tournamentBlock.create({ data: { phaseId: phase.id, name: "ブロックA", sortOrder: 1 } });
    await prisma.tournamentBlockParticipant.create({ data: { blockId: block.id, phaseId: phase.id, tournamentParticipantId: participant.id } });

    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }
    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error("Expected match");

    const match = await prisma.match.findUniqueOrThrow({ where: { id: result.matchId }, include: { players: true } });
    await prisma.matchResultReport.create({ data: { matchId: match.id, userId: match.players[0].userId, reportedWinnerTeam: "A" } });
    await prisma.playerVote.create({
      data: {
        matchId: match.id,
        voterUserId: match.players[0].userId,
        targetUserId: match.players.find((player) => player.team !== match.players[0].team)!.userId,
        voteType: "STRONG",
      },
    });
    const config = await prisma.tournamentRatingConfig.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    await prisma.ratingHistory.create({
      data: {
        tournamentId: tournament.id,
        matchId: match.id,
        userId: match.players[0].userId,
        ratingConfigIdUsed: config.id,
        ratingConfigVersionUsed: config.version,
        ratingBefore: "1200",
        strongVotesReceived: 1,
        weakVotesReceived: 0,
        strongVotePointsUsed: "10",
        weakVotePointsUsed: "5",
        winBonusUsed: "10",
        losingStreakPenaltyUsed: "0",
        votePoints: "10",
        baseDelta: "20",
        areaXpUsed: 2400,
        xpMultiplierUsed: "1",
        finalDelta: "20",
        ratingAfter: "1220",
      },
    });

    await deleteTournament(admin, tournament.id, { name: tournament.name });

    expect(await prisma.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();
    expect(await prisma.tournamentStage.count({ where: { tournamentId: tournament.id } })).toBe(0);
    expect(await prisma.tournamentPhase.count({ where: { tournamentId: tournament.id } })).toBe(0);
    expect(await prisma.tournamentParticipant.count({ where: { tournamentId: tournament.id } })).toBe(0);
    expect(await prisma.tournamentRatingConfig.count({ where: { tournamentId: tournament.id } })).toBe(0);
    expect(await prisma.queueEntry.count({ where: { tournamentId: tournament.id } })).toBe(0);
    expect(await prisma.match.count({ where: { tournamentId: tournament.id } })).toBe(0);
    expect(await prisma.matchPlayer.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.matchResultReport.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.playerVote.count({ where: { matchId: match.id } })).toBe(0);
    expect(await prisma.ratingHistory.count({ where: { tournamentId: tournament.id } })).toBe(0);
    expect(await prisma.user.count({ where: { id: { in: players.map((player) => player.id) } } })).toBe(8);
    expect(await prisma.tournament.findUnique({ where: { id: otherTournament.id } })).toBeTruthy();
    expect(await prisma.adminActionLog.findFirst({ where: { action: "TOURNAMENT_DELETED", targetId: tournament.id } })).toBeTruthy();
  });

  it("allows the OWNER who created the tournament to delete it", async () => {
    const owner = await createUser(UserRole.OWNER);
    const tournament = await createDraftTournament(owner.id, `owner-delete-${crypto.randomUUID()}`);

    await deleteTournament(owner, tournament.id, { name: tournament.name });

    expect(await prisma.tournament.findUnique({ where: { id: tournament.id } })).toBeNull();
  });

  it("rejects OWNER deleting a tournament created by someone else", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const owner = await createUser(UserRole.OWNER);
    const tournament = await createDraftTournament(admin.id, `owner-idor-${crypto.randomUUID()}`);

    await expect(deleteTournament(owner, tournament.id, { name: tournament.name })).rejects.toThrow("大会を削除する権限がありません。");
  });

  it("rejects PLAYER deletion with 403", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const player = await createUser(UserRole.PLAYER);
    const tournament = await createDraftTournament(admin.id, `player-delete-${crypto.randomUUID()}`);

    await expect(deleteTournament(player, tournament.id, { name: tournament.name })).rejects.toThrow("大会を削除する権限がありません。");
  });

  it("rejects deleting a missing tournament with 404", async () => {
    const admin = await createUser(UserRole.ADMIN);

    await expect(deleteTournament(admin, "missing-tournament-id", { name: "missing" })).rejects.toThrow("大会が見つかりません。");
  });

  it("rejects deletion when tournament name confirmation does not match", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createDraftTournament(admin.id, `name-mismatch-${crypto.randomUUID()}`);

    await expect(deleteTournament(admin, tournament.id, { name: `${tournament.name}x` })).rejects.toThrow("大会名が一致しません。");
    expect(await prisma.tournament.findUnique({ where: { id: tournament.id } })).toBeTruthy();
  });

  it("rejects unauthenticated DELETE requests", async () => {
    vi.doMock("@/auth", () => ({ auth: async () => null }));
    const { DELETE: deleteTournamentRoute } = await import("@/app/api/tournaments/[tournamentId]/route");
    const response = await deleteTournamentRoute(
      new Request("http://localhost/api/tournaments/missing", {
        method: "DELETE",
        body: JSON.stringify({ name: "missing" }),
      }),
      { params: Promise.resolve({ tournamentId: "missing" }) },
    );

    expect(response.status).toBe(401);
    vi.doUnmock("@/auth");
  });
});
