import { Prisma, TournamentPhaseStatus, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { findXpTier } from "@/lib/match-flow/xp";
import {
  applyRating,
  cancelMatch,
  forceResult,
  openResultReporting,
  startMatch,
  submitPlayerVotes,
  submitResultReport,
} from "@/lib/match-flow/service";
import { joinQueue, runMatchmaking } from "@/lib/matchmaking/service";
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
    data: { name: `phase4-${crypto.randomUUID()}`, role },
  });
  createdUserIds.push(user.id);
  return user;
}

function multipliers(stepSize: 50 | 100, fallback = "1.0") {
  return buildDefaultMultiplierPayload(stepSize, fallback).map((tier) => {
    if (tier.minXp === null) return { ...tier, multiplier: "1.5" };
    if (tier.minXp === 2000) return { ...tier, multiplier: "1.4" };
    if (tier.minXp === 2950) return { ...tier, multiplier: "0.6" };
    if (tier.minXp === 2900) return { ...tier, multiplier: "0.6" };
    if (tier.minXp === 3000) return { ...tier, multiplier: "0.5" };
    return tier;
  });
}

async function createReadyMatch(options?: {
  stepSize?: 50 | 100;
  strongVotePoints?: string;
  weakVotePoints?: string;
  winBonus?: string;
  baseMultiplier?: string;
}) {
  const admin = await createUser(UserRole.ADMIN);
  const tournament = await createTournament(admin.id, {
    name: `phase4-${crypto.randomUUID()}`,
    startsAt: null,
    endsAt: null,
  });
  createdTournamentIds.push(tournament.id);
  const stepSize = options?.stepSize ?? 100;
  await createRatingConfigVersion(admin.id, tournament.id, {
    initialRating: "1000",
    winBonus: options?.winBonus ?? "10",
    strongVotePoints: options?.strongVotePoints ?? "10",
    weakVotePoints: options?.weakVotePoints ?? "5",
    losingStreakPenalty: "20",
    xpTierStepSize: stepSize,
    multipliers: multipliers(stepSize, options?.baseMultiplier ?? "1.0"),
  });
  await openRegistration(admin.id, tournament.id);
  const players = [];
  const areaXps = [1999, 2000, 2367, 2500, 2743, 2999, 3000, 3042];
  for (let index = 0; index < 8; index += 1) {
    const player = await createUser(UserRole.PLAYER);
    players.push(player);
    await joinTournament(player.id, tournament.id, { areaXp: areaXps[index], participantName: `Player ${index}` });
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
  for (const player of players) {
    await joinQueue(player.id, phase.id);
  }
  const result = await runMatchmaking(phase.id);
  if (!result.matched) throw new Error("Expected match");
  const match = await prisma.match.findUniqueOrThrow({
    where: { id: result.matchId },
    include: { players: true },
  });
  await startMatch(match.id);
  await openResultReporting(match.id);
  return { admin, tournament, players, match };
}

afterEach(async () => {
  await prisma.adminActionLog.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.tournament.deleteMany({ where: { id: { in: createdTournamentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
  createdTournamentIds.length = 0;
});

describe("XP tier lookup", () => {
  it("handles nullable lower and upper bounds and 100/50 step boundaries", async () => {
    const { tournament } = await createReadyMatch({ stepSize: 100 });
    const config100 = await prisma.tournamentRatingConfig.findFirstOrThrow({
      where: { tournamentId: tournament.id, isActive: true },
      include: { xpMultiplierTiers: true },
    });
    expect(findXpTier(1999, config100.xpMultiplierTiers).minXp).toBeNull();
    expect(findXpTier(2000, config100.xpMultiplierTiers).minXp).toBe(2000);
    expect(findXpTier(2999, config100.xpMultiplierTiers).minXp).toBe(2900);
    expect(findXpTier(3000, config100.xpMultiplierTiers).maxXp).toBeNull();
  });
});

describe("PlayerVote validation", () => {
  it("rejects self, teammate, outside user, duplicate types, same target, and double submission", async () => {
    const { admin, match } = await createReadyMatch();
    const voter = match.players[0];
    const teammate = match.players.find((player) => player.team === voter.team && player.userId !== voter.userId)!;
    const opponentA = match.players.find((player) => player.team !== voter.team)!;
    const opponentB = match.players.find((player) => player.team !== voter.team && player.userId !== opponentA.userId)!;
    const outsider = await createUser(UserRole.PLAYER);

    await forceResult(admin.id, match.id, "A", "test");

    await expect(
      submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: voter.userId, voteType: "STRONG" },
        { targetUserId: opponentA.userId, voteType: "WEAK" },
      ]),
    ).rejects.toThrow("Cannot vote for yourself.");
    await expect(
      submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: teammate.userId, voteType: "STRONG" },
        { targetUserId: opponentA.userId, voteType: "WEAK" },
      ]),
    ).rejects.toThrow("Cannot vote for a teammate.");
    await expect(
      submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: outsider.id, voteType: "STRONG" },
        { targetUserId: opponentA.userId, voteType: "WEAK" },
      ]),
    ).rejects.toThrow("Vote target must be a match player.");
    await expect(
      submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: opponentA.userId, voteType: "STRONG" },
        { targetUserId: opponentB.userId, voteType: "STRONG" },
      ]),
    ).rejects.toThrow("Submit one STRONG and one WEAK vote.");
    await expect(
      submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: opponentA.userId, voteType: "WEAK" },
        { targetUserId: opponentB.userId, voteType: "WEAK" },
      ]),
    ).rejects.toThrow("Submit one STRONG and one WEAK vote.");
    await expect(
      submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: opponentA.userId, voteType: "STRONG" },
        { targetUserId: opponentA.userId, voteType: "WEAK" },
      ]),
    ).rejects.toThrow("STRONG and WEAK cannot target the same player.");

    const votes = await submitPlayerVotes(voter.userId, match.id, [
      { targetUserId: opponentA.userId, voteType: "STRONG" },
      { targetUserId: opponentB.userId, voteType: "WEAK" },
    ]);
    expect(votes).toHaveLength(2);

    await expect(
      submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: opponentA.userId, voteType: "STRONG" },
        { targetUserId: opponentB.userId, voteType: "WEAK" },
      ]),
    ).rejects.toThrow("Votes have already been submitted.");
  });
});

