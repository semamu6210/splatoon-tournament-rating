import {
  Prisma,
  TournamentPhaseStatus,
  TournamentPhaseType,
  TournamentStatus,
  type AdvancementMode,
  type MatchRule,
  type StageSelectionMode,
} from "@prisma/client";

import { ApiError } from "@/lib/http";
import {
  assignCompetitionRanks,
  buildBlockAdvancementCandidates,
  buildOverallAdvancementCandidates,
  getPhaseRanking,
  getPhaseTargetParticipants,
} from "@/lib/ranking-service";
import { prisma } from "@/lib/prisma";
import { requireUsableTournamentStage } from "@/lib/stage-service";

type Tx = Prisma.TransactionClient;

const OPEN_MATCH_STATUSES = ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING"] as const;

export async function countConfirmedMatchesInPhase(userId: string, phaseId: string) {
  return prisma.matchPlayer.count({
    where: { userId, match: { phaseId, status: "CONFIRMED" } },
  });
}

async function withSerializable<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new ApiError(409, "Phase operation conflicted with another request.");
    }
    throw error;
  }
}

async function phaseTargetsInTx(tx: Tx, phase: { id: string; tournamentId: string; phaseType: TournamentPhaseType }) {
  const existing = await tx.tournamentPhaseParticipant.findMany({
    where: { phaseId: phase.id, isEligible: true },
    include: { tournamentParticipant: true },
  });
  if (existing.length > 0) return existing.map((item) => item.tournamentParticipant);

  return tx.tournamentParticipant.findMany({
    where: {
      tournamentId: phase.tournamentId,
      isActive: true,
      rating: { not: null },
      advancedToMainEvent: phase.phaseType === "MAIN_EVENT" ? true : undefined,
    },
  });
}

async function assertNoOpenMatches(tx: Tx, phaseId: string) {
  const openMatches = await tx.match.count({
    where: { phaseId, status: { in: [...OPEN_MATCH_STATUSES] } },
  });
  if (openMatches > 0) throw new ApiError(400, "Phase has unfinished matches.");
}

async function assertNoWaitingQueue(tx: Tx, phaseId: string) {
  const waiting = await tx.queueEntry.count({ where: { phaseId, status: "WAITING" } });
  if (waiting > 0) throw new ApiError(400, "Phase has WAITING queue entries. Cancel them before completing.");
}

async function assertRequiredMatchesCompleted(
  tx: Tx,
  phase: { id: string; tournamentId: string; phaseType: TournamentPhaseType; requiredMatchesPerPlayer: number },
) {
  const participants = await phaseTargetsInTx(tx, phase);
  const counts = await tx.matchPlayer.groupBy({
    by: ["userId"],
    where: {
      userId: { in: participants.map((participant) => participant.userId) },
      match: { phaseId: phase.id, status: "CONFIRMED" },
    },
    _count: { userId: true },
  });
  const countByUserId = new Map(counts.map((count) => [count.userId, count._count.userId]));
  const incomplete = participants.filter(
    (participant) => (countByUserId.get(participant.userId) ?? 0) < phase.requiredMatchesPerPlayer,
  );

  if (incomplete.length > 0) {
    throw new ApiError(400, "Not all target participants have completed required matches.");
  }
}

