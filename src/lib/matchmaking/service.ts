import { Prisma, QueueStatus, TournamentPhaseStatus, TournamentStatus, type TournamentRatingConfig, type TournamentXpMultiplierTier } from "@prisma/client";
import { randomInt } from "node:crypto";

import { ApiError } from "@/lib/http";
import { selectEightPlayers } from "@/lib/matchmaking/selection";
import { splitIntoBalancedTeams } from "@/lib/matchmaking/team";
import type { MatchmakingPlayer, WaitingPlayer } from "@/lib/matchmaking/types";
import { prisma } from "@/lib/prisma";
import { validateCompleteRatingConfig } from "@/lib/rating-config";
import { touchQueueStatusEventTx, touchQueueStatusEventsTx } from "@/lib/realtime-status-events";
import { requireUsableTournamentStage } from "@/lib/stage-service";
import { ensureTestDummiesWaitingForPhaseTx } from "@/lib/test-dummy-queue";

type Tx = Prisma.TransactionClient;
type DbClient = Tx | typeof prisma;
const ACTIVE_MATCH_STATUSES = ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING"] as const;
const ROOM_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type MatchmakingExclusionSummary = {
  waiting: number;
  excluded: {
    inactiveParticipant: number;
    missingAreaXp: number;
    missingRating: number;
    missingRatingInitialized: number;
    notPhaseEligible: number;
    requiredMatchesReached: number;
    unfinishedMatch: number;
    wrongBlock: number;
    wrongRound: number;
  };
  eligible: number;
};

function emptyExclusionSummary(waiting: number): MatchmakingExclusionSummary {
  return {
    waiting,
    excluded: {
      inactiveParticipant: 0,
      missingAreaXp: 0,
      missingRating: 0,
      missingRatingInitialized: 0,
      notPhaseEligible: 0,
      requiredMatchesReached: 0,
      unfinishedMatch: 0,
      wrongBlock: 0,
      wrongRound: 0,
    },
    eligible: 0,
  };
}

function logNoEligiblePlayers(context: {
  phaseId: string;
  roundNumber?: number;
  mode: "queue" | "synchronized-round";
  summary: MatchmakingExclusionSummary;
  blockSummaries?: Array<{ blockId: string; eligible: number; waiting: number; excluded: MatchmakingExclusionSummary["excluded"] }>;
}) {
  console.warn("MATCHMAKING_NO_ELIGIBLE_PLAYERS", context);
}