describe("result reports and rating application", () => {
  async function voteAll(matchId: string) {
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId }, include: { players: true } });
    for (const voter of match.players) {
      const opponents = match.players.filter((player) => player.team !== voter.team);
      await submitPlayerVotes(voter.userId, matchId, [
        { targetUserId: opponents[0].userId, voteType: "STRONG" },
        { targetUserId: opponents[1].userId, voteType: "WEAK" },
      ]);
    }
  }

  it("allows only room host or admin to end a playing match", async () => {
    const { admin, match } = await createReadyMatch();
    const reloaded = await prisma.match.update({ where: { id: match.id }, data: { status: "PLAYING" } });
    const hostId = reloaded.roomHostUserId!;
    const nonHost = match.players.find((player) => player.userId !== hostId)!;

    await expect(openResultReporting(match.id, nonHost.userId, UserRole.PLAYER)).rejects.toThrow("Only the room host or admin can end the match.");
    await openResultReporting(match.id, hostId, UserRole.PLAYER);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).status).toBe("RESULT_REPORTING");

    await prisma.match.update({ where: { id: match.id }, data: { status: "PLAYING" } });
    await openResultReporting(match.id, admin.id, admin.role);
    expect((await prisma.match.findUniqueOrThrow({ where: { id: match.id } })).status).toBe("RESULT_REPORTING");
  });

  it("allows only room host or admin to confirm the normal result", async () => {
    const { admin, match } = await createReadyMatch();
    const hostId = match.roomHostUserId!;
    const nonHost = match.players.find((player) => player.userId !== hostId)!;

    await expect(submitResultReport(nonHost.userId, match.id, "A", UserRole.PLAYER)).rejects.toThrow("Only the room host or admin can confirm the result.");
    const hostConfirmed = await submitResultReport(hostId, match.id, "A", UserRole.PLAYER);
    expect(hostConfirmed.status).toBe("VOTE_REPORTING");
    expect(hostConfirmed.winnerTeam).toBe("A");

    await prisma.match.update({ where: { id: match.id }, data: { status: "RESULT_REPORTING", winnerTeam: null } });
    const adminConfirmed = await submitResultReport(admin.id, match.id, "B", admin.role);
    expect(adminConfirmed.status).toBe("VOTE_REPORTING");
    expect(adminConfirmed.winnerTeam).toBe("B");
  });

  it("applies Decimal rating changes, creates histories, updates streaks, and confirms match", async () => {
    const { admin, match } = await createReadyMatch({
      strongVotePoints: "12",
      weakVotePoints: "6",
      winBonus: "15",
      baseMultiplier: "1.05",
    });
    await forceResult(admin.id, match.id, "A", "test");
    await voteAll(match.id);

    const confirmed = await prisma.match.findUniqueOrThrow({
      where: { id: match.id },
      include: { players: true, ratingHistories: true },
    });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.ratingAppliedAt).toBeInstanceOf(Date);
    expect(confirmed.ratingHistories).toHaveLength(8);
    expect(confirmed.players.every((player) => player.ratingAfter !== null)).toBe(true);
    expect(confirmed.ratingHistories.every((history) => history.ratingConfigVersionUsed === 1)).toBe(true);

    const winnerHistory = confirmed.ratingHistories.find((history) => {
      const player = confirmed.players.find((item) => item.userId === history.userId);
      return player?.team === "A";
    })!;
    expect(new Prisma.Decimal(winnerHistory.winBonusUsed).equals("15")).toBe(true);
    expect(new Prisma.Decimal(winnerHistory.strongVotePointsUsed).equals("12")).toBe(true);
    expect(new Prisma.Decimal(winnerHistory.weakVotePointsUsed).equals("6")).toBe(true);
    expect(new Prisma.Decimal(winnerHistory.ratingAfter).gte(winnerHistory.ratingBefore)).toBe(true);

    const participants = await prisma.tournamentParticipant.findMany({ where: { tournamentId: match.tournamentId } });
    expect(participants.every((participant) => participant.matchesPlayed === 1)).toBe(true);
    for (const participant of participants) {
      const player = confirmed.players.find((item) => item.userId === participant.userId)!;
      if (player.team === "A") {
        expect(participant.wins).toBe(1);
        expect(participant.winningStreak).toBe(1);
        expect(participant.losingStreak).toBe(0);
      } else {
        expect(participant.losses).toBe(1);
        expect(participant.winningStreak).toBe(0);
        expect(participant.losingStreak).toBe(1);
      }
    }
  });

  it("rejects apply before all votes and rejects double apply", async () => {
    const { admin, match } = await createReadyMatch();
    await forceResult(admin.id, match.id, "A", "test");
    await expect(applyRating(match.id)).rejects.toThrow("All 8 players must complete STRONG and WEAK votes.");
    await voteAll(match.id);
    await expect(applyRating(match.id)).rejects.toThrow("Rating has already been applied or match is not ready.");
  });

  it("rolls back when participant rating no longer matches MatchPlayer.ratingBefore", async () => {
    const { admin, match } = await createReadyMatch();
    await forceResult(admin.id, match.id, "A", "test");
    const first = match.players[0];
    await prisma.tournamentParticipant.update({
      where: { tournamentId_userId: { tournamentId: match.tournamentId, userId: first.userId } },
      data: { rating: "9999" },
    });
    await voteAll(match.id);

    await expect(applyRating(match.id)).rejects.toThrow("Participant rating no longer matches MatchPlayer.ratingBefore.");
    const histories = await prisma.ratingHistory.count({ where: { matchId: match.id } });
    const reloaded = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(histories).toBe(0);
    expect(reloaded.status).toBe("VOTE_REPORTING");
    expect(reloaded.ratingAppliedAt).toBeNull();
  });

  it("allows only one concurrent apply to persist", async () => {
    const { admin, match } = await createReadyMatch();
    await forceResult(admin.id, match.id, "A", "test");
    await voteAll(match.id);

    await Promise.allSettled([applyRating(match.id), applyRating(match.id)]);
    const histories = await prisma.ratingHistory.count({ where: { matchId: match.id } });
    const reloaded = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });

    expect(histories).toBe(8);
    expect(reloaded.status).toBe("CONFIRMED");
  });

  it("does not auto-apply after 7 voters but applies after the 8th voter", async () => {
    const { admin, match } = await createReadyMatch();
    await forceResult(admin.id, match.id, "A", "test");

    for (const voter of match.players.slice(0, 7)) {
      const opponents = match.players.filter((player) => player.team !== voter.team);
      await submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: opponents[0].userId, voteType: "STRONG" },
        { targetUserId: opponents[1].userId, voteType: "WEAK" },
      ]);
    }

    let reloaded = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(reloaded.status).toBe("VOTE_REPORTING");
    expect(reloaded.ratingAppliedAt).toBeNull();
    expect(await prisma.ratingHistory.count({ where: { matchId: match.id } })).toBe(0);

    const lastVoter = match.players[7];
    const opponents = match.players.filter((player) => player.team !== lastVoter.team);
    await submitPlayerVotes(lastVoter.userId, match.id, [
      { targetUserId: opponents[0].userId, voteType: "STRONG" },
      { targetUserId: opponents[1].userId, voteType: "WEAK" },
    ]);

    reloaded = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    const votes = await prisma.playerVote.findMany({ where: { matchId: match.id } });
    expect(reloaded.status).toBe("CONFIRMED");
    expect(reloaded.ratingAppliedAt).toBeInstanceOf(Date);
    expect(votes).toHaveLength(16);
    expect(new Set(votes.map((vote) => vote.voterUserId))).toHaveLength(8);
    expect(await prisma.ratingHistory.count({ where: { matchId: match.id } })).toBe(8);
  });

  it("auto-applies independently for separate matches", async () => {
    const first = await createReadyMatch();
    const second = await createReadyMatch();
    await forceResult(first.admin.id, first.match.id, "A", "test");
    await forceResult(second.admin.id, second.match.id, "B", "test");

    await voteAll(first.match.id);

    let firstMatch = await prisma.match.findUniqueOrThrow({ where: { id: first.match.id } });
    let secondMatch = await prisma.match.findUniqueOrThrow({ where: { id: second.match.id } });
    expect(firstMatch.status).toBe("CONFIRMED");
    expect(await prisma.ratingHistory.count({ where: { matchId: first.match.id } })).toBe(8);
    expect(secondMatch.status).toBe("VOTE_REPORTING");
    expect(secondMatch.ratingAppliedAt).toBeNull();
    expect(await prisma.ratingHistory.count({ where: { matchId: second.match.id } })).toBe(0);

    await voteAll(second.match.id);

    firstMatch = await prisma.match.findUniqueOrThrow({ where: { id: first.match.id } });
    secondMatch = await prisma.match.findUniqueOrThrow({ where: { id: second.match.id } });
    expect(firstMatch.status).toBe("CONFIRMED");
    expect(secondMatch.status).toBe("CONFIRMED");
    expect(await prisma.ratingHistory.count({ where: { matchId: first.match.id } })).toBe(8);
    expect(await prisma.ratingHistory.count({ where: { matchId: second.match.id } })).toBe(8);
  });

  it("auto-apply remains single when final votes arrive concurrently", async () => {
    const { admin, match } = await createReadyMatch();
    await forceResult(admin.id, match.id, "A", "test");

    for (const voter of match.players.slice(0, 6)) {
      const opponents = match.players.filter((player) => player.team !== voter.team);
      await submitPlayerVotes(voter.userId, match.id, [
        { targetUserId: opponents[0].userId, voteType: "STRONG" },
        { targetUserId: opponents[1].userId, voteType: "WEAK" },
      ]);
    }

    await Promise.all(
      match.players.slice(6).map((voter) => {
        const opponents = match.players.filter((player) => player.team !== voter.team);
        return submitPlayerVotes(voter.userId, match.id, [
          { targetUserId: opponents[0].userId, voteType: "STRONG" },
          { targetUserId: opponents[1].userId, voteType: "WEAK" },
        ]);
      }),
    );

    const histories = await prisma.ratingHistory.findMany({ where: { matchId: match.id } });
    const reloaded = await prisma.match.findUniqueOrThrow({ where: { id: match.id } });
    expect(histories).toHaveLength(8);
    expect(new Set(histories.map((history) => history.userId))).toHaveLength(8);
    expect(reloaded.status).toBe("CONFIRMED");
  });

  it("cancels an unconfirmed match without rating updates or queue restoration", async () => {
    const { admin, match } = await createReadyMatch();
    await cancelMatch(admin.id, match.id, "test cancel");
    const reloaded = await prisma.match.findUniqueOrThrow({
      where: { id: match.id },
      include: { players: true, queueEntries: true },
    });
    const participants = await prisma.tournamentParticipant.findMany({ where: { tournamentId: match.tournamentId } });

    expect(reloaded.status).toBe("CANCELLED");
    expect(reloaded.players.every((player) => player.ratingAfter === null)).toBe(true);
    expect(participants.every((participant) => participant.matchesPlayed === 0)).toBe(true);
    expect(reloaded.queueEntries.every((entry) => entry.status === "MATCHED")).toBe(true);
  });
});