function parsePhaseInput(input: {
  phaseType?: unknown;
  requiredMatchesPerPlayer?: unknown;
  advancePlayerCount?: unknown;
  advancementMode?: unknown;
  sortOrder?: unknown;
  rule?: unknown;
  stageSelectionMode?: unknown;
  defaultStageId?: unknown;
}) {
  const phaseType: TournamentPhaseType | null =
    input.phaseType === "QUALIFIER" || input.phaseType === "MAIN_EVENT" ? input.phaseType : null;
  const requiredMatchesPerPlayer = Number(input.requiredMatchesPerPlayer);
  const sortOrder = Number(input.sortOrder);
  const advancementMode: AdvancementMode | null =
    input.advancementMode === undefined || input.advancementMode === "OVERALL"
      ? "OVERALL"
      : input.advancementMode === "BLOCK"
        ? "BLOCK"
        : null;
  const rule: MatchRule | null =
    input.rule === undefined || input.rule === "AREA"
      ? "AREA"
      : input.rule === "YAGURA" || input.rule === "HOKO" || input.rule === "ASARI"
        ? input.rule
        : null;
  const stageSelectionMode: StageSelectionMode | null =
    input.stageSelectionMode === undefined || input.stageSelectionMode === "RANDOM"
      ? "RANDOM"
      : input.stageSelectionMode === "ADMIN"
        ? "ADMIN"
        : null;
  const defaultStageId = typeof input.defaultStageId === "string" && input.defaultStageId.length > 0 ? input.defaultStageId : null;
  const advancePlayerCount =
    input.advancePlayerCount === undefined || input.advancePlayerCount === null || input.advancePlayerCount === ""
      ? null
      : Number(input.advancePlayerCount);

  if (!phaseType) throw new ApiError(400, "phaseType must be QUALIFIER or MAIN_EVENT.");
  if (!advancementMode) throw new ApiError(400, "advancementMode must be OVERALL or BLOCK.");
  if (!rule) throw new ApiError(400, "rule must be AREA, YAGURA, HOKO, or ASARI.");
  if (!stageSelectionMode) throw new ApiError(400, "stageSelectionMode must be RANDOM or ADMIN.");
  if (!Number.isInteger(requiredMatchesPerPlayer) || requiredMatchesPerPlayer <= 0 || requiredMatchesPerPlayer > 50) {
    throw new ApiError(400, "requiredMatchesPerPlayer must be an integer between 1 and 50.");
  }
  if (!Number.isInteger(sortOrder) || sortOrder <= 0 || sortOrder > 20) {
    throw new ApiError(400, "sortOrder must be an integer between 1 and 20.");
  }
  if (advancePlayerCount !== null && (!Number.isInteger(advancePlayerCount) || advancePlayerCount <= 0 || advancePlayerCount > 256)) {
    throw new ApiError(400, "advancePlayerCount must be an integer between 1 and 256.");
  }

  return { phaseType, requiredMatchesPerPlayer, advancePlayerCount, advancementMode, sortOrder, rule, stageSelectionMode, defaultStageId };
}

export async function createPhase(
  adminUserId: string,
  tournamentId: string,
  input: {
    phaseType?: unknown;
    requiredMatchesPerPlayer?: unknown;
    advancePlayerCount?: unknown;
    advancementMode?: unknown;
    sortOrder?: unknown;
    rule?: unknown;
    stageSelectionMode?: unknown;
    defaultStageId?: unknown;
  },
) {
  const data = parsePhaseInput(input);

  return prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new ApiError(404, "Tournament not found.");
    if (tournament.status === TournamentStatus.FINISHED) throw new ApiError(400, "FINISHED tournaments cannot add phases.");
    if (data.defaultStageId) {
      await requireUsableTournamentStage(tx, tournamentId, data.defaultStageId);
    }
    const phase = await tx.tournamentPhase.create({ data: { tournamentId, status: "PENDING", ...data } });
    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "PHASE_CREATED",
        targetType: "TournamentPhase",
        targetId: phase.id,
        metadata: { tournamentId, ...data },
      },
    });
    return phase;
  });
}