function addExcludedCounts(target: MatchmakingExclusionSummary["excluded"], source: MatchmakingExclusionSummary["excluded"]) {
  target.inactiveParticipant += source.inactiveParticipant;
  target.missingAreaXp += source.missingAreaXp;
  target.missingRating += source.missingRating;
  target.missingRatingInitialized += source.missingRatingInitialized;
  target.notPhaseEligible += source.notPhaseEligible;
  target.requiredMatchesReached += source.requiredMatchesReached;
  target.unfinishedMatch += source.unfinishedMatch;
  target.wrongBlock += source.wrongBlock;
  target.wrongRound += source.wrongRound;
}

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

  return prisma.$transaction(async (tx) => {
    const entry = await tx.queueEntry.create({
      data: {
        tournamentId: phase.tournamentId,
        phaseId,
        userId,
        status: QueueStatus.WAITING,
      },
    });
    await touchQueueStatusEventTx(tx, { phaseId, queueEntryId: entry.id, status: QueueStatus.WAITING });
    return entry;
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

  return prisma.$transaction(async (tx) => {
    const updated = await tx.queueEntry.update({
      where: { id: entry.id },
      data: { status: QueueStatus.CANCELLED },
    });
    await touchQueueStatusEventTx(tx, { phaseId, queueEntryId: entry.id, status: "NOT_QUEUED" });
    return updated;
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

export async function getQueueStatusLite(userId: string, phaseId: string) {
  const entry = await prisma.queueEntry.findFirst({
    where: {
      phaseId,
      userId,
      status: { in: [QueueStatus.WAITING, QueueStatus.MATCHED] },
    },
    orderBy: { joinedAt: "desc" },
    select: { status: true, matchId: true },
  });

  if (entry) {
    return {
      status: entry.status,
      matchId: entry.matchId,
    };
  }

  const fallbackMatch = await prisma.match.findFirst({
    where: {
      phaseId,
      players: { some: { userId } },
      status: { in: [...ACTIVE_MATCH_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  return fallbackMatch
    ? { status: QueueStatus.MATCHED, matchId: fallbackMatch.id }
    : { status: "NOT_QUEUED" as const, matchId: null };
}

async function recentRelations(tx: DbClient, userIds: string[], phaseId: string) {
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

async function getWaitingPlayers(tx: DbClient, phase: { id: string; tournamentId: string; requiredMatchesPerPlayer: number }) {
  const entries = await tx.queueEntry.findMany({
    where: { phaseId: phase.id, status: QueueStatus.WAITING },
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
  const relations = await recentRelations(tx, userIds, phase.id);
  const confirmedCounts = await tx.matchPlayer.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, match: { phaseId: phase.id, status: "CONFIRMED" } },
    _count: { userId: true },
  });
  const confirmedCountByUserId = new Map(confirmedCounts.map((count) => [count.userId, count._count.userId]));
  const openPlayers = await tx.matchPlayer.findMany({
    where: {
      userId: { in: userIds },
      match: { phaseId: phase.id, status: { in: [...ACTIVE_MATCH_STATUSES] } },
    },
    select: { userId: true },
  });
  const openUserIds = new Set(openPlayers.map((player) => player.userId));
  const phaseRelations = await tx.tournamentPhaseParticipant.findMany({
    where: { phaseId: phase.id, tournamentParticipant: { userId: { in: userIds } } },
    select: { isEligible: true, tournamentParticipant: { select: { userId: true } } },
  });
  const hasPhaseRelations = phaseRelations.length > 0;
  const phaseEligibleByUserId = new Map(phaseRelations.map((relation) => [relation.tournamentParticipant.userId, relation.isEligible]));
  const players: WaitingPlayer[] = [];
  const summary = emptyExclusionSummary(entries.length);

  for (const entry of entries) {
    const participant = entry.user.participants.find((item) => item.tournamentId === phase.tournamentId);

    if (!participant?.isActive) {
      summary.excluded.inactiveParticipant += 1;
      continue;
    }
    if (!participant.rating) {
      summary.excluded.missingRating += 1;
      continue;
    }
    if (!participant.ratingInitializedAt) {
      summary.excluded.missingRatingInitialized += 1;
      continue;
    }
    if (!Number.isFinite(participant.areaXp)) {
      summary.excluded.missingAreaXp += 1;
      continue;
    }
    if (hasPhaseRelations && phaseEligibleByUserId.get(entry.userId) !== true) {
      summary.excluded.notPhaseEligible += 1;
      continue;
    }

    const relation = relations.get(entry.userId);
    const completedMatchesInPhase = confirmedCountByUserId.get(entry.userId) ?? 0;
    if (completedMatchesInPhase >= phase.requiredMatchesPerPlayer) {
      summary.excluded.requiredMatchesReached += 1;
      continue;
    }
    if (openUserIds.has(entry.userId)) {
      summary.excluded.unfinishedMatch += 1;
      continue;
    }

    players.push({
      queueEntryId: entry.id,
      userId: entry.userId,
      joinedAt: entry.joinedAt,
      rating: participant.rating,
      losingStreak: participant.losingStreak,
      areaXp: participant.areaXp,
      isDummy: participant.isDummy,
      completedMatchesInPhase,
      recentOpponentIds: relation?.opponents ?? new Set(),
      recentTeammateIds: relation?.teammates ?? new Set(),
    });
  }

  summary.eligible = players.length;
  return { players, summary };
}

async function getConfirmedCountsByUserId(tx: Tx, phaseId: string, userIds: string[]) {
  const confirmedCounts = await tx.matchPlayer.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds }, match: { phaseId, status: "CONFIRMED" } },
    _count: { userId: true },
  });
  return new Map(confirmedCounts.map((count) => [count.userId, count._count.userId]));
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

function selectRoomHostUserId(players: MatchmakingPlayer[]) {
  const hostCandidates = players.some((player) => !player.isDummy) ? players.filter((player) => !player.isDummy) : players;
  return hostCandidates[randomInt(hostCandidates.length)].userId;
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

async function createMatchForSelectedPlayers(params: {
  tx: Tx;
  phase: {
    id: string;
    tournamentId: string;
    rule: "AREA" | "YAGURA" | "HOKO" | "ASARI";
    defaultStageId: string | null;
    stageSelectionMode: "ADMIN" | "RANDOM";
  };
  activeConfig: TournamentRatingConfig & { xpMultiplierTiers: TournamentXpMultiplierTier[] };
  selected: MatchmakingPlayer[];
  roundNumber?: number;
  queueEntryIds?: string[];
}) {
  validateEightPlayers(params.selected);
  const teams = splitIntoBalancedTeams(params.selected);

  if (teams.teamA.length !== 4 || teams.teamB.length !== 4) {
    throw new ApiError(500, "Team assignment must be 4v4.");
  }

  const selectedStage = await selectStageForMatch(params.tx, params.phase);
  const allPlayers = [...teams.teamA, ...teams.teamB];
  const privateRoomCode = await generateAvailablePrivateRoomCode(params.tx);
  const roomHostUserId = selectRoomHostUserId(allPlayers);
  const match = await params.tx.match.create({
    data: {
      tournamentId: params.phase.tournamentId,
      phaseId: params.phase.id,
      ratingConfigId: params.activeConfig.id,
      ratingConfigVersion: params.activeConfig.version,
      matchNumber: await nextMatchNumber(params.tx, params.phase.id),
      roundNumber: params.roundNumber,
      rule: params.phase.rule,
      stageId: selectedStage?.id,
      stageName: selectedStage?.name,
      privateRoomCode,
      roomHostUserId,
      status: "CREATED",
    },
  });

  await params.tx.matchPlayer.createMany({
    data: [
      ...teams.teamA.map((player) => ({
        matchId: match.id,
        userId: player.userId,
        team: "A" as const,
        ratingBefore: player.rating,
        matchingRatingAtMatch: player.matchingPower,
        areaXpAtMatch: player.areaXp,
        losingStreakAtMatch: player.losingStreak,
        ratingAfter: null,
      })),
      ...teams.teamB.map((player) => ({
        matchId: match.id,
        userId: player.userId,
        team: "B" as const,
        ratingBefore: player.rating,
        matchingRatingAtMatch: player.matchingPower,
        areaXpAtMatch: player.areaXp,
        losingStreakAtMatch: player.losingStreak,
        ratingAfter: null,
      })),
    ],
  });

  if (params.queueEntryIds && params.queueEntryIds.length > 0) {
    await params.tx.queueEntry.updateMany({
      where: { id: { in: params.queueEntryIds }, status: QueueStatus.MATCHED },
      data: { matchId: match.id },
    });
    await touchQueueStatusEventsTx(
      params.tx,
      allPlayers.map((player) => ({
        phaseId: params.phase.id,
        queueEntryId: player.queueEntryId,
        status: QueueStatus.MATCHED,
        matchId: match.id,
      })),
    );
  }

  return {
    match,
    teamA: teams.teamA.map((player) => player.userId),
    teamB: teams.teamB.map((player) => player.userId),
  };
}

async function runSynchronizedRoundMatchmaking(tx: Tx, phase: Awaited<ReturnType<Tx["tournamentPhase"]["findUnique"]>> & { tournament: { status: TournamentStatus } }) {
  if (!phase) throw new ApiError(404, "Phase not found.");
  let blocks = await tx.tournamentBlock.findMany({
    where: { phaseId: phase.id },
    include: { participants: { include: { tournamentParticipant: true } } },
    orderBy: { sortOrder: "asc" },
  });
  if (blocks.length === 0) return null;
  const assignedParticipantIds = new Set(blocks.flatMap((block) => block.participants.map((item) => item.tournamentParticipantId)));
  const phaseTargets = await tx.tournamentPhaseParticipant.findMany({
    where: { phaseId: phase.id, isEligible: true, tournamentParticipant: { isActive: true, rating: { not: null } } },
    include: { tournamentParticipant: true },
    orderBy: { createdAt: "asc" },
  });
  const assignmentTargets =
    phaseTargets.length > 0
      ? phaseTargets.map((target) => target.tournamentParticipant)
      : await tx.tournamentParticipant.findMany({
          where: { tournamentId: phase.tournamentId, isActive: true, rating: { not: null } },
          orderBy: { joinedAt: "asc" },
        });
  const missingAssignments = assignmentTargets.filter((participant) => !assignedParticipantIds.has(participant.id));
  if (missingAssignments.length > 0) {
    const blockLoads = blocks.map((block) => ({ blockId: block.id, count: block.participants.length }));
    const assignments = missingAssignments.map((participant) => {
      blockLoads.sort((left, right) => left.count - right.count);
      const targetBlock = blockLoads[0];
      targetBlock.count += 1;
      return { phaseId: phase.id, blockId: targetBlock.blockId, tournamentParticipantId: participant.id };
    });
    await tx.tournamentBlockParticipant.createMany({ data: assignments, skipDuplicates: true });
    blocks = await tx.tournamentBlock.findMany({
      where: { phaseId: phase.id },
      include: { participants: { include: { tournamentParticipant: true } } },
      orderBy: { sortOrder: "asc" },
    });
  }

  const existingOpenRound = await tx.tournamentPhaseRound.findFirst({
    where: { phaseId: phase.id, status: { in: ["PENDING", "MATCHING", "ACTIVE"] } },
    orderBy: { roundNumber: "asc" },
  });
  const latestRound = existingOpenRound
    ? null
    : await tx.tournamentPhaseRound.findFirst({
        where: { phaseId: phase.id },
        orderBy: { roundNumber: "desc" },
        select: { roundNumber: true },
      });
  const roundNumber = existingOpenRound?.roundNumber ?? (latestRound?.roundNumber ?? 0) + 1;
  if (!existingOpenRound) {
    if (roundNumber > phase.requiredMatchesPerPlayer) {
      return { matched: false as const, reason: "REQUIRED_MATCHES_REACHED" as const, roundNumber };
    }
    if (await allPhaseTargetsReachedRequiredMatches(tx, phase)) {
      return { matched: false as const, reason: "REQUIRED_MATCHES_REACHED" as const, roundNumber };
    }
  }
  const round = existingOpenRound ?? await tx.tournamentPhaseRound.create({
    data: { phaseId: phase.id, roundNumber, status: "PENDING" },
  });
  const activeMatchesInRound =
    round.status === "ACTIVE"
      ? await tx.match.count({
          where: {
            phaseId: phase.id,
            roundNumber,
            status: { in: [...ACTIVE_MATCH_STATUSES] },
          },
        })
      : 0;
  const claimableStatuses =
    round.status === "ACTIVE" && activeMatchesInRound === 0
      ? (["ACTIVE"] as const)
      : (["PENDING", "COMPLETED"] as const);

  const claimed = await tx.tournamentPhaseRound.updateMany({
    where: { id: round.id, status: { in: [...claimableStatuses] } },
    data: { status: "MATCHING", startedAt: new Date() },
  });
  if (claimed.count !== 1) {
    return { matched: false as const, reason: "ROUND_ALREADY_MATCHING" as const, roundNumber };
  }

  const activeConfig = await tx.tournamentRatingConfig.findFirst({
    where: { tournamentId: phase.tournamentId, isActive: true },
    include: { xpMultiplierTiers: true },
  });
  if (!activeConfig) throw new ApiError(400, "Active rating config not found.");
  validateCompleteRatingConfig(activeConfig);

  const createdMatchIds: string[] = [];
  const totalSummary = emptyExclusionSummary(blocks.reduce((sum, block) => sum + block.participants.length, 0));
  const blockSummaries: Array<{ blockId: string; eligible: number; waiting: number; excluded: MatchmakingExclusionSummary["excluded"] }> = [];
  for (const block of blocks) {
    await tx.tournamentPhaseRoundBlock.upsert({
      where: { phaseId_blockId_roundNumber: { phaseId: phase.id, blockId: block.id, roundNumber } },
      update: { roundId: round.id, status: "MATCHING" },
      create: { phaseId: phase.id, blockId: block.id, roundId: round.id, roundNumber, status: "MATCHING" },
    });

    const blockParticipants = block.participants.map((item) => item.tournamentParticipant);
    const blockSummary = emptyExclusionSummary(blockParticipants.length);
    const userIds = blockParticipants.map((participant) => participant.userId);
    const phaseRelations = await tx.tournamentPhaseParticipant.findMany({
      where: { phaseId: phase.id, tournamentParticipantId: { in: blockParticipants.map((participant) => participant.id) } },
      select: { tournamentParticipantId: true, isEligible: true },
    });
    const hasPhaseRelations = phaseRelations.length > 0;
    const phaseEligibleByParticipantId = new Map(phaseRelations.map((relation) => [relation.tournamentParticipantId, relation.isEligible]));
    const completedByUserId = await getConfirmedCountsByUserId(tx, phase.id, userIds);
    const openPlayers = await tx.matchPlayer.findMany({
      where: {
        userId: { in: userIds },
        match: { status: { in: [...ACTIVE_MATCH_STATUSES] } },
      },
      select: { userId: true },
    });
    const openUserIds = new Set(openPlayers.map((player) => player.userId));
    const candidates = [];
    for (const participant of blockParticipants) {
      if (!participant.isActive) {
        blockSummary.excluded.inactiveParticipant += 1;
        continue;
      }
      if (!participant.rating) {
        blockSummary.excluded.missingRating += 1;
        continue;
      }
      if (!participant.ratingInitializedAt) {
        blockSummary.excluded.missingRatingInitialized += 1;
        continue;
      }
      if (!Number.isFinite(participant.areaXp)) {
        blockSummary.excluded.missingAreaXp += 1;
        continue;
      }
      if (hasPhaseRelations && phaseEligibleByParticipantId.get(participant.id) !== true) {
        blockSummary.excluded.notPhaseEligible += 1;
        continue;
      }
      const completedMatchesInPhase = completedByUserId.get(participant.userId) ?? 0;
      if (completedMatchesInPhase >= phase.requiredMatchesPerPlayer) {
        blockSummary.excluded.requiredMatchesReached += 1;
        continue;
      }
      if (openUserIds.has(participant.userId)) {
        blockSummary.excluded.unfinishedMatch += 1;
        continue;
      }
      candidates.push(participant);
    }
    candidates.sort((left, right) => {
      const leftCount = completedByUserId.get(left.userId) ?? 0;
      const rightCount = completedByUserId.get(right.userId) ?? 0;
      if (leftCount !== rightCount) return leftCount - rightCount;
      return new Prisma.Decimal(left.rating ?? 0).comparedTo(right.rating ?? 0);
    });
    blockSummary.eligible = candidates.length;
    totalSummary.eligible += blockSummary.eligible;
    addExcludedCounts(totalSummary.excluded, blockSummary.excluded);
    blockSummaries.push({ blockId: block.id, waiting: blockSummary.waiting, eligible: blockSummary.eligible, excluded: blockSummary.excluded });

    let madeBlockMatch = false;
    for (let index = 0; index + 8 <= candidates.length; index += 8) {
      const selected = candidates.slice(index, index + 8).map((participant): MatchmakingPlayer => ({
        queueEntryId: `round-${round.id}-${participant.userId}`,
        userId: participant.userId,
        joinedAt: new Date(),
        rating: participant.rating!,
        losingStreak: participant.losingStreak,
        areaXp: participant.areaXp,
        isDummy: participant.isDummy,
        completedMatchesInPhase: completedByUserId.get(participant.userId) ?? 0,
        recentOpponentIds: new Set(),
        recentTeammateIds: new Set(),
        matchingPower: new Prisma.Decimal(participant.areaXp - participant.losingStreak * 50),
      }));
      const created = await createMatchForSelectedPlayers({ tx, phase, activeConfig, selected, roundNumber });
      createdMatchIds.push(created.match.id);
      madeBlockMatch = true;
    }

    await tx.tournamentPhaseRoundBlock.update({
      where: { phaseId_blockId_roundNumber: { phaseId: phase.id, blockId: block.id, roundNumber } },
      data: { status: madeBlockMatch ? "ACTIVE" : "PENDING" },
    });
  }

  await tx.tournamentPhaseRound.update({
    where: { id: round.id },
    data: { status: createdMatchIds.length > 0 ? "ACTIVE" : "PENDING", completedAt: null },
  });

  if (createdMatchIds.length === 0) {
    logNoEligiblePlayers({
      phaseId: phase.id,
      roundNumber,
      mode: "synchronized-round",
      summary: totalSummary,
      blockSummaries,
    });
  }

  return {
    matched: createdMatchIds.length > 0,
    reason: createdMatchIds.length > 0 ? undefined : "NO_ELIGIBLE_PLAYERS",
    roundNumber,
    matchIds: createdMatchIds,
    matchId: createdMatchIds[0],
  } as
    | { matched: true; roundNumber: number; matchIds: string[]; matchId: string; reason?: undefined }
    | { matched: false; roundNumber: number; matchIds: string[]; matchId?: undefined; reason: "NO_ELIGIBLE_PLAYERS" }
    | { matched: false; roundNumber: number; matchId?: undefined; reason: "REQUIRED_MATCHES_REACHED" };
}

export async function runMatchmaking(phaseId: string) {
  const preflightPhase = await prisma.tournamentPhase.findUnique({
    where: { id: phaseId },
    include: { tournament: true },
  });

  if (!preflightPhase) {
    throw new ApiError(404, "Phase not found.");
  }

  if (preflightPhase.tournament.status !== TournamentStatus.ACTIVE || preflightPhase.status !== TournamentPhaseStatus.ACTIVE) {
    throw new ApiError(400, "Tournament and phase must be ACTIVE.");
  }

  await prisma.$transaction((tx) => ensureTestDummiesWaitingForPhaseTx(tx, phaseId), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 15000,
  });

  const blockCount = await prisma.tournamentBlock.count({ where: { phaseId } });
  if (blockCount === 0) {
    const activeConfig = await prisma.tournamentRatingConfig.findFirst({
      where: { tournamentId: preflightPhase.tournamentId, isActive: true },
      include: { xpMultiplierTiers: true },
    });

    if (!activeConfig) {
      throw new ApiError(400, "Active rating config not found.");
    }

    validateCompleteRatingConfig(activeConfig);

    const waitingCount = await prisma.queueEntry.count({
      where: { phaseId, status: QueueStatus.WAITING },
    });

    if (waitingCount < 8) {
      return { matched: false as const, reason: "NOT_ENOUGH_PLAYERS" as const };
    }

    const waitingPlayers = await getWaitingPlayers(prisma, preflightPhase);
    const selected = selectEightPlayers(waitingPlayers.players);

    if (!selected) {
      if (waitingPlayers.summary.waiting >= 8 && waitingPlayers.summary.eligible === 0) {
        logNoEligiblePlayers({
          phaseId,
          mode: "queue",
          summary: waitingPlayers.summary,
        });
      }
      return { matched: false as const, reason: "NOT_ENOUGH_PLAYERS" as const };
    }

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

        const created = await createMatchForSelectedPlayers({ tx, phase, activeConfig, selected, queueEntryIds });

        return {
          matched: true as const,
          matchId: created.match.id,
          teamA: created.teamA,
          teamB: created.teamB,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 },
    );
  }

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

      const synchronized = await runSynchronizedRoundMatchmaking(tx, phase);
      if (synchronized) return synchronized;

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

      const waitingPlayers = await getWaitingPlayers(tx, phase);
      const selected = selectEightPlayers(waitingPlayers.players);

      if (!selected) {
        if (waitingPlayers.summary.waiting >= 8 && waitingPlayers.summary.eligible === 0) {
          logNoEligiblePlayers({
            phaseId,
            mode: "queue",
            summary: waitingPlayers.summary,
          });
        }
        return { matched: false as const, reason: "NOT_ENOUGH_PLAYERS" as const };
      }

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

      const created = await createMatchForSelectedPlayers({ tx, phase, activeConfig, selected, queueEntryIds });

      return {
        matched: true as const,
        matchId: created.match.id,
        teamA: created.teamA,
        teamB: created.teamB,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 },
  );
}

async function allPhaseTargetsReachedRequiredMatches(tx: Tx, phase: { id: string; tournamentId: string; requiredMatchesPerPlayer: number }) {
  const targets = await tx.tournamentPhaseParticipant.findMany({
    where: { phaseId: phase.id, isEligible: true },
    include: { tournamentParticipant: true },
  });
  const participants =
    targets.length > 0
      ? targets.map((target) => target.tournamentParticipant)
      : await tx.tournamentParticipant.findMany({
          where: { tournamentId: phase.tournamentId, isActive: true, rating: { not: null } },
        });
  const userIds = participants.map((participant) => participant.userId);
  if (userIds.length === 0) return true;
  const completedByUserId = await getConfirmedCountsByUserId(tx, phase.id, userIds);
  return userIds.every((userId) => (completedByUserId.get(userId) ?? 0) >= phase.requiredMatchesPerPlayer);
}

async function isBlockRoundComplete(tx: Tx, params: { blockUserIds: string[]; phaseId: string; roundNumber: number }) {
  if (params.blockUserIds.length === 0) return false;
  const matches = await tx.match.findMany({
    where: {
      phaseId: params.phaseId,
      roundNumber: params.roundNumber,
      players: { some: { userId: { in: params.blockUserIds } } },
    },
    select: { id: true, status: true, ratingAppliedAt: true },
  });

  return matches.length > 0 && matches.every((match) => match.status === "CONFIRMED" && match.ratingAppliedAt !== null);
}

export async function checkAndAdvanceRound(phaseId: string, roundNumber: number | null) {
  if (!roundNumber) return { advanced: false as const, reason: "NO_ROUND" as const };

  const result = await prisma.$transaction(
    async (tx) => {
      const phase = await tx.tournamentPhase.findUnique({ where: { id: phaseId }, include: { tournament: true } });
      if (!phase || phase.status !== TournamentPhaseStatus.ACTIVE || phase.tournament.status !== TournamentStatus.ACTIVE) {
        return { shouldStartNext: false as const, completed: false as const, reason: "PHASE_NOT_ACTIVE" as const };
      }

      const round = await tx.tournamentPhaseRound.findUnique({
        where: { phaseId_roundNumber: { phaseId, roundNumber } },
      });
      if (!round || round.status !== "ACTIVE") {
        return { shouldStartNext: false as const, completed: false as const, reason: "ROUND_NOT_ACTIVE" as const };
      }

      const blocks = await tx.tournamentBlock.findMany({
        where: { phaseId },
        include: { participants: { include: { tournamentParticipant: true } } },
        orderBy: { sortOrder: "asc" },
      });
      if (blocks.length === 0) {
        return { shouldStartNext: false as const, completed: false as const, reason: "NO_BLOCKS" as const };
      }

      let completedBlocks = 0;
      for (const block of blocks) {
        const blockUserIds = block.participants.map((item) => item.tournamentParticipant.userId);
        const blockComplete = await isBlockRoundComplete(tx, { phaseId, roundNumber, blockUserIds });
        const blockStatus = blockComplete ? "COMPLETED" : "ACTIVE";
        await tx.tournamentPhaseRoundBlock.upsert({
          where: { phaseId_blockId_roundNumber: { phaseId, blockId: block.id, roundNumber } },
          update: { status: blockStatus },
          create: { phaseId, blockId: block.id, roundId: round.id, roundNumber, status: blockStatus },
        });
        if (blockStatus === "COMPLETED") completedBlocks += 1;
      }

      if (completedBlocks !== blocks.length) {
        return { shouldStartNext: false as const, completed: false as const, completedBlocks, blockCount: blocks.length };
      }

      const claimed = await tx.tournamentPhaseRound.updateMany({
        where: { id: round.id, status: "ACTIVE" },
        data: { status: "COMPLETED", completedAt: new Date() },
      });
      if (claimed.count !== 1) {
        return { shouldStartNext: false as const, completed: false as const, reason: "ROUND_ALREADY_COMPLETED" as const };
      }

      const allDone = await allPhaseTargetsReachedRequiredMatches(tx, phase);
      if (allDone || roundNumber >= phase.requiredMatchesPerPlayer) {
        return { shouldStartNext: false as const, completed: true as const, reason: "FINAL_ROUND_COMPLETED" as const };
      }

      await tx.tournamentPhaseRound.create({
        data: { phaseId, roundNumber: roundNumber + 1, status: "PENDING" },
      });
      return { shouldStartNext: true as const, completed: true as const, nextRoundNumber: roundNumber + 1 };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  if (result.shouldStartNext) {
    const matchmaking = await runMatchmaking(phaseId).catch((error) => {
      console.error("AUTO_ROUND_MATCHMAKING_FAILED", {
        phaseId,
        roundNumber: result.nextRoundNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
    return { advanced: true as const, roundNumber: result.nextRoundNumber, matchmaking };
  }

  return { advanced: false as const, ...result };
}
