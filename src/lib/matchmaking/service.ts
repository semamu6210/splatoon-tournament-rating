import { Prisma, QueueStatus, TournamentPhaseStatus, TournamentStatus } from "@prisma/client";
import { randomInt } from "node:crypto";

import { ApiError } from "@/lib/http";
import { selectEightPlayers } from "@/lib/matchmaking/selection";
import { splitIntoBalancedTeams } from "@/lib/matchmaking/team";
import type { MatchmakingPlayer, WaitingPlayer } from "@/lib/matchmaking/types";
import { prisma } from "@/lib/prisma";
import { validateCompleteRatingConfig } from "@/lib/rating-config";
import { requireUsableTournamentStage } from "@/lib/stage-service";

type Tx = Prisma.TransactionClient;
const ACTIVE_MATCH_STATUSES = ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING"] as const;
const ROOM_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

async function ensurePhaseForQueue(phaseId: string) {
  const phase = await prisma.tournamentPhase.findUnique({
    where: { id: phaseId },
    include: { tournament: true },
  });

  if (!phase) {
    throw new ApiError(404, "Phase not found.");
  }

  if (phase.tournament.status !== TournamentStatus.ACTIVE) {
    throw new ApiError(400, "Tournament is not ACTIVE.");
  }

  if (phase.status !== TournamentPhaseStatus.ACTIVE) {
    throw new ApiError(400, "Phase is not ACTIVE.");
  }

  return phase;
}

async function countCompletedMatchesForPhase(userId: string, phaseId: string) {
  return prisma.matchPlayer.count({
    where: {
      userId,
      match: {
        phaseId,
        status: "CONFIRMED",
      },
    },
  });
}

async function hasOpenMatch(userId: string) {
  const count = await prisma.matchPlayer.count({
    where: {
      userId,
      match: {
        status: {
          in: ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING"],
        },
      },
    },
  });

  return count > 0;
}

export async function joinQueue(userId: string, phaseId: string) {
  const phase = await ensurePhaseForQueue(phaseId);
  const participant = await prisma.tournamentParticipant.findUnique({
    where: {
      tournamentId_userId: {
        tournamentId: phase.tournamentId,
        userId,
      },
    },
  });

  if (!participant || !participant.isActive) {
    throw new ApiError(403, "Active tournament participation is required.");
  }

  if (!participant.rating || !participant.ratingInitializedAt) {
    throw new ApiError(400, "Participant rating is not initialized.");
  }

  const phaseParticipant = await prisma.tournamentPhaseParticipant.findUnique({
    where: {
      phaseId_tournamentParticipantId: {
        phaseId,
        tournamentParticipantId: participant.id,
      },
    },
  });

  if (phase.phaseType === "MAIN_EVENT" && !phaseParticipant?.isEligible) {
    throw new ApiError(403, "Main event participation requires confirmed advancement.");
  }

  const completed = await countCompletedMatchesForPhase(userId, phaseId);
  if (completed >= phase.requiredMatchesPerPlayer) {
    throw new ApiError(400, "Required match count has already been reached.");
  }

  if (await hasOpenMatch(userId)) {
    throw new ApiError(400, "User is already in an unfinished match.");
  }

  const existingWaiting = await prisma.queueEntry.findFirst({
    where: { phaseId, userId, status: QueueStatus.WAITING },
  });

  if (existingWaiting) {
    throw new ApiError(409, "Already waiting in this phase.");
  }

  return prisma.queueEntry.create({
    data: {
      tournamentId: phase.tournamentId,
      phaseId,
      userId,
      status: QueueStatus.WAITING,
    },
  });
}

export async function joinQueueAndRunMatchmaking(userId: string, phaseId: string) {
  const queueEntry = await joinQueue(userId, phaseId);
  const matchmaking = await runMatchmaking(phaseId).catch(() => ({
    matched: false as const,
    reason: "AUTO_MATCHING_SKIPPED" as const,
  }));
  return { queueEntry, matchmaking };
}

export async function leaveQueue(userId: string, phaseId: string) {
  const entry = await prisma.queueEntry.findFirst({
    where: { phaseId, userId, status: QueueStatus.WAITING },
    orderBy: { joinedAt: "desc" },
  });

  if (!entry) {
    throw new ApiError(404, "WAITING queue entry not found.");
  }

  return prisma.queueEntry.update({
    where: { id: entry.id },
    data: { status: QueueStatus.CANCELLED },
  });
}