export async function updatePhase(
  phaseId: string,
  input: {
    requiredMatchesPerPlayer?: unknown;
    advancePlayerCount?: unknown;
    advancementMode?: unknown;
    rule?: unknown;
    stageSelectionMode?: unknown;
    defaultStageId?: unknown;
  },
) {
  const phase = await prisma.tournamentPhase.findUnique({ where: { id: phaseId } });
  if (!phase) throw new ApiError(404, "Phase not found.");
  if (phase.status !== TournamentPhaseStatus.PENDING) {
    throw new ApiError(400, "Only PENDING phases can be edited.");
  }

  const data: {
    requiredMatchesPerPlayer?: number;
    advancePlayerCount?: number | null;
    advancementMode?: "OVERALL" | "BLOCK";
    rule?: MatchRule;
    stageSelectionMode?: StageSelectionMode;
    defaultStageId?: string | null;
  } = {};

  if (input.requiredMatchesPerPlayer !== undefined) {
    const value = Number(input.requiredMatchesPerPlayer);
    if (!Number.isInteger(value) || value < 0) throw new ApiError(400, "requiredMatchesPerPlayer must be a non-negative integer.");
    data.requiredMatchesPerPlayer = value;
  }
  if (input.advancePlayerCount !== undefined) {
    if (input.advancePlayerCount === null || input.advancePlayerCount === "") {
      data.advancePlayerCount = null;
    } else {
      const value = Number(input.advancePlayerCount);
      if (!Number.isInteger(value) || value <= 0) throw new ApiError(400, "advancePlayerCount must be a positive integer.");
      data.advancePlayerCount = value;
    }
  }
  if (input.advancementMode !== undefined) {
    if (input.advancementMode !== "OVERALL" && input.advancementMode !== "BLOCK") {
      throw new ApiError(400, "advancementMode must be OVERALL or BLOCK.");
    }
    data.advancementMode = input.advancementMode;
  }
  if (input.rule !== undefined) {
    if (input.rule !== "AREA" && input.rule !== "YAGURA" && input.rule !== "HOKO" && input.rule !== "ASARI") {
      throw new ApiError(400, "rule is invalid.");
    }
    data.rule = input.rule;
  }
  if (input.stageSelectionMode !== undefined) {
    if (input.stageSelectionMode !== "ADMIN" && input.stageSelectionMode !== "RANDOM") {
      throw new ApiError(400, "stageSelectionMode is invalid.");
    }
    data.stageSelectionMode = input.stageSelectionMode;
  }
  if (input.defaultStageId !== undefined) {
    data.defaultStageId = typeof input.defaultStageId === "string" && input.defaultStageId.length > 0 ? input.defaultStageId : null;
  }

  return prisma.$transaction(async (tx) => {
    if (data.defaultStageId) {
      await requireUsableTournamentStage(tx, phase.tournamentId, data.defaultStageId);
    }
    return tx.tournamentPhase.update({ where: { id: phaseId }, data });
  });
}

