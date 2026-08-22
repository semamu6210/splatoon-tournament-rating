import { Prisma, TournamentPhaseStatus, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { calculateMatchingRating } from "@/lib/matchmaking/rating";
import { selectEightPlayers } from "@/lib/matchmaking/selection";
import { splitIntoBalancedTeams } from "@/lib/matchmaking/team";
import type { WaitingPlayer } from "@/lib/matchmaking/types";
import { getQueueStatus, joinQueue, joinQueueAndRunMatchmaking, leaveQueue, runMatchmaking } from "@/lib/matchmaking/service";
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

function waitingPlayer(params: {
  userId: string;
  rating: string;
  joinedAt: Date;
  opponents?: string[];
  teammates?: string[];
}): WaitingPlayer {
  return {
    queueEntryId: `queue-${params.userId}`,
    userId: params.userId,
    joinedAt: params.joinedAt,
    rating: new Prisma.Decimal(params.rating),
    losingStreak: 0,
    losingStreakPenalty: new Prisma.Decimal(20),
    areaXp: 2500,
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

describe("matching rating", () => {
  it("applies losing streak penalty without changing display rating", () => {
    const rating = new Prisma.Decimal(1200);

    expect(calculateMatchingRating({ rating, losingStreak: 0, losingStreakPenalty: 20 }).toString()).toBe("1200");
    expect(calculateMatchingRating({ rating, losingStreak: 1, losingStreakPenalty: 20 }).toString()).toBe("1180");
    expect(calculateMatchingRating({ rating, losingStreak: 3, losingStreakPenalty: 20 }).toString()).toBe("1140");
    expect(rating.toString()).toBe("1200");
  });

  it("uses configurable losingStreakPenalty 50 and never applies winning streak to matching rating", () => {
    const rating = new Prisma.Decimal(1500);

    expect(calculateMatchingRating({ rating, losingStreak: 0, losingStreakPenalty: 50 }).toString()).toBe("1500");
    expect(calculateMatchingRating({ rating, losingStreak: 1, losingStreakPenalty: 50 }).toString()).toBe("1450");
    expect(calculateMatchingRating({ rating, losingStreak: 3, losingStreakPenalty: 50 }).toString()).toBe("1350");
    expect(calculateMatchingRating({ rating, losingStreak: 5, losingStreakPenalty: 50 }).toString()).toBe("1250");
    expect(rating.toString()).toBe("1500");
  });
});

describe("candidate selection", () => {
  it("returns null with fewer than 8 players", () => {
    const players = Array.from({ length: 7 }, (_, index) =>
      waitingPlayer({
        userId: `p${index}`,
        rating: "1000",
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
          rating: String(990 + index),
          joinedAt: new Date("2026-08-22T00:01:00Z"),
        }),
      ),
      waitingPlayer({ userId: "far", rating: "2000", joinedAt: new Date("2026-08-22T00:01:00Z") }),
    ];

    const selected = selectEightPlayers(players, new Date("2026-08-22T00:02:00Z"));

    expect(selected?.map((player) => player.userId)).toContain("anchor");
    expect(selected?.map((player) => player.userId)).not.toContain("far");
  });

  it("keeps the longest waiting player as anchor even when rating is far away", () => {
    const players = [
      waitingPlayer({ userId: "oldest", rating: "3000", joinedAt: new Date("2026-08-22T00:00:00Z") }),
      ...Array.from({ length: 8 }, (_, index) =>
        waitingPlayer({
          userId: `normal-${index}`,
          rating: "1000",
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
      rating: "1000",
      joinedAt: new Date("2026-08-22T00:00:00Z"),
      opponents: ["rematch"],
    });
    const players = [
      anchor,
      waitingPlayer({ userId: "rematch", rating: "1000", joinedAt: new Date("2026-08-22T00:01:00Z") }),
      ...Array.from({ length: 7 }, (_, index) =>
        waitingPlayer({
          userId: `other-${index}`,
          rating: "1010",
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
});

describe("team assignment", () => {
  it("creates 4v4 teams with minimum matching rating difference", () => {
    const players = [1000, 1000, 1100, 1100, 1200, 1200, 1300, 1300].map((rating, index) => ({
      ...waitingPlayer({
        userId: `p${index}`,
        rating: String(rating),
        joinedAt: new Date("2026-08-22T00:00:00Z"),
      }),
      matchingRating: new Prisma.Decimal(rating),
    }));

    const teams = splitIntoBalancedTeams(players);
    const sumA = teams.teamA.reduce((sum, player) => sum.add(player.matchingRating), new Prisma.Decimal(0));
    const sumB = teams.teamB.reduce((sum, player) => sum.add(player.matchingRating), new Prisma.Decimal(0));

    expect(teams.teamA).toHaveLength(4);
    expect(teams.teamB).toHaveLength(4);
    expect(new Set([...teams.teamA, ...teams.teamB].map((player) => player.userId))).toHaveLength(8);
    expect(sumA.sub(sumB).abs().toString()).toBe("0");
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
});
