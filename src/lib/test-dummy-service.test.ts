import { TournamentPhaseStatus, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { openResultReporting, startMatch, submitPlayerVotes, submitResultReport } from "@/lib/match-flow/service";
import { checkAndAdvanceRound, joinQueue, runMatchmaking } from "@/lib/matchmaking/service";
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

async function makeResultReportingAvailable(matchId: string) {
  await prisma.match.update({ where: { id: matchId }, data: { startedAt: new Date(Date.now() - 61_000) } });
}

async function createBlocksForUserGroups(phaseId: string, groups: Array<{ name: string; userIds: string[] }>) {
  for (let index = 0; index < groups.length; index += 1) {
    const block = await prisma.tournamentBlock.create({
      data: { phaseId, name: groups[index].name, sortOrder: index + 1 },
    });
    const participants = await prisma.tournamentParticipant.findMany({ where: { userId: { in: groups[index].userIds } } });
    await prisma.tournamentBlockParticipant.createMany({
      data: participants.map((participant) => ({
        phaseId,
        blockId: block.id,
        tournamentParticipantId: participant.id,
      })),
    });
  }
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
    await joinTournament(realA.id, tournament.id, { areaXp: 2500, participantName: "Real A" });
    await joinTournament(realB.id, tournament.id, { areaXp: 2550, participantName: "Real B" });

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
    await makeResultReportingAvailable(match.id);
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
    await joinTournament(real.id, tournament.id, { areaXp: 2500, participantName: "Real Player" });
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
    const dummyUserIds = new Set(dummies.map((dummy) => dummy.userId));
    const dummyMatchPlayers = match.players.filter((player) => dummyUserIds.has(player.userId));
    expect(dummyMatchPlayers).toHaveLength(7);
    expect(dummyMatchPlayers.every((player) => player.matchingRatingAtMatch.toString() === String(player.areaXpAtMatch - player.losingStreakAtMatch * 50))).toBe(true);
    expect(await prisma.queueEntry.count({ where: { phaseId: phase.id, status: "WAITING" } })).toBe(0);
  });

  it("auto-closes voting and applies rating when one real user and seven dummies complete 8 votes", async () => {
    const { admin, tournament } = await createConfiguredTournament(true);
    await openRegistration(admin.id, tournament.id);

    const real = await createUser(UserRole.PLAYER);
    await joinTournament(real.id, tournament.id, { areaXp: 2500, participantName: "Real Player" });
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

    const matchmaking = await runMatchmaking(phase.id);
    expect(matchmaking.matched).toBe(true);
    if (!matchmaking.matched) return;

    const match = await prisma.match.findUniqueOrThrow({
      where: { id: matchmaking.matchId },
      include: { players: true },
    });
    expect(match.players).toHaveLength(8);
    expect(match.players.filter((player) => dummies.some((dummy) => dummy.userId === player.userId))).toHaveLength(7);

    const realBefore = await prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: real.id } },
    });

    await startMatch(match.id);
    await makeResultReportingAvailable(match.id);
    await openResultReporting(match.id, real.id, UserRole.PLAYER);
    await submitResultReport(real.id, match.id, "A", UserRole.PLAYER);

    let voteRows = await prisma.playerVote.findMany({ where: { matchId: match.id } });
    expect(new Set(voteRows.map((vote) => vote.voterUserId))).toHaveLength(7);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).status).toBe("VOTE_REPORTING");

    const realPlayer = match.players.find((player) => player.userId === real.id)!;
    const opponents = match.players.filter((player) => player.team !== realPlayer.team);
    await submitPlayerVotes(real.id, match.id, [
      { targetUserId: opponents[0].userId, voteType: "STRONG" },
      { targetUserId: opponents[1].userId, voteType: "WEAK" },
    ]);

    const confirmed = await prisma.match.findUniqueOrThrow({
      where: { id: match.id },
      include: { players: true, ratingHistories: true },
    });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.votingClosedAt).toBeInstanceOf(Date);
    expect(confirmed.ratingAppliedAt).toBeInstanceOf(Date);
    expect(confirmed.ratingHistories).toHaveLength(8);
    expect(confirmed.players.every((player) => player.ratingAfter !== null)).toBe(true);

    voteRows = await prisma.playerVote.findMany({ where: { matchId: match.id } });
    expect(new Set(voteRows.map((vote) => vote.voterUserId))).toHaveLength(8);

    const realAfter = await prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: real.id } },
    });
    const realHistory = confirmed.ratingHistories.find((history) => history.userId === real.id)!;
    expect(realAfter.rating?.equals(realBefore.rating!.add(realHistory.finalDelta))).toBe(true);
    expect(realHistory.finalDelta.gte(0)).toBe(true);
    expect(confirmed.ratingHistories.some((history) => history.finalDelta.gt(0))).toBe(true);
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
    const votes = await prisma.playerVote.findMany({ where: { matchId: matchmaking.matchId } });
    expect(votes).toHaveLength(16);
    expect(new Set(votes.map((vote) => vote.voterUserId))).toHaveLength(8);
    expect(await prisma.ratingHistory.count({ where: { matchId: matchmaking.matchId } })).toBe(8);
    expect(await prisma.queueEntry.count({ where: { phaseId: phase.id, status: "WAITING" } })).toBe(0);
  });

  it("runs synchronized rounds in a dummy tournament and waits for all four blocks", async () => {
    const { admin, tournament } = await createConfiguredTournament(true);
    await openRegistration(admin.id, tournament.id);
    const realUsers = [];
    for (let index = 0; index < 4; index += 1) {
      const user = await createUser(UserRole.PLAYER);
      realUsers.push(user);
      await joinTournament(user.id, tournament.id, { areaXp: 2500 + index, participantName: `Real ${index}` });
    }
    const dummies = await addTestDummies(admin.id, admin.role, tournament.id, { count: 28, areaXp: 2500 });
    createdUserIds.push(...dummies.map((dummy) => dummy.userId));
    await startTournament(admin.id, tournament.id);

    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 2,
        sortOrder: 1,
      },
    });
    const userIds = [...realUsers.map((user) => user.id), ...dummies.map((dummy) => dummy.userId)];
    await createBlocksForUserGroups(phase.id, [
      { name: "A", userIds: userIds.slice(0, 8) },
      { name: "B", userIds: userIds.slice(8, 16) },
      { name: "C", userIds: userIds.slice(16, 24) },
      { name: "D", userIds: userIds.slice(24, 32) },
    ]);

    await runMatchmaking(phase.id);
    const roundOne = await prisma.match.findMany({ where: { phaseId: phase.id, roundNumber: 1 } });
    expect(roundOne).toHaveLength(4);

    await prisma.match.update({ where: { id: roundOne[0].id }, data: { status: "CONFIRMED" } });
    await checkAndAdvanceRound(phase.id, 1);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(0);

    await prisma.match.updateMany({ where: { id: { in: roundOne.slice(1).map((match) => match.id) } }, data: { status: "CONFIRMED" } });
    await checkAndAdvanceRound(phase.id, 1);
    expect(await prisma.match.count({ where: { phaseId: phase.id, roundNumber: 2 } })).toBe(4);
  });

  it("rejects full automation for normal tournaments", async () => {
    const { admin, tournament } = await createConfiguredTournament(false);
    await openRegistration(admin.id, tournament.id);
    const users = [];
    for (let index = 0; index < 8; index += 1) {
      const user = await createUser(UserRole.PLAYER);
      users.push(user);
      await joinTournament(user.id, tournament.id, { areaXp: 2500 + index, participantName: `Normal ${index}` });
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