export async function startPhase(adminUserId: string, phaseId: string) {
  return withSerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const phase = await tx.tournamentPhase.findUnique({ where: { id: phaseId }, include: { tournament: true } });
        if (!phase) throw new ApiError(404, "Phase not found.");
        if (phase.tournament.status !== TournamentStatus.ACTIVE) throw new ApiError(400, "Tournament must be ACTIVE.");
        if (phase.status !== TournamentPhaseStatus.PENDING) throw new ApiError(400, "Only PENDING phases can start.");

        if (phase.phaseType === "MAIN_EVENT") {
          const qualifier = await tx.tournamentPhase.findFirst({
            where: { tournamentId: phase.tournamentId, phaseType: "QUALIFIER" },
          });
          if (!qualifier || qualifier.status !== "COMPLETED") {
            throw new ApiError(400, "QUALIFIER must be COMPLETED before MAIN_EVENT starts.");
          }
          const mainTargets = await tx.tournamentPhaseParticipant.count({
            where: { phaseId, isEligible: true },
          });
          if (mainTargets === 0) {
            throw new ApiError(400, "Advancement must be confirmed before MAIN_EVENT starts.");
          }
        }

        const sourceParticipants =
          phase.phaseType === "MAIN_EVENT"
            ? await tx.tournamentPhaseParticipant.findMany({
                where: { phaseId, isEligible: true },
                include: { tournamentParticipant: true },
              })
            : await tx.tournamentParticipant.findMany({
                where: { tournamentId: phase.tournamentId, isActive: true, rating: { not: null } },
              });

        const participants =
          phase.phaseType === "MAIN_EVENT"
            ? sourceParticipants.map((item) => ("tournamentParticipant" in item ? item.tournamentParticipant : item))
            : sourceParticipants;

        if (participants.length === 0) throw new ApiError(400, "Phase has no eligible participants.");

        await tx.tournamentPhaseParticipant.createMany({
          data: participants.map((participant) => ({
            phaseId,
            tournamentParticipantId: participant.id,
            isEligible: true,
            isAdvancing: false,
          })),
          skipDuplicates: true,
        });

        const started = await tx.tournamentPhase.update({
          where: { id: phaseId },
          data: { status: "ACTIVE", startedAt: new Date() },
        });
        await tx.adminActionLog.create({
          data: {
            adminUserId,
            action: "PHASE_STARTED",
            targetType: "TournamentPhase",
            targetId: phaseId,
            metadata: { participantCount: participants.length },
          },
        });
        return started;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function getPhaseReadiness(phaseId: string) {
  const target = await getPhaseTargetParticipants(phaseId);
  if (!target) throw new ApiError(404, "Phase not found.");

  const counts = await prisma.matchPlayer.groupBy({
    by: ["userId"],
    where: {
      userId: { in: target.participants.map((participant) => participant.userId) },
      match: { phaseId, status: "CONFIRMED" },
    },
    _count: { userId: true },
  });
  const countByUserId = new Map(counts.map((count) => [count.userId, count._count.userId]));
  const unfinishedMatches = await prisma.match.count({ where: { phaseId, status: { in: [...OPEN_MATCH_STATUSES] } } });
  const waitingQueueEntries = await prisma.queueEntry.count({ where: { phaseId, status: "WAITING" } });
  const rows = target.participants.map((participant) => {
    const confirmedMatchesInPhase = countByUserId.get(participant.userId) ?? 0;
    return {
      tournamentParticipantId: participant.id,
      userId: participant.userId,
      confirmedMatchesInPhase,
      remainingMatchesInPhase: Math.max(target.phase.requiredMatchesPerPlayer - confirmedMatchesInPhase, 0),
      complete: confirmedMatchesInPhase >= target.phase.requiredMatchesPerPlayer,
    };
  });

  return {
    phase: target.phase,
    rows,
    unfinishedMatches,
    waitingQueueEntries,
    canComplete:
      target.phase.status === "ACTIVE" &&
      rows.every((row) => row.complete) &&
      unfinishedMatches === 0 &&
      waitingQueueEntries === 0,
  };
}

export async function getQualifierAdvancementPreview(phaseId: string) {
  const ranking = await getPhaseRanking(phaseId);
  if (!ranking) throw new ApiError(404, "Phase not found.");
  if (ranking.phase.phaseType !== "QUALIFIER") throw new ApiError(400, "Phase must be QUALIFIER.");

  if (ranking.phase.advancementMode === "OVERALL") {
    if (!ranking.phase.advancePlayerCount) throw new ApiError(400, "advancePlayerCount is required.");
    return buildOverallAdvancementCandidates(ranking.rows, ranking.phase.advancePlayerCount);
  }

  const blocks = await prisma.tournamentBlock.findMany({
    where: { phaseId },
    include: {
      participants: {
        include: {
          tournamentParticipant: {
            include: { user: { select: { id: true, name: true, discordUsername: true } } },
          },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });
  if (blocks.length === 0) throw new ApiError(400, "BLOCK advancement requires blocks.");

  return buildBlockAdvancementCandidates(
    blocks.map((block) => {
      const participants = block.participants
        .map((item) => item.tournamentParticipant)
        .filter((participant) => participant.isActive && participant.rating !== null)
        .sort((left, right) => new Prisma.Decimal(right.rating ?? 0).comparedTo(left.rating ?? 0));
      if (block.advancePlayerCount && block.advancePlayerCount > participants.length) {
        throw new ApiError(400, "advancePlayerCount cannot exceed block participant count.");
      }
      return {
        blockId: block.id,
        blockName: block.name,
        advancePlayerCount: block.advancePlayerCount,
        rows: assignCompetitionRanks(participants),
      };
    }),
  );
}

export async function completePhase(adminUserId: string, phaseId: string) {
  return withSerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const phase = await tx.tournamentPhase.findUnique({ where: { id: phaseId }, include: { tournament: true } });
        if (!phase) throw new ApiError(404, "Phase not found.");
        if (phase.tournament.status !== TournamentStatus.ACTIVE) throw new ApiError(400, "Tournament must be ACTIVE.");
        if (phase.status !== TournamentPhaseStatus.ACTIVE) throw new ApiError(400, "Phase must be ACTIVE.");

        await assertNoOpenMatches(tx, phaseId);
        await assertNoWaitingQueue(tx, phaseId);
        await assertRequiredMatchesCompleted(tx, phase);

        const completed = await tx.tournamentPhase.update({
          where: { id: phaseId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
        await tx.adminActionLog.create({
          data: {
            adminUserId,
            action: "PHASE_COMPLETED",
            targetType: "TournamentPhase",
            targetId: phaseId,
            metadata: { phaseType: phase.phaseType },
          },
        });

        return completed;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function confirmQualifierAdvancement(adminUserId: string, phaseId: string, selectedTournamentParticipantIds?: string[]) {
  return withSerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const phase = await tx.tournamentPhase.findUnique({ where: { id: phaseId }, include: { tournament: true } });
        if (!phase) throw new ApiError(404, "Phase not found.");
        if (phase.phaseType !== TournamentPhaseType.QUALIFIER) throw new ApiError(400, "Phase must be QUALIFIER.");
        if (phase.status !== TournamentPhaseStatus.COMPLETED) throw new ApiError(400, "Qualifier phase must be COMPLETED.");

        const preview = await getQualifierAdvancementPreview(phaseId);
        const selectedIds = selectedTournamentParticipantIds ?? [];
        let advancingIds: string[] = [];
        const tieCandidates: string[] = [];

        if ("blocks" in preview) {
          for (const block of preview.blocks) {
            if (block.advancePlayerCount <= 0) throw new ApiError(400, "Each block must have advancePlayerCount.");
            advancingIds.push(...block.autoAdvanceRows.map((row) => row.tournamentParticipantId));
            tieCandidates.push(...block.boundaryTieRows.map((row) => row.tournamentParticipantId));
            if (block.status === "NEEDS_ADMIN_DECISION") {
              const boundaryIds = new Set(block.boundaryTieRows.map((row) => row.tournamentParticipantId));
              const blockSelected = selectedIds.filter((id) => boundaryIds.has(id));
              if (blockSelected.length !== block.requiredAdminSelections) {
                throw new ApiError(400, "Admin selection count does not match requiredAdminSelections.");
              }
              advancingIds.push(...blockSelected);
            }
          }
          const allowed = new Set(tieCandidates);
          const invalid = selectedIds.filter((id) => !allowed.has(id));
          if (invalid.length > 0) throw new ApiError(400, "Selected participants must come from boundary tie groups.");
        } else {
          advancingIds = preview.autoAdvanceRows.map((row) => row.tournamentParticipantId);
          tieCandidates.push(...preview.boundaryTieRows.map((row) => row.tournamentParticipantId));
          if (preview.status === "NEEDS_ADMIN_DECISION") {
            const boundaryIds = new Set(preview.boundaryTieRows.map((row) => row.tournamentParticipantId));
            const invalid = selectedIds.filter((id) => !boundaryIds.has(id));
            if (invalid.length > 0) throw new ApiError(400, "Selected participants must come from the boundary tie group.");
            if (selectedIds.length !== preview.requiredAdminSelections) {
              throw new ApiError(400, "Admin selection count does not match requiredAdminSelections.");
            }
            advancingIds = [...advancingIds, ...selectedIds];
          }
        }

        if (new Set(advancingIds).size !== advancingIds.length) {
          throw new ApiError(400, "Duplicate advancing participants are not allowed.");
        }

        const mainPhase = await tx.tournamentPhase.findFirst({
          where: { tournamentId: phase.tournamentId, phaseType: "MAIN_EVENT" },
        });
        if (!mainPhase) throw new ApiError(400, "MAIN_EVENT phase is required.");

        await tx.tournamentPhaseParticipant.updateMany({
          where: { phaseId },
          data: { isAdvancing: false, advancedAt: null },
        });
        await tx.tournamentPhaseParticipant.updateMany({
          where: { phaseId, tournamentParticipantId: { in: advancingIds } },
          data: { isAdvancing: true, advancedAt: new Date() },
        });
        await tx.tournamentParticipant.updateMany({
          where: { tournamentId: phase.tournamentId },
          data: { advancedToMainEvent: false },
        });
        await tx.tournamentParticipant.updateMany({
          where: { id: { in: advancingIds } },
          data: { advancedToMainEvent: true },
        });
        await tx.tournamentPhaseParticipant.createMany({
          data: advancingIds.map((id) => ({
            phaseId: mainPhase.id,
            tournamentParticipantId: id,
            isEligible: true,
            isAdvancing: false,
          })),
          skipDuplicates: true,
        });
        await tx.adminActionLog.create({
          data: {
            adminUserId,
            action: "QUALIFIER_ADVANCEMENT_CONFIRMED",
            targetType: "TournamentPhase",
            targetId: phaseId,
            metadata: {
              phaseId,
              advancementMode: phase.advancementMode,
              selectedParticipantIds: selectedIds,
              tieCandidates,
              adminUserId,
              confirmedAt: new Date().toISOString(),
              advancingIds,
              previewStatus: preview.status,
            },
          },
        });

        return { advancingIds, mainPhaseId: mainPhase.id, preview };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}

export async function finishTournament(adminUserId: string, tournamentId: string) {
  return withSerializable(() =>
    prisma.$transaction(
      async (tx) => {
        const tournament = await tx.tournament.findUnique({ where: { id: tournamentId }, include: { phases: true } });
        if (!tournament) throw new ApiError(404, "Tournament not found.");
        if (tournament.status !== TournamentStatus.ACTIVE) throw new ApiError(400, "Only ACTIVE tournaments can be finished.");

        const mainPhase = tournament.phases.find((phase) => phase.phaseType === "MAIN_EVENT");
        if (!mainPhase || mainPhase.status !== "COMPLETED") {
          throw new ApiError(400, "MAIN_EVENT must be COMPLETED before finishing tournament.");
        }
        const openMatches = await tx.match.count({
          where: { tournamentId, status: { in: [...OPEN_MATCH_STATUSES] } },
        });
        if (openMatches > 0) throw new ApiError(400, "Tournament has unfinished matches.");

        const participants = await tx.tournamentParticipant.findMany({
          where: { tournamentId, isActive: true, rating: { not: null } },
          include: { user: { select: { id: true, name: true, discordUsername: true } } },
          orderBy: { rating: "desc" },
        });
        const rankings = assignCompetitionRanks(participants);

        for (const row of rankings) {
          await tx.tournamentParticipant.update({ where: { id: row.tournamentParticipantId }, data: { finalRank: row.rank } });
        }

        const finished = await tx.tournament.update({
          where: { id: tournamentId },
          data: { status: "FINISHED", endsAt: new Date() },
        });
        await tx.adminActionLog.create({
          data: {
            adminUserId,
            action: "TOURNAMENT_FINISHED",
            targetType: "Tournament",
            targetId: tournamentId,
            metadata: { rankedParticipantCount: rankings.length },
          },
        });
        return finished;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );
}
