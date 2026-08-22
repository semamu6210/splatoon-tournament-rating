import { TournamentPhaseStatus, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { openResultReporting, startMatch, submitPlayerVotes, submitResultReport } from "@/lib/match-flow/service";
import { joinQueue, runMatchmaking } from "@/lib/matchmaking/service";
import { prisma } from "@/lib/prisma";
import { buildDefaultMultiplierPayload } from "@/lib/rating-config";
import { addTestDummies, fullyAutomateTestMatch, queueTestDummies, submitTestDummyVotes } from "@/lib/test-dummy-service";
import { startPhase } from "@/lib/phase-service";
import { createRatingConfigVersion, createTournament, joinTournament, openRegistration, startTournament } from "@/lib/tournament-service";

const createdUserIds: string[] = [];
const createdTournamentIds: string[] = [];

async function createUser(role: UserRole) {
  const user = await prisma.user.create({
    data: { name: `dummy-test-${crypto.randomUUID()}`, role },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createConfiguredTournament(isTestTournament: boolean) {
  const admin = await createUser(UserRole.ADMIN);
  const tournament = await createTournament(admin.id, {
    name: `dummy-test-${crypto.randomUUID()}`,
    startsAt: null,
    endsAt: null,
    isTestTournament,
  });
  createdTournamentIds.push(tournament.id);
  await createRatingConfigVersion(admin.id, tournament.id, {
    initialRating: "1000",
    winBonus: "30",
    strongVotePoints: "10",
    weakVotePoints: "5",
    losingStreakPenalty: "20",
    xpTierStepSize: 100,
    multipliers: buildDefaultMultiplierPayload(100),
  });
  return { admin, tournament };
}

afterEach(async () => {
  await prisma.adminActionLog.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.tournament.deleteMany({ where: { id: { in: createdTournamentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
  createdTournamentIds.length = 0;
});

describe("test dummies", () => {
  it("rejects dummy operations for a normal tournament", async () => {
    const { admin, tournament } = await createConfiguredTournament(false);

    await expect(addTestDummies(admin.id, admin.role, tournament.id, { count: 6, areaXp: 2500 })).rejects.toThrow(
      "Test dummy operations are allowed only for test tournaments.",
    );
  });

  it("rejects dummy operations by PLAYER", async () => {
    const { tournament } = await createConfiguredTournament(true);
    const player = await createUser(UserRole.PLAYER);

    await expect(addTestDummies(player.id, player.role, tournament.id, { count: 6, areaXp: 2500 })).rejects.toThrow(
      "Admin permission required.",
    );
  });

  it("adds dummies, matches 2 real users with 6 dummies, auto-votes dummies, and auto-applies on real votes", async () => {
    const { admin, tournament } = await createConfiguredTournament(true);
    await openRegistration(admin.id, tournament.id);

    const realA = await createUser(UserRole.PLAYER);
    const realB = await createUser(UserRole.PLAYER);
    await joinTournament(realA.id, tournament.id, { areaXp: 2500 });
    await joinTournament(realB.id, tournament.id, { areaXp: 2550 });

    const dummies = await addTestDummies(admin.id, admin.role, tournament.id, { count: 6, areaXp: 2500 });
    createdUserIds.push(...dummies.map((dummy) => dummy.userId));
    expect(dummies).toHaveLength(6);
    expect(dummies.every((dummy) => dummy.isDummy && dummy.areaXp >= 2350 && dummy.areaXp <= 2600)).toBe(true);

    await startTournament(admin.id, tournament.id);
    const participants = await prisma.tournamentParticipant.findMany({ where: { tournamentId: tournament.id } });
    expect(participants).toHaveLength(8);
    expect(participants.every((participant) => participant.rating?.toString() === "1000")).toBe(true);

    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 10,
        sortOrder: 1,
      },
    });

    await joinQueue(realA.id, phase.id);
    await joinQueue(realB.id, phase.id);
    const queued = await queueTestDummies(admin.id, admin.role, tournament.id);
    expect(queued.queued).toBe(6);

    const matchmaking = await runMatchmaking(phase.id);
    expect(matchmaking.matched).toBe(true);
    if (!matchmaking.matched) return;

    const match = await prisma.match.findUniqueOrThrow({
      where: { id: matchmaking.matchId },
      include: { players: true },
    });
    expect(match.players).toHaveLength(8);
    expect([realA.id, realB.id]).toContain(match.roomHostUserId);

    await startMatch(match.id);
    await openResultReporting(match.id, match.roomHostUserId!, UserRole.PLAYER);
    await submitResultReport(match.roomHostUserId!, match.id, "A", UserRole.PLAYER);

    const dummyVoteResult = await submitTestDummyVotes(admin.id, admin.role, match.id, { leaveOneRealUserUnvoted: true });
    expect(dummyVoteResult.submitted).toBe(0);

    let voteRows = await prisma.playerVote.findMany({ where: { matchId: match.id } });
    expect(new Set(voteRows.map((vote) => vote.voterUserId))).toHaveLength(6);
    expect(voteRows).toHaveLength(12);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).status).toBe("VOTE_REPORTING");

    for (const realUserId of [realA.id, realB.id]) {
      const realPlayer = match.players.find((player) => player.userId === realUserId)!;
      const opponents = match.players.filter((player) => player.team !== realPlayer.team);
      await submitPlayerVotes(realUserId, match.id, [
        { targetUserId: opponents[0].userId, voteType: "STRONG" },
        { targetUserId: opponents[1].userId, voteType: "WEAK" },
      ]);
    }

    const confirmed = await prisma.match.findUniqueOrThrow({
      where: { id: match.id },
      include: { ratingHistories: true },
    });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.ratingAppliedAt).toBeInstanceOf(Date);
    expect(confirmed.ratingHistories).toHaveLength(8);

    const dummyAfter = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id, isDummy: true },
    });
    expect(dummyAfter.every((dummy) => dummy.matchesPlayed === 1 && dummy.rating !== null)).toBe(true);
    expect(await prisma.queueEntry.count({ where: { phaseId: phase.id, status: "WAITING", userId: { in: dummyAfter.map((dummy) => dummy.userId) } } })).toBe(6);

    voteRows = await prisma.playerVote.findMany({ where: { matchId: match.id } });
    for (const voterId of new Set(voteRows.map((vote) => vote.voterUserId))) {
      const votes = voteRows.filter((vote) => vote.voterUserId === voterId);
      expect(votes).toHaveLength(2);
      expect(new Set(votes.map((vote) => vote.voteType))).toEqual(new Set(["STRONG", "WEAK"]));
      expect(new Set(votes.map((vote) => vote.targetUserId))).toHaveLength(2);
    }
  });

  it("auto-queues 7 dummies for a requiredMatches=4 phase and matches them with one real waiting user", async () => {
    const { admin, tournament } = await createConfiguredTournament(true);
    await openRegistration(admin.id, tournament.id);

    const real = await createUser(UserRole.PLAYER);
    await joinTournament(real.id, tournament.id, { areaXp: 2500 });
    const dummies = await addTestDummies(admin.id, admin.role, tournament.id, { count: 7, areaXp: 2500 });
    createdUserIds.push(...dummies.map((dummy) => dummy.userId));
    await startTournament(admin.id, tournament.id);

    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.PENDING,
        requiredMatchesPerPlayer: 4,
        sortOrder: 1,
      },
    });
    await startPhase(admin.id, phase.id);
    await joinQueue(real.id, phase.id);

    expect(await prisma.queueEntry.count({ where: { phaseId: phase.id, status: "WAITING" } })).toBe(8);

    const matchmaking = await runMatchmaking(phase.id);
    expect(matchmaking.matched).toBe(true);
    if (!matchmaking.matched) return;

    const match = await prisma.match.findUniqueOrThrow({
      where: { id: matchmaking.matchId },
      include: { players: true },
    });
    expect(match.players).toHaveLength(8);
    expect(match.roomHostUserId).toBe(real.id);
    expect(await prisma.queueEntry.count({ where: { phaseId: phase.id, status: "WAITING" } })).toBe(0);
  });

  it("fully automates an all-dummy test match and confirms rating", async () => {
    const { admin, tournament } = await createConfiguredTournament(true);
    await openRegistration(admin.id, tournament.id);
    const dummies = await addTestDummies(admin.id, admin.role, tournament.id, { count: 8, areaXp: 2500 });
    createdUserIds.push(...dummies.map((dummy) => dummy.userId));
    await startTournament(admin.id, tournament.id);

    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
      },
    });
    await queueTestDummies(admin.id, admin.role, tournament.id);
    const matchmaking = await runMatchmaking(phase.id);
    expect(matchmaking.matched).toBe(true);
    if (!matchmaking.matched) return;

    const automated = await fullyAutomateTestMatch(admin.id, admin.role, matchmaking.matchId);
    expect(automated.status).toBe("CONFIRMED");
    expect(automated.winnerTeam === "A" || automated.winnerTeam === "B").toBe(true);
    expect(await prisma.playerVote.count({ where: { matchId: matchmaking.matchId } })).toBe(16);
    expect(await prisma.queueEntry.count({ where: { phaseId: phase.id, status: "WAITING" } })).toBe(0);
  });

  it("rejects full automation for normal tournaments", async () => {
    const { admin, tournament } = await createConfiguredTournament(false);
    await openRegistration(admin.id, tournament.id);
    const users = [];
    for (let index = 0; index < 8; index += 1) {
      const user = await createUser(UserRole.PLAYER);
      users.push(user);
      await joinTournament(user.id, tournament.id, { areaXp: 2500 + index });
    }
    await startTournament(admin.id, tournament.id);
    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
      },
    });
    for (const user of users) {
      await joinQueue(user.id, phase.id);
    }
    const matchmaking = await runMatchmaking(phase.id);
    expect(matchmaking.matched).toBe(true);
    if (!matchmaking.matched) return;

    await expect(fullyAutomateTestMatch(admin.id, admin.role, matchmaking.matchId)).rejects.toThrow(
      "Test dummy operations are allowed only for test tournaments.",
    );
  });
});