export async function getQueueStatus(userId: string, phaseId: string) {
  const entry = await prisma.queueEntry.findFirst({
    where: {
      phaseId,
      userId,
      status: { in: [QueueStatus.WAITING, QueueStatus.MATCHED] },
    },
    orderBy: { joinedAt: "desc" },
  });

  if (!entry) {
    return { status: "NOT_QUEUED" as const };
  }

  if (entry.status === QueueStatus.WAITING) {
    return {
      status: "WAITING" as const,
      joinedAt: entry.joinedAt.toISOString(),
      waitingSeconds: Math.floor((Date.now() - entry.joinedAt.getTime()) / 1000),
    };
  }

  const fallbackMatch = entry.matchId
    ? null
    : await prisma.match.findFirst({
        where: {
          phaseId,
          players: { some: { userId } },
          status: { in: [...ACTIVE_MATCH_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
  const matchId = entry.matchId ?? fallbackMatch?.id;
  if (!matchId) throw new ApiError(409, "マッチング済みですが試合IDを確認できません。");

  return {
    status: "MATCHED" as const,
    matchId,
  };
}

async function recentRelations(tx: Tx, userIds: string[], phaseId: string) {
  const relations = new Map<string, { opponents: Set<string>; teammates: Set<string> }>();

  for (const userId of userIds) {
    relations.set(userId, { opponents: new Set(), teammates: new Set() });
  }

  const matchPlayers = await tx.matchPlayer.findMany({
    where: {
      userId: { in: userIds },
      match: {
        phaseId,
        status: { not: "CANCELLED" },
      },
    },
    include: {
      match: {
        include: {
          players: true,
        },
      },
    },
    orderBy: {
      match: {
        createdAt: "desc",
      },
    },
    take: userIds.length * 3,
  });

  for (const player of matchPlayers) {
    const relation = relations.get(player.userId);
    if (!relation) continue;

    for (const other of player.match.players) {
      if (other.userId === player.userId) continue;
      if (other.team === player.team) {
        relation.teammates.add(other.userId);
      } else {
        relation.opponents.add(other.userId);
      }
    }
  }

  return relations;
}

async function getWaitingPlayers(tx: Tx, phaseId: string, losingStreakPenalty: Prisma.Decimal) {
  const entries = await tx.queueEntry.findMany({
    where: { phaseId, status: QueueStatus.WAITING },
    include: {
      user: {
        include: {
          participants: true,
        },
      },
    },
    orderBy: { joinedAt: "asc" },
  });

  const userIds = entries.map((entry) => entry.userId);
  const relations = await recentRelations(tx, userIds, phaseId);
  const players: WaitingPlayer[] = [];

  for (const entry of entries) {
    const participant = entry.user.participants.find(
      (item) => item.tournamentId === entry.tournamentId && item.isActive,
    );

    if (!participant?.rating) {
      continue;
    }

    const relation = relations.get(entry.userId);

    players.push({
      queueEntryId: entry.id,
      userId: entry.userId,
      joinedAt: entry.joinedAt,
      rating: participant.rating,
      losingStreak: participant.losingStreak,
      losingStreakPenalty,
      areaXp: participant.areaXp,
      recentOpponentIds: relation?.opponents ?? new Set(),
      recentTeammateIds: relation?.teammates ?? new Set(),
    });
  }

  return players;
}

async function nextMatchNumber(tx: Tx, phaseId: string) {
  const latest = await tx.match.findFirst({
    where: { phaseId, matchNumber: { not: null } },
    orderBy: { matchNumber: "desc" },
    select: { matchNumber: true },
  });
  return (latest?.matchNumber ?? 0) + 1;
}

function generatePrivateRoomCode() {
  let code = "";
  for (let index = 0; index < 3; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

async function generateAvailablePrivateRoomCode(tx: Tx) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const code = generatePrivateRoomCode();
    const existing = await tx.match.findFirst({
      where: { privateRoomCode: code, status: { in: [...ACTIVE_MATCH_STATUSES] } },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new ApiError(500, "プライベートマッチ用コードを生成できませんでした。");
}

async function selectRoomHostUserId(tx: Tx, players: MatchmakingPlayer[]) {
  const userIds = players.map((player) => player.userId);
  const hostCounts = await tx.match.groupBy({
    by: ["roomHostUserId"],
    where: { roomHostUserId: { in: userIds } },
    _count: { roomHostUserId: true },
  });
  const countByUserId = new Map(hostCounts.map((row) => [row.roomHostUserId, row._count.roomHostUserId]));
  const minCount = Math.min(...userIds.map((userId) => countByUserId.get(userId) ?? 0));
  const candidates = userIds.filter((userId) => (countByUserId.get(userId) ?? 0) === minCount);
  return candidates[randomInt(candidates.length)];
}

async function selectStageForMatch(
  tx: Tx,
  phase: { tournamentId: string; defaultStageId: string | null; stageSelectionMode: "ADMIN" | "RANDOM" },
) {
  if (phase.stageSelectionMode === "ADMIN" && phase.defaultStageId) {
    return requireUsableTournamentStage(tx, phase.tournamentId, phase.defaultStageId);
  }
  const stages = await tx.tournamentStage.findMany({
    where: { tournamentId: phase.tournamentId, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  if (stages.length === 0) return null;
  return stages[Math.floor(Math.random() * stages.length)];
}

function validateEightPlayers(players: MatchmakingPlayer[]) {
  if (players.length !== 8) {
    throw new ApiError(500, "Matchmaking must select exactly 8 players.");
  }

  const userIds = new Set(players.map((player) => player.userId));
  if (userIds.size !== 8) {
    throw new ApiError(500, "Selected players contain duplicate users.");
  }
}

export async function runMatchmaking(phaseId: string) {
  return prisma.$transaction(
    async (tx) => {
      const phase = await tx.tournamentPhase.findUnique({
        where: { id: phaseId },
        include: { tournament: true },
      });

      if (!phase) {
        throw new ApiError(404, "Phase not found.");
      }

      if (phase.tournament.status !== TournamentStatus.ACTIVE || phase.status !== TournamentPhaseStatus.ACTIVE) {
        throw new ApiError(400, "Tournament and phase must be ACTIVE.");
      }

      const activeConfig = await tx.tournamentRatingConfig.findFirst({
        where: { tournamentId: phase.tournamentId, isActive: true },
        include: { xpMultiplierTiers: true },
      });

      if (!activeConfig) {
        throw new ApiError(400, "Active rating config not found.");
      }

      validateCompleteRatingConfig(activeConfig);

      const waitingCount = await tx.queueEntry.count({
        where: { phaseId, status: QueueStatus.WAITING },
      });

      if (waitingCount < 8) {
        return { matched: false as const, reason: "NOT_ENOUGH_PLAYERS" as const };
      }

      const waitingPlayers = await getWaitingPlayers(tx, phaseId, activeConfig.losingStreakPenalty);
      const selected = selectEightPlayers(waitingPlayers);

      if (!selected) {
        return { matched: false as const, reason: "NOT_ENOUGH_PLAYERS" as const };
      }

      validateEightPlayers(selected);

      const queueEntryIds = selected.map((player) => player.queueEntryId);

      const claimed = await tx.queueEntry.updateMany({
        where: {
          id: { in: queueEntryIds },
          status: QueueStatus.WAITING,
        },
        data: {
          status: QueueStatus.MATCHED,
          matchedAt: new Date(),
        },
      });

      if (claimed.count !== 8) {
        throw new ApiError(409, "Selected queue entries were changed by another matchmaking run.");
      }

      const teams = splitIntoBalancedTeams(selected);

      if (teams.teamA.length !== 4 || teams.teamB.length !== 4) {
        throw new ApiError(500, "Team assignment must be 4v4.");
      }

      const selectedStage = await selectStageForMatch(tx, phase);
      const allPlayers = [...teams.teamA, ...teams.teamB];
      const privateRoomCode = await generateAvailablePrivateRoomCode(tx);
      const roomHostUserId = await selectRoomHostUserId(tx, allPlayers);
      const match = await tx.match.create({
        data: {
          tournamentId: phase.tournamentId,
          phaseId,
          ratingConfigId: activeConfig.id,
          ratingConfigVersion: activeConfig.version,
          matchNumber: await nextMatchNumber(tx, phaseId),
          rule: phase.rule,
          stageId: selectedStage?.id,
          stageName: selectedStage?.name,
          privateRoomCode,
          roomHostUserId,
          status: "CREATED",
        },
      });

      await tx.matchPlayer.createMany({
        data: [
          ...teams.teamA.map((player) => ({
            matchId: match.id,
            userId: player.userId,
            team: "A" as const,
            ratingBefore: player.rating,
            matchingRatingAtMatch: player.matchingRating,
            areaXpAtMatch: player.areaXp,
            losingStreakAtMatch: player.losingStreak,
            ratingAfter: null,
          })),
          ...teams.teamB.map((player) => ({
            matchId: match.id,
            userId: player.userId,
            team: "B" as const,
            ratingBefore: player.rating,
            matchingRatingAtMatch: player.matchingRating,
            areaXpAtMatch: player.areaXp,
            losingStreakAtMatch: player.losingStreak,
            ratingAfter: null,
          })),
        ],
      });

      await tx.queueEntry.updateMany({
        where: { id: { in: queueEntryIds }, status: QueueStatus.MATCHED },
        data: { matchId: match.id },
      });

      return {
        matched: true as const,
        matchId: match.id,
        teamA: teams.teamA.map((player) => player.userId),
        teamB: teams.teamB.map((player) => player.userId),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
