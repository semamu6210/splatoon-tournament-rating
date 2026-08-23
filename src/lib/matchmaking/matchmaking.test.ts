import { Prisma, TournamentPhaseStatus, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { calculateMatchingPower } from "@/lib/matchmaking/rating";
import { selectEightPlayers } from "@/lib/matchmaking/selection";
import { splitIntoBalancedTeams } from "@/lib/matchmaking/team";
import type { WaitingPlayer } from "@/lib/matchmaking/types";
import { checkAndAdvanceRound, getQueueStatus, joinQueue, joinQueueAndRunMatchmaking, leaveQueue, runMatchmaking } from "@/lib/matchmaking/service";
import { prisma } from "@/lib/prisma";
import { buildDefaultMultiplierPayload } from "@/lib/rating-config";
import {
  createRatingConfigVersion,
  createTournament,
  joinTournament,
  openRegistration,
  startTournament,
} from "@/lib/tournament-service";

const createdUserIds: string[] = [];
const createdTournamentIds: string[] = [];

async function createUser(role: UserRole) {
  const user = await prisma.user.create({
    data: {
      name: `phase3-${crypto.randomUUID()}`,
      role,
    },
  });

  createdUserIds.push(user.id);
  return user;
}

function ratingConfig() {
  return {
    initialRating: "1000",
    winBonus: "10",
    strongVotePoints: "10",
    weakVotePoints: "5",
    losingStreakPenalty: "20",
    xpTierStepSize: 100,
    multipliers: buildDefaultMultiplierPayload(100),
  };
}

async function createActiveTournamentWithPhase(playerCount: number) {
  const admin = await createUser(UserRole.ADMIN);
  const tournament = await createTournament(admin.id, {
    name: `phase3-${crypto.randomUUID()}`,
    startsAt: null,
    endsAt: null,
  });
  createdTournamentIds.push(tournament.id);

  await createRatingConfigVersion(admin.id, tournament.id, ratingConfig());
  await openRegistration(admin.id, tournament.id);

  const players = [];
  for (let index = 0; index < playerCount; index += 1) {
    const player = await createUser(UserRole.PLAYER);
    players.push(player);
    await joinTournament(player.id, tournament.id, { areaXp: 2400 + index, participantName: `Player ${index}` });
  }

  await startTournament(admin.id, tournament.id);

  const phase = await prisma.tournamentPhase.create({
    data: {
      tournamentId: tournament.id,
      phaseType: "QUALIFIER",
      status: TournamentPhaseStatus.ACTIVE,
      requiredMatchesPerPlayer: 10,
      sortOrder: 1,
    },
  });

  return { admin, tournament, phase, players };
}

async function createBlocksForPlayers(phaseId: string, groups: Array<{ name: string; players: Array<{ id: string }> }>) {
  for (let index = 0; index < groups.length; index += 1) {
    const block = await prisma.tournamentBlock.create({
      data: { phaseId, name: groups[index].name, sortOrder: index + 1 },
    });
    const participants = await prisma.tournamentParticipant.findMany({
      where: { userId: { in: groups[index].players.map((player) => player.id) } },
    });
    if (participants.length === 0) continue;
    await prisma.tournamentBlockParticipant.createMany({
      data: participants.map((participant) => ({
        phaseId,
        blockId: block.id,
        tournamentParticipantId: participant.id,
      })),
    });
  }
}

async function createSnapshotMatch(params: {
  tournamentId: string;
  phaseId: string;
  userIds: string[];
  status: "CREATED" | "PLAYING" | "RESULT_REPORTING" | "VOTE_REPORTING" | "CONFIRMED";
  roundNumber?: number;
}) {
  const config = await prisma.tournamentRatingConfig.findFirstOrThrow({
    where: { tournamentId: params.tournamentId, isActive: true },
  });
  const matchCount = await prisma.match.count({ where: { phaseId: params.phaseId } });
  const match = await prisma.match.create({
    data: {
      tournamentId: params.tournamentId,
      phaseId: params.phaseId,
      ratingConfigId: config.id,
      ratingConfigVersion: config.version,
      matchNumber: matchCount + 1,
      roundNumber: params.roundNumber,
      status: params.status,
      ratingAppliedAt: params.status === "CONFIRMED" ? new Date() : null,
      rule: "AREA",
    },
  });
  await prisma.matchPlayer.createMany({
    data: params.userIds.map((userId, index) => ({
      matchId: match.id,
      userId,
      team: index % 2 === 0 ? "A" : "B",
      ratingBefore: "1000",
      matchingRatingAtMatch: "2500",
      areaXpAtMatch: 2500,
      losingStreakAtMatch: 0,
    })),
  });
  return match;
}

function waitingPlayer(params: {
  userId: string;
  rating?: string;
  areaXp?: number;
  losingStreak?: number;
  joinedAt: Date;
  opponents?: string[];
  teammates?: string[];
}): WaitingPlayer {
  return {
    queueEntryId: `queue-${params.userId}`,
    userId: params.userId,
    joinedAt: params.joinedAt,
    rating: new Prisma.Decimal(params.rating ?? "1000"),
    losingStreak: params.losingStreak ?? 0,
    areaXp: params.areaXp ?? 2500,
    isDummy: false,
    completedMatchesInPhase: 0,
    recentOpponentIds: new Set(params.opponents ?? []),
    recentTeammateIds: new Set(params.teammates ?? []),
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

describe("matching power", () => {
  it("uses area XP minus 50 per losing streak without using tournament rating", () => {
    expect(calculateMatchingPower({ areaXp: 2700, losingStreak: 0 }).toString()).toBe("2700");
    expect(calculateMatchingPower({ areaXp: 2800, losingStreak: 2 }).toString()).toBe("2700");
    expect(calculateMatchingPower({ areaXp: 2500, losingStreak: 3 }).toString()).toBe("2350");
  });

  it("ignores tournament rating when calculating matching power", () => {
    expect(calculateMatchingPower({ areaXp: 2600, losingStreak: 1 }).toString()).toBe("2550");
  });
});

describe("candidate selection", () => {
  it("returns null with fewer than 8 players", () => {
    const players = Array.from({ length: 7 }, (_, index) =>
      waitingPlayer({
        userId: `p${index}`,
        areaXp: 2500,
        joinedAt: new Date("2026-08-22T00:00:00Z"),
      }),
    );

    expect(selectEightPlayers(players)).toBeNull();
  });

  it("prioritizes candidates close to the oldest anchor", () => {
    const anchorTime = new Date("2026-08-22T00:00:00Z");
    const players = [
      waitingPlayer({ userId: "anchor", rating: "1000", joinedAt: anchorTime }),
      ...Array.from({ length: 7 }, (_, index) =>
        waitingPlayer({
          userId: `close-${index}`,
          rating: String(3000 + index * 200),
          areaXp: 2490 + index,
          joinedAt: new Date("2026-08-22T00:01:00Z"),
        }),
      ),
      waitingPlayer({ userId: "far", rating: "1000", areaXp: 3000, joinedAt: new Date("2026-08-22T00:01:00Z") }),
    ];

    const selected = selectEightPlayers(players, new Date("2026-08-22T00:02:00Z"));

    expect(selected?.map((player) => player.userId)).toContain("anchor");
    expect(selected?.map((player) => player.userId)).not.toContain("far");
  });

  it("keeps the longest waiting least-played player as anchor even when matching power is far away", () => {
    const players = [
      waitingPlayer({ userId: "oldest", areaXp: 3000, joinedAt: new Date("2026-08-22T00:00:00Z") }),
      ...Array.from({ length: 8 }, (_, index) =>
        waitingPlayer({
          userId: `normal-${index}`,
          areaXp: 2500,
          joinedAt: new Date("2026-08-22T00:10:00Z"),
        }),
      ),
    ];

    const selected = selectEightPlayers(players, new Date("2026-08-22T00:15:00Z"));

    expect(selected?.[0].userId).toBe("oldest");
  });

  it("penalizes rematches but still allows them when needed", () => {
    const anchor = waitingPlayer({
      userId: "anchor",
      areaXp: 2500,
      joinedAt: new Date("2026-08-22T00:00:00Z"),
      opponents: ["rematch"],
    });
    const players = [
      anchor,
      waitingPlayer({ userId: "rematch", areaXp: 2500, joinedAt: new Date("2026-08-22T00:01:00Z") }),
      ...Array.from({ length: 7 }, (_, index) =>
        waitingPlayer({
          userId: `other-${index}`,
          areaXp: 2510,
          joinedAt: new Date("2026-08-22T00:01:00Z"),
        }),
      ),
    ];

    const selected = selectEightPlayers(players, new Date("2026-08-22T00:02:00Z"));
    expect(selected?.map((player) => player.userId)).not.toContain("rematch");

    const onlyRematchPool = players.slice(0, 8);
    const fallback = selectEightPlayers(onlyRematchPool, new Date("2026-08-22T00:02:00Z"));
    expect(fallback?.map((player) => player.userId)).toContain("rematch");
  });

  it("does not prefer XP 2000 and XP 3000 in the same candidate group when closer XP players exist", () => {
    const players = [
      waitingPlayer({ userId: "anchor", areaXp: 2500, joinedAt: new Date("2026-08-22T00:00:00Z") }),
      ...Array.from({ length: 7 }, (_, index) =>
        waitingPlayer({
          userId: `near-${index}`,
          areaXp: 2480 + index * 5,
          joinedAt: new Date("2026-08-22T00:01:00Z"),
        }),
      ),
      waitingPlayer({ userId: "low", areaXp: 2000, joinedAt: new Date("2026-08-22T00:01:00Z") }),
      waitingPlayer({ userId: "high", areaXp: 3000, joinedAt: new Date("2026-08-22T00:01:00Z") }),
    ];

    const selected = selectEightPlayers(players, new Date("2026-08-22T00:02:00Z"))?.map((player) => player.userId);

    expect(selected).toContain("anchor");
    expect(selected).not.toContain("low");
    expect(selected).not.toContain("high");
  });

  it("keeps required match count fairness before matching power proximity", () => {
    const players = [
      { ...waitingPlayer({ userId: "oldest", areaXp: 2500, joinedAt: new Date("2026-08-22T00:00:00Z") }), completedMatchesInPhase: 0 },
      ...Array.from({ length: 7 }, (_, index) => ({
        ...waitingPlayer({ userId: `less-${index}`, areaXp: 2700 + index, joinedAt: new Date("2026-08-22T00:02:00Z") }),
        completedMatchesInPhase: 0,
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        ...waitingPlayer({ userId: `more-${index}`, areaXp: 2500 + index, joinedAt: new Date("2026-08-22T00:01:00Z") }),
        completedMatchesInPhase: 1,
      })),
    ];

    const selected = selectEightPlayers(players, new Date("2026-08-22T00:03:00Z"))?.map((player) => player.userId);

    expect(selected?.filter((userId) => userId.startsWith("less-"))).toHaveLength(7);
    expect(selected?.some((userId) => userId.startsWith("more-"))).toBe(false);
  });
});

describe("team assignment", () => {
  it("creates 4v4 teams with minimum matching power difference", () => {
    const players = [1000, 1000, 1100, 1100, 1200, 1200, 1300, 1300].map((power, index) => ({
      ...waitingPlayer({
        userId: `p${index}`,
        areaXp: power,
        joinedAt: new Date("2026-08-22T00:00:00Z"),
      }),
      matchingPower: new Prisma.Decimal(power),
    }));

    const teams = splitIntoBalancedTeams(players);
    const sumA = teams.teamA.reduce((sum, player) => sum.add(player.matchingPower), new Prisma.Decimal(0));
    const sumB = teams.teamB.reduce((sum, player) => sum.add(player.matchingPower), new Prisma.Decimal(0));

    expect(teams.teamA).toHaveLength(4);
    expect(teams.teamB).toHaveLength(4);
    expect(new Set([...teams.teamA, ...teams.teamB].map((player) => player.userId))).toHaveLength(8);
    expect(sumA.sub(sumB).abs().toString()).toBe("0");
    expect(teams.matchingPowerDifference.toString()).toBe("0");
  });
});

describe("queue and matchmaking service", () => {
  it("rejects queue join for non-participants, uninitialized ratings, inactive phases, and duplicate waiting", async () => {
    const { admin, tournament, phase, players } = await createActiveTournamentWithPhase(1);
    const outsider = await createUser(UserRole.PLAYER);

    await expect(joinQueue(outsider.id, phase.id)).rejects.toThrow("Active tournament participation is required.");

    await prisma.tournamentParticipant.update({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[0].id } },
      data: { rating: null, ratingInitializedAt: null },
    });
    await expect(joinQueue(players[0].id, phase.id)).rejects.toThrow("Participant rating is not initialized.");

    await prisma.tournamentParticipant.update({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[0].id } },
      data: { rating: "1000", ratingInitializedAt: new Date() },
    });
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { status: "PENDING" } });
    await expect(joinQueue(players[0].id, phase.id)).rejects.toThrow("Phase is not ACTIVE.");

    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { status: "ACTIVE" } });
    await joinQueue(players[0].id, phase.id);
    await expect(joinQueue(players[0].id, phase.id)).rejects.toThrow("Already waiting in this phase.");

    await prisma.adminActionLog.deleteMany({ where: { adminUserId: admin.id } });
  });

  it("allows leave only for WAITING queue entries", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(1);
    await joinQueue(players[0].id, phase.id);
    const cancelled = await leaveQueue(players[0].id, phase.id);

    expect(cancelled.status).toBe("CANCELLED");
    await expect(leaveQueue(players[0].id, phase.id)).rejects.toThrow("WAITING queue entry not found.");
  });

  it("does not create a match with fewer than 8 waiting players", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(7);
    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }

    const result = await runMatchmaking(phase.id);

    expect(result).toEqual({ matched: false, reason: "NOT_ENOUGH_PLAYERS" });
  });

  it("treats eight waiting players with 0 of 4 confirmed phase matches as eligible", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(8);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 4 } });
    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }

    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error("Expected match");

    const match = await prisma.match.findUniqueOrThrow({ where: { id: result.matchId }, include: { players: true } });
    expect(match.players).toHaveLength(8);
    expect(match.players.map((player) => player.userId).sort()).toEqual(players.map((player) => player.id).sort());
  });

  it("creates a match for eight waiting players in under five seconds", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(8);
    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }

    const startedAt = performance.now();
    const result = await runMatchmaking(phase.id);
    const elapsedMs = performance.now() - startedAt;

    expect(result.matched).toBe(true);
    expect(elapsedMs).toBeLessThan(5000);
  });

  it("excludes only players who reached required confirmed matches", async () => {
    const { tournament, phase, players } = await createActiveTournamentWithPhase(16);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 4 } });
    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }
    for (let index = 0; index < 4; index += 1) {
      await createSnapshotMatch({
        tournamentId: tournament.id,
        phaseId: phase.id,
        userIds: players.slice(0, 8).map((player) => player.id),
        status: "CONFIRMED",
      });
    }

    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error("Expected match");

    const match = await prisma.match.findUniqueOrThrow({ where: { id: result.matchId }, include: { players: true } });
    expect(match.players.map((player) => player.userId).sort()).toEqual(players.slice(8, 16).map((player) => player.id).sort());
  });

  it("excludes only players in unfinished matches and lets confirmed match players queue again", async () => {
    const { tournament, phase, players } = await createActiveTournamentWithPhase(16);
    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }
    await createSnapshotMatch({
      tournamentId: tournament.id,
      phaseId: phase.id,
      userIds: players.slice(0, 8).map((player) => player.id),
      status: "CONFIRMED",
    });
    await createSnapshotMatch({
      tournamentId: tournament.id,
      phaseId: phase.id,
      userIds: players.slice(8, 16).map((player) => player.id),
      status: "CREATED",
    });

    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error("Expected match");

    const match = await prisma.match.findUniqueOrThrow({ where: { id: result.matchId }, include: { players: true } });
    expect(match.players.map((player) => player.userId).sort()).toEqual(players.slice(0, 8).map((player) => player.id).sort());
  });

  it("auto-runs matchmaking on queue join when the 8th player arrives", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(8);
    for (let index = 0; index < 7; index += 1) {
      const result = await joinQueueAndRunMatchmaking(players[index].id, phase.id);
      expect(result.matchmaking.matched).toBe(false);
    }

    const result = await joinQueueAndRunMatchmaking(players[7].id, phase.id);
    const matches = await prisma.match.findMany({ where: { phaseId: phase.id }, include: { players: true } });

    expect(result.matchmaking.matched).toBe(true);
    expect(matches).toHaveLength(1);
    expect(matches[0].matchNumber).toBe(1);
    expect(matches[0].rule).toBe("AREA");
    expect(matches[0].players).toHaveLength(8);
  });

  it("creates Match, MatchPlayer snapshots, and updates QueueEntry to MATCHED", async () => {
    const { tournament, phase, players } = await createActiveTournamentWithPhase(8);
    for (let index = 0; index < players.length; index += 1) {
      await prisma.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[index].id } },
        data: {
          rating: String(1000 + index * 20),
          losingStreak: index % 3,
        },
      });
      await joinQueue(players[index].id, phase.id);
    }

    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error("Expected match");

    const match = await prisma.match.findUnique({
      where: { id: result.matchId },
      include: { players: true, queueEntries: true },
    });

    expect(match?.ratingConfigId).toBeTruthy();
    expect(match?.ratingConfigVersion).toBe(1);
    expect(match?.players).toHaveLength(8);
    expect(match?.players.filter((player) => player.team === "A")).toHaveLength(4);
    expect(match?.players.filter((player) => player.team === "B")).toHaveLength(4);
    expect(new Set(match?.players.map((player) => player.userId))).toHaveLength(8);
    expect(match?.players.every((player) => player.ratingBefore !== null)).toBe(true);
    expect(match?.players.every((player) => player.matchingRatingAtMatch !== null)).toBe(true);
    expect(match?.players.every((player) => player.areaXpAtMatch >= 2400)).toBe(true);
    for (const player of match?.players ?? []) {
      expect(player.matchingRatingAtMatch.toString()).toBe(String(player.areaXpAtMatch - player.losingStreakAtMatch * 50));
    }
    expect(match?.players.every((player) => player.ratingAfter === null)).toBe(true);
    expect(match?.queueEntries).toHaveLength(8);
    expect(match?.queueEntries.every((entry) => entry.status === "MATCHED")).toBe(true);
    expect(match?.privateRoomCode).toMatch(/^[A-Z]{3}$/);
    expect(match?.roomHostUserId).toBeTruthy();
    expect(match?.players.some((player) => player.userId === match.roomHostUserId)).toBe(true);

    const queueStatus = await getQueueStatus(players[0].id, phase.id);
    expect(queueStatus).toEqual({ status: "MATCHED", matchId: match?.id });

    const reloaded = await prisma.match.findUniqueOrThrow({ where: { id: result.matchId } });
    expect(reloaded.privateRoomCode).toBe(match?.privateRoomCode);
    expect(reloaded.roomHostUserId).toBe(match?.roomHostUserId);
  });

  it("does not let tournament rating changes affect XP-based matchmaking snapshots", async () => {
    const { tournament, phase, players } = await createActiveTournamentWithPhase(8);
    for (let index = 0; index < players.length; index += 1) {
      await prisma.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[index].id } },
        data: {
          rating: String(3000 - index * 250),
          areaXp: 2500,
          losingStreak: 0,
        },
      });
      await joinQueue(players[index].id, phase.id);
    }

    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    if (!result.matched) throw new Error("Expected match");

    const match = await prisma.match.findUniqueOrThrow({ where: { id: result.matchId }, include: { players: true } });
    expect(match.players.every((player) => player.matchingRatingAtMatch.toString() === "2500")).toBe(true);
    expect(new Set(match.players.map((player) => player.ratingBefore.toString())).size).toBeGreaterThan(1);
  });

  it("does not reuse private room codes across active matches", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(16);
    for (const player of players.slice(0, 8)) {
      await joinQueue(player.id, phase.id);
    }
    const first = await runMatchmaking(phase.id);
    expect(first.matched).toBe(true);
    if (!first.matched) throw new Error("Expected match");

    for (const player of players.slice(8, 16)) {
      await joinQueue(player.id, phase.id);
    }
    const second = await runMatchmaking(phase.id);
    expect(second.matched).toBe(true);
    if (!second.matched) throw new Error("Expected match");

    const matches = await prisma.match.findMany({ where: { id: { in: [first.matchId, second.matchId] } } });
    expect(matches).toHaveLength(2);
    expect(new Set(matches.map((match) => match.privateRoomCode))).toHaveLength(2);
  });

  it("does not assign the same waiting players to multiple matches during concurrent runs", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(8);
    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }

    const results = await Promise.allSettled([runMatchmaking(phase.id), runMatchmaking(phase.id)]);
    const matches = await prisma.match.findMany({
      where: { phaseId: phase.id },
      include: { players: true },
    });

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(matches).toHaveLength(1);
    expect(matches[0].players).toHaveLength(8);
  });

  it("does not create the next round until every block completes the current round", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(16);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 2 } });
    await createBlocksForPlayers(phase.id, [
      { name: "A", players: players.slice(0, 8) },
      { name: "B", players: players.slice(8, 16) },
    ]);

    const firstRound = await runMatchmaking(phase.id);
    expect(firstRound.matched).toBe(true);
    const roundOneMatches = await prisma.match.findMany({ where: { phaseId: phase.id, roundNumber: 1 }, orderBy: { matchNumber: "asc" } });
    expect(roundOneMatches).toHaveLength(2);

    await prisma.match.update({ where: { id: roundOneMatches[0].id }, data: { status: "CONFIRMED", ratingAppliedAt: new Date() } });
    await checkAndAdvanceRound(phase.id, 1);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(0);

    await prisma.match.update({ where: { id: roundOneMatches[1].id }, data: { status: "CONFIRMED", ratingAppliedAt: new Date() } });
    await checkAndAdvanceRound(phase.id, 1);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(2);
  });

  it("does not complete a block round until its round matches are confirmed with rating applied", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(16);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 2 } });
    await createBlocksForPlayers(phase.id, [
      { name: "A", players: players.slice(0, 8) },
      { name: "B", players: players.slice(8, 16) },
    ]);

    await runMatchmaking(phase.id);
    for (const status of ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING", "CONFIRMED"] as const) {
      await prisma.match.updateMany({
        where: { phaseId: phase.id, roundNumber: 1 },
        data: { status, ratingAppliedAt: null },
      });
      const result = await checkAndAdvanceRound(phase.id, 1);
      const blockStates = await prisma.tournamentPhaseRoundBlock.findMany({
        where: { phaseId: phase.id, roundNumber: 1 },
      });

      expect(result.advanced).toBe(false);
      expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(0);
      expect(blockStates.every((block) => block.status !== "COMPLETED")).toBe(true);
    }
  });

  it("does not complete a block round when the block has no matches", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(8);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 2 } });
    await createBlocksForPlayers(phase.id, [
      { name: "A", players },
      { name: "B", players: [] },
    ]);

    await runMatchmaking(phase.id);
    await prisma.match.updateMany({
      where: { phaseId: phase.id, roundNumber: 1 },
      data: { status: "CONFIRMED", ratingAppliedAt: new Date() },
    });
    await checkAndAdvanceRound(phase.id, 1);

    const blockStates = await prisma.tournamentPhaseRoundBlock.findMany({
      where: { phaseId: phase.id, roundNumber: 1 },
      include: { block: true },
    });
    expect(blockStates.find((state) => state.block.name === "A")?.status).toBe("COMPLETED");
    expect(blockStates.find((state) => state.block.name === "B")?.status).not.toBe("COMPLETED");
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(0);
  });

  it("does not create duplicate next-round matches when round completion is checked concurrently", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(16);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 3 } });
    await createBlocksForPlayers(phase.id, [
      { name: "A", players: players.slice(0, 8) },
      { name: "B", players: players.slice(8, 16) },
    ]);

    await runMatchmaking(phase.id);
    await prisma.match.updateMany({ where: { phaseId: phase.id, roundNumber: 1 }, data: { status: "CONFIRMED", ratingAppliedAt: new Date() } });
    await Promise.allSettled([checkAndAdvanceRound(phase.id, 1), checkAndAdvanceRound(phase.id, 1)]);

    const roundTwoMatches = await prisma.match.findMany({ where: { phaseId: phase.id, roundNumber: 2 } });
    expect(roundTwoMatches).toHaveLength(2);
    expect(new Set(roundTwoMatches.map((match) => match.id))).toHaveLength(2);
  });

  it("keeps block participants eligible before round one matches exist", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(8);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 4 } });
    await createBlocksForPlayers(phase.id, [{ name: "A", players }]);

    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    expect("roundNumber" in result ? result.roundNumber : null).toBe(1);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 1 } })).toBe(1);
  });

  it("repairs missing block assignments for eligible phase participants before synchronized matchmaking", async () => {
    const { phase } = await createActiveTournamentWithPhase(8);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 4 } });
    await prisma.tournamentBlock.create({
      data: { phaseId: phase.id, name: "A", sortOrder: 1 },
    });

    const result = await runMatchmaking(phase.id);

    expect(result.matched).toBe(true);
    expect("roundNumber" in result ? result.roundNumber : null).toBe(1);
    expect(await prisma.tournamentBlockParticipant.count({ where: { phaseId: phase.id } })).toBe(8);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 1 } })).toBe(1);
  });

  it("keeps 1 of 4 confirmed block participants eligible when round two starts", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(8);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 4 } });
    await createBlocksForPlayers(phase.id, [{ name: "A", players }]);

    await runMatchmaking(phase.id);
    await prisma.match.updateMany({ where: { phaseId: phase.id, roundNumber: 1 }, data: { status: "CONFIRMED", ratingAppliedAt: new Date() } });
    const advanced = await checkAndAdvanceRound(phase.id, 1);

    expect(advanced.advanced).toBe(true);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(1);
  });

  it("logs exclusion counts when synchronized round has no eligible players", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { phase, players } = await createActiveTournamentWithPhase(8);
    await createBlocksForPlayers(phase.id, [{ name: "A", players }]);
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: phase.tournamentId },
      select: { id: true },
    });
    await prisma.tournamentPhaseParticipant.createMany({
      data: participants.map((participant) => ({
        phaseId: phase.id,
        tournamentParticipantId: participant.id,
        isEligible: false,
      })),
    });

    const result = await runMatchmaking(phase.id);

    expect(result).toMatchObject({ matched: false, reason: "NO_ELIGIBLE_PLAYERS", roundNumber: 1 });
    expect(warn).toHaveBeenCalledWith(
      "MATCHMAKING_NO_ELIGIBLE_PLAYERS",
      expect.objectContaining({
        phaseId: phase.id,
        mode: "synchronized-round",
        summary: expect.objectContaining({
          waiting: 8,
          eligible: 0,
          excluded: expect.objectContaining({ notPhaseEligible: 8 }),
        }),
      }),
    );
    warn.mockRestore();
  });

  it("does not create a next round after required matches are reached", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(16);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 1 } });
    await createBlocksForPlayers(phase.id, [
      { name: "A", players: players.slice(0, 8) },
      { name: "B", players: players.slice(8, 16) },
    ]);

    await runMatchmaking(phase.id);
    await prisma.match.updateMany({ where: { phaseId: phase.id, roundNumber: 1 }, data: { status: "CONFIRMED", ratingAppliedAt: new Date() } });
    await checkAndAdvanceRound(phase.id, 1);

    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(0);
    expect((await prisma.tournamentPhaseRound.findUniqueOrThrow({ where: { phaseId_roundNumber: { phaseId: phase.id, roundNumber: 1 } } })).status).toBe("COMPLETED");

    const retry = await runMatchmaking(phase.id);
    expect(retry.matched).toBe(false);
    if (retry.matched) throw new Error("Expected no match");
    expect(retry.reason).toBe("REQUIRED_MATCHES_REACHED");
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(0);
  });

  it("continues from the latest completed round instead of recreating round one", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(16);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 2 } });
    await createBlocksForPlayers(phase.id, [
      { name: "A", players: players.slice(0, 8) },
      { name: "B", players: players.slice(8, 16) },
    ]);

    await runMatchmaking(phase.id);
    await prisma.match.updateMany({ where: { phaseId: phase.id, roundNumber: 1 }, data: { status: "CONFIRMED", ratingAppliedAt: new Date() } });
    await prisma.tournamentPhaseRound.update({
      where: { phaseId_roundNumber: { phaseId: phase.id, roundNumber: 1 } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });

    const retry = await runMatchmaking(phase.id);
    expect(retry.matched).toBe(true);
    expect("roundNumber" in retry ? retry.roundNumber : null).toBe(2);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(2);
  });

  it("waits for every match in a block before completing the block round", async () => {
    const { phase, players } = await createActiveTournamentWithPhase(24);
    await prisma.tournamentPhase.update({ where: { id: phase.id }, data: { requiredMatchesPerPlayer: 2 } });
    await createBlocksForPlayers(phase.id, [
      { name: "A", players: players.slice(0, 16) },
      { name: "B", players: players.slice(16, 24) },
    ]);

    await runMatchmaking(phase.id);
    const roundOneMatches = await prisma.match.findMany({ where: { phaseId: phase.id, roundNumber: 1 }, include: { players: true } });
    expect(roundOneMatches).toHaveLength(3);

    await prisma.match.updateMany({ where: { id: { in: roundOneMatches.slice(0, 2).map((match) => match.id) } }, data: { status: "CONFIRMED", ratingAppliedAt: new Date() } });
    await checkAndAdvanceRound(phase.id, 1);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(0);

    await prisma.match.update({ where: { id: roundOneMatches[2].id }, data: { status: "CONFIRMED", ratingAppliedAt: new Date() } });
    await checkAndAdvanceRound(phase.id, 1);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(3);
  });
});
