import { Prisma, TournamentStatus, type Team, type UserRole } from "@prisma/client";

import { ApiError } from "@/lib/http";
import { attemptAutoApplyRatingForMatch } from "@/lib/match-flow/service";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ensureTestDummiesWaitingForPhase } from "@/lib/test-dummy-queue";
import { submitAutomaticTestVotes } from "@/lib/test-dummy-votes";
import { areaXpValue } from "@/lib/validation";

type Tx = Prisma.TransactionClient;

function positiveInt(value: unknown, field: string) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 30) {
    throw new ApiError(400, `${field} must be an integer between 1 and 30.`);
  }
  return number;
}

async function requireTestTournament(tx: Tx, tournamentId: string) {
  const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) throw new ApiError(404, "Tournament not found.");
  if (!tournament.isTestTournament) {
    throw new ApiError(403, "Test dummy operations are allowed only for test tournaments.");
  }
  return tournament;
}

function requireTestDummyAdmin(role: UserRole) {
  if (!canManage(role)) {
    throw new ApiError(403, "Admin permission required.");
  }
}

function dummyName(index: number) {
  return `Dummy ${String(index).padStart(2, "0")}`;
}

export async function addTestDummies(adminUserId: string, adminRole: UserRole, tournamentId: string, input: { count: unknown; areaXp: unknown }) {
  requireTestDummyAdmin(adminRole);
  const count = positiveInt(input.count, "count");
  const baseXp = areaXpValue(input.areaXp);

  return prisma.$transaction(async (tx) => {
    const tournament = await requireTestTournament(tx, tournamentId);
    if (tournament.status !== TournamentStatus.DRAFT && tournament.status !== TournamentStatus.REGISTRATION) {
      throw new ApiError(400, "Test dummies can be added only before the tournament starts.");
    }

    const existingCount = await tx.tournamentParticipant.count({ where: { tournamentId, isDummy: true } });
    const created = [];

    for (let index = 0; index < count; index += 1) {
      const name = dummyName(existingCount + index + 1);
      const user = await tx.user.create({
        data: {
          name,
          role: "PLAYER",
        },
      });
      const areaXp = areaXpValue(Math.max(0, baseXp + (index - Math.floor(count / 2)) * 50));
      const participant = await tx.tournamentParticipant.create({
        data: {
          tournamentId,
          userId: user.id,
          areaXp,
          participantName: name,
          isDummy: true,
          dummyName: name,
        },
      });
      created.push(participant);
    }

    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "TEST_DUMMIES_ADDED",
        targetType: "Tournament",
        targetId: tournamentId,
        metadata: { count, baseXp, createdUserIds: created.map((participant) => participant.userId) },
      },
    });

    return created;
  });
}

export async function deleteTestDummies(adminUserId: string, adminRole: UserRole, tournamentId: string) {
  requireTestDummyAdmin(adminRole);
  return prisma.$transaction(async (tx) => {
    const tournament = await requireTestTournament(tx, tournamentId);
    if (tournament.status !== TournamentStatus.DRAFT && tournament.status !== TournamentStatus.REGISTRATION) {
      throw new ApiError(400, "Test dummies can be deleted only before the tournament starts.");
    }

    const dummies = await tx.tournamentParticipant.findMany({
      where: { tournamentId, isDummy: true },
      select: { userId: true },
    });
    const userIds = dummies.map((dummy) => dummy.userId);
    if (userIds.length > 0) {
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    }

    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "TEST_DUMMIES_DELETED",
        targetType: "Tournament",
        targetId: tournamentId,
        metadata: { count: userIds.length, userIds },
      },
    });

    return { deleted: userIds.length };
  });
}

export async function queueTestDummies(adminUserId: string, adminRole: UserRole, tournamentId: string) {
  requireTestDummyAdmin(adminRole);
  const data = await prisma.$transaction(async (tx) => {
    const tournament = await requireTestTournament(tx, tournamentId);
    if (tournament.status !== TournamentStatus.ACTIVE) {
      throw new ApiError(400, "Tournament must be ACTIVE.");
    }

    const phase = await tx.tournamentPhase.findFirst({
      where: { tournamentId, status: "ACTIVE" },
      orderBy: { sortOrder: "asc" },
    });
    if (!phase) throw new ApiError(400, "Active phase not found.");

    return { phaseId: phase.id };
  });

  const ensured = await ensureTestDummiesWaitingForPhase(data.phaseId);

  await prisma.adminActionLog.create({
    data: {
      adminUserId,
      action: "TEST_DUMMIES_QUEUED",
      targetType: "Tournament",
      targetId: tournamentId,
      metadata: { phaseId: data.phaseId, queued: ensured.queued, eligible: ensured.eligible },
    },
  });

  return { phaseId: data.phaseId, queued: ensured.queued, eligible: ensured.eligible };
}

export async function submitTestDummyVotes(
  adminUserId: string,
  adminRole: UserRole,
  matchId: string,
  _input: { leaveOneRealUserUnvoted?: unknown } = {},
) {
  requireTestDummyAdmin(adminRole);
  void _input;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      tournament: true,
    },
  });
  if (!match) throw new ApiError(404, "Match not found.");
  if (!match.tournament.isTestTournament) {
    throw new ApiError(403, "Test dummy operations are allowed only for test tournaments.");
  }
  if (match.status !== "VOTE_REPORTING") {
    throw new ApiError(400, "Match must be VOTE_REPORTING.");
  }

  const result = await submitAutomaticTestVotes(matchId);

  await prisma.adminActionLog.create({
    data: {
      adminUserId,
      action: "TEST_DUMMY_VOTES_SUBMITTED",
      targetType: "Match",
      targetId: matchId,
      metadata: { submitted: result.submitted, skipped: result.skipped },
    },
  });

  await attemptAutoApplyRatingForMatch(matchId);
  return { submitted: result.submitted, skipped: result.skipped };
}

function randomWinnerTeam(): Team {
  return Math.random() < 0.5 ? "A" : "B";
}

export async function fullyAutomateTestMatch(adminUserId: string, adminRole: UserRole, matchId: string) {
  requireTestDummyAdmin(adminRole);
  const winnerTeam = randomWinnerTeam();

  const match = await prisma.$transaction(async (tx) => {
    const before = await tx.match.findUnique({
      where: { id: matchId },
      include: { tournament: true, players: true },
    });
    if (!before) throw new ApiError(404, "Match not found.");
    if (!before.tournament.isTestTournament) {
      throw new ApiError(403, "Test dummy operations are allowed only for test tournaments.");
    }
    if (before.players.length !== 8) {
      throw new ApiError(400, "Match must have exactly 8 players.");
    }
    if (before.status === "CONFIRMED") return before;
    if (before.status === "CANCELLED") throw new ApiError(400, "CANCELLED matches cannot be automated.");

    const after = await tx.match.update({
      where: { id: matchId },
      data: { status: "VOTE_REPORTING", winnerTeam },
      include: { tournament: true, players: true },
    });
    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "TEST_MATCH_FULLY_AUTOMATED",
        targetType: "Match",
        targetId: matchId,
        metadata: { before: { status: before.status, winnerTeam: before.winnerTeam }, winnerTeam },
      },
    });
    return after;
  });

  if (match.status !== "CONFIRMED") {
    await submitAutomaticTestVotes(matchId, { includeRealPlayersWhenAllDummy: true });
    await attemptAutoApplyRatingForMatch(matchId);
  }

  return prisma.match.findUniqueOrThrow({ where: { id: matchId } });
}
