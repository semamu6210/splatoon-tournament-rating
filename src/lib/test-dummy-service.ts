import { Prisma, TournamentStatus, type UserRole } from "@prisma/client";

import { ApiError } from "@/lib/http";
import { applyRating } from "@/lib/match-flow/service";
import { joinQueue } from "@/lib/matchmaking/service";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
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

    const dummies = await tx.tournamentParticipant.findMany({
      where: { tournamentId, isDummy: true, isActive: true },
      select: { userId: true },
      orderBy: { joinedAt: "asc" },
    });

    return { phaseId: phase.id, userIds: dummies.map((dummy) => dummy.userId) };
  });

  let queued = 0;
  let skipped = 0;
  for (const userId of data.userIds) {
    try {
      await joinQueue(userId, data.phaseId);
      queued += 1;
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
        skipped += 1;
        continue;
      }
      throw error;
    }
  }

  await prisma.adminActionLog.create({
    data: {
      adminUserId,
      action: "TEST_DUMMIES_QUEUED",
      targetType: "Tournament",
      targetId: tournamentId,
      metadata: { phaseId: data.phaseId, queued, skipped },
    },
  });

  return { phaseId: data.phaseId, queued, skipped };
}

function chooseVoteTargets(opponents: Array<{ userId: string }>) {
  if (opponents.length < 2) throw new ApiError(400, "At least two opponents are required for dummy votes.");
  return [
    { targetUserId: opponents[0].userId, voteType: "STRONG" as const },
    { targetUserId: opponents[1].userId, voteType: "WEAK" as const },
  ];
}

export async function submitTestDummyVotes(
  adminUserId: string,
  adminRole: UserRole,
  matchId: string,
  input: { leaveOneRealUserUnvoted?: unknown } = {},
) {
  requireTestDummyAdmin(adminRole);
  const leaveOneRealUserUnvoted = input.leaveOneRealUserUnvoted === true;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      tournament: true,
      players: { orderBy: [{ team: "asc" }, { userId: "asc" }] },
      playerVotes: true,
    },
  });
  if (!match) throw new ApiError(404, "Match not found.");
  if (!match.tournament.isTestTournament) {
    throw new ApiError(403, "Test dummy operations are allowed only for test tournaments.");
  }
  if (match.status !== "VOTE_REPORTING") {
    throw new ApiError(400, "Match must be VOTE_REPORTING.");
  }

  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId: match.tournamentId, userId: { in: match.players.map((player) => player.userId) } },
    select: { userId: true, isDummy: true },
  });
  const dummyUserIds = new Set(participants.filter((participant) => participant.isDummy).map((participant) => participant.userId));
  const realPlayers = match.players.filter((player) => !dummyUserIds.has(player.userId));
  const realUserIdToLeave = leaveOneRealUserUnvoted && realPlayers.length > 0 ? realPlayers.at(-1)?.userId : null;
  const voters = match.players.filter((player) => dummyUserIds.has(player.userId) || (leaveOneRealUserUnvoted && player.userId !== realUserIdToLeave));

  let submitted = 0;
  let skipped = 0;
  for (const voter of voters) {
    const existingVotes = match.playerVotes.filter((vote) => vote.voterUserId === voter.userId);
    if (existingVotes.length > 0) {
      skipped += 1;
      continue;
    }
    const opponents = match.players.filter((player) => player.team !== voter.team);
    const votes = chooseVoteTargets(opponents);
    await prisma.playerVote.createMany({
      data: votes.map((vote) => ({
        matchId,
        voterUserId: voter.userId,
        targetUserId: vote.targetUserId,
        voteType: vote.voteType,
      })),
    });
    submitted += 1;
  }

  await prisma.adminActionLog.create({
    data: {
      adminUserId,
      action: "TEST_DUMMY_VOTES_SUBMITTED",
      targetType: "Match",
      targetId: matchId,
      metadata: { submitted, skipped, leaveOneRealUserUnvoted, realUserIdToLeave },
    },
  });

  await applyRatingIfComplete(matchId);
  return { submitted, skipped, leftUnvotedUserId: realUserIdToLeave };
}

async function applyRatingIfComplete(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: { players: true, playerVotes: true },
  });
  if (!match || match.status !== "VOTE_REPORTING" || !match.winnerTeam || match.ratingAppliedAt || match.players.length !== 8) return;

  const completeVoters = new Set<string>();
  for (const player of match.players) {
    const votes = match.playerVotes.filter((vote) => vote.voterUserId === player.userId);
    if (votes.some((vote) => vote.voteType === "STRONG") && votes.some((vote) => vote.voteType === "WEAK")) {
      completeVoters.add(player.userId);
    }
  }
  if (completeVoters.size !== 8) return;

  try {
    await applyRating(matchId);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return;
    throw error;
  }
}
