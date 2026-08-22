import { Prisma, type TournamentPhase } from "@prisma/client";

import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

const OPEN_MATCH_STATUSES = ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING"] as const;

async function targetDummyParticipants(
  tx: Tx,
  phase: Pick<TournamentPhase, "id" | "tournamentId" | "phaseType">,
) {
  const explicitTargets = await tx.tournamentPhaseParticipant.findMany({
    where: { phaseId: phase.id, isEligible: true, tournamentParticipant: { isDummy: true, isActive: true } },
    include: { tournamentParticipant: true },
  });
  if (explicitTargets.length > 0) {
    return explicitTargets.map((target) => target.tournamentParticipant);
  }

  return tx.tournamentParticipant.findMany({
    where: {
      tournamentId: phase.tournamentId,
      isActive: true,
      isDummy: true,
      rating: { not: null },
      advancedToMainEvent: phase.phaseType === "MAIN_EVENT" ? true : undefined,
    },
  });
}

async function confirmedCountsByUser(tx: Tx, phaseId: string, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, number>();
  const counts = await tx.matchPlayer.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, match: { phaseId, status: "CONFIRMED" } },
    _count: { userId: true },
  });
  return new Map(counts.map((count) => [count.userId, count._count.userId]));
}

async function hasOpenMatchByUser(tx: Tx, userIds: string[]) {
  if (userIds.length === 0) return new Set<string>();
  const rows = await tx.matchPlayer.findMany({
    where: {
      userId: { in: userIds },
      match: { status: { in: [...OPEN_MATCH_STATUSES] } },
    },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}

async function existingWaitingByUser(tx: Tx, phaseId: string, userIds: string[]) {
  if (userIds.length === 0) return new Set<string>();
  const rows = await tx.queueEntry.findMany({
    where: { phaseId, userId: { in: userIds }, status: "WAITING" },
    select: { userId: true },
  });
  return new Set(rows.map((row) => row.userId));
}

export async function ensureTestDummiesWaitingForPhaseTx(tx: Tx, phaseId: string) {
  const phase = await tx.tournamentPhase.findUnique({
    where: { id: phaseId },
    include: { tournament: true },
  });
  if (!phase || !phase.tournament.isTestTournament || phase.status !== "ACTIVE") {
    return { queued: 0, eligible: 0 };
  }

  const participants = await targetDummyParticipants(tx, phase);
  const userIds = participants.map((participant) => participant.userId);
  const counts = await confirmedCountsByUser(tx, phaseId, userIds);
  const openMatchUserIds = await hasOpenMatchByUser(tx, userIds);
  const waitingUserIds = await existingWaitingByUser(tx, phaseId, userIds);
  const eligible = participants.filter((participant) => {
    const completed = counts.get(participant.userId) ?? 0;
    return completed < phase.requiredMatchesPerPlayer && !openMatchUserIds.has(participant.userId);
  });
  const toQueue = eligible.filter((participant) => !waitingUserIds.has(participant.userId));

  if (toQueue.length > 0) {
    await tx.queueEntry.createMany({
      data: toQueue.map((participant) => ({
        tournamentId: phase.tournamentId,
        phaseId,
        userId: participant.userId,
        status: "WAITING" as const,
      })),
      skipDuplicates: true,
    });
  }

  return { queued: toQueue.length, eligible: eligible.length };
}

export async function ensureTestDummiesWaitingForPhase(phaseId: string) {
  return prisma.$transaction((tx) => ensureTestDummiesWaitingForPhaseTx(tx, phaseId));
}

export async function getTestDummyPhaseStatuses(tournamentId: string) {
  const phase = await prisma.tournamentPhase.findFirst({
    where: { tournamentId, status: "ACTIVE" },
    orderBy: { sortOrder: "asc" },
  });
  if (!phase) return [];

  const dummies = await prisma.tournamentParticipant.findMany({
    where: { tournamentId, isDummy: true, isActive: true },
    orderBy: { joinedAt: "asc" },
  });
  const counts = await confirmedCountsByUser(prisma, phase.id, dummies.map((dummy) => dummy.userId));
  const openMatchUserIds = await hasOpenMatchByUser(prisma, dummies.map((dummy) => dummy.userId));
  const waitingUserIds = await existingWaitingByUser(prisma, phase.id, dummies.map((dummy) => dummy.userId));

  return dummies.map((dummy) => {
    const completedMatches = counts.get(dummy.userId) ?? 0;
    const status =
      completedMatches >= phase.requiredMatchesPerPlayer
        ? "完了"
        : openMatchUserIds.has(dummy.userId)
          ? "試合中"
          : waitingUserIds.has(dummy.userId)
            ? "待機中"
            : "未待機";

    return {
      id: dummy.id,
      name: dummy.dummyName ?? dummy.participantName,
      status,
      completedMatches,
      requiredMatches: phase.requiredMatchesPerPlayer,
    };
  });
}

export type TestDummyPhaseStatus = Awaited<ReturnType<typeof getTestDummyPhaseStatuses>>[number];
