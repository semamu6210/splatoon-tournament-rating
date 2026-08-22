import { Prisma, TournamentStatus, type RankingVisibility } from "@prisma/client";

import type { AuthenticatedUser } from "@/lib/authz";
import { ApiError } from "@/lib/http";
import {
  configSnapshot,
  normalizeRatingConfigInput,
  type RatingConfigInput,
  validateCompleteRatingConfig,
} from "@/lib/rating-config";
import { prisma } from "@/lib/prisma";
import { normalizeStageNames, normalizeStagePoolEnabled, syncTournamentStagePool } from "@/lib/stage-service";
import { areaXpValue, optionalDate, participantNameValue, requiredString } from "@/lib/validation";

export type TournamentInput = {
  name: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  rankingVisibility?: unknown;
  stagePoolEnabled?: unknown;
  stageNames?: unknown;
  isTestTournament?: unknown;
};

export function normalizeTournamentInput(input: TournamentInput) {
  const startsAt = optionalDate(input.startsAt, "startsAt");
  const endsAt = optionalDate(input.endsAt, "endsAt");
  const explicitStagePoolEnabled = normalizeStagePoolEnabled(input.stagePoolEnabled);
  const stagePoolEnabled = explicitStagePoolEnabled ?? (input.stageNames === undefined ? undefined : true);
  const stageNames = stagePoolEnabled ? normalizeStageNames(input.stageNames) : undefined;

  if (startsAt && endsAt && startsAt >= endsAt) {
    throw new ApiError(400, "endsAt must be after startsAt.");
  }

  return {
    name: requiredString(input.name, "name"),
    startsAt,
    endsAt,
    stagePoolEnabled,
    stageNames,
    rankingVisibility: (
      input.rankingVisibility === "OWN_BLOCK_ONLY" ||
      input.rankingVisibility === "OWN_AND_OTHER_BLOCKS" ||
      input.rankingVisibility === "OVERALL_ONLY" ||
      input.rankingVisibility === "ALL"
        ? input.rankingVisibility
        : undefined) as RankingVisibility | undefined,
    isTestTournament: input.isTestTournament === true || input.isTestTournament === "true",
  };
}

export async function createTournament(adminUserId: string, input: TournamentInput) {
  const data = normalizeTournamentInput(input);
  const { stageNames, stagePoolEnabled, ...tournamentData } = data;

  return prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.create({
      data: {
        ...tournamentData,
        stagePoolEnabled: Boolean(stagePoolEnabled),
        createdByUserId: adminUserId,
        status: TournamentStatus.DRAFT,
      },
    });
    if (stageNames) {
      await tx.tournamentStage.createMany({
        data: stageNames.map((name, index) => ({ tournamentId: tournament.id, name, sortOrder: index + 1 })),
      });
    }

    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "TOURNAMENT_CREATED",
        targetType: "Tournament",
        targetId: tournament.id,
        metadata: { after: { ...tournamentData, stagePoolEnabled: Boolean(stagePoolEnabled), stageNames: stageNames ?? [] } },
      },
    });

    return tournament;
  });
}

export async function updateTournament(adminUserId: string, tournamentId: string, input: TournamentInput) {
  const data = normalizeTournamentInput(input);
  const { stageNames, stagePoolEnabled, isTestTournament, ...tournamentData } = data;

  return prisma.$transaction(async (tx) => {
    const before = await tx.tournament.findUnique({ where: { id: tournamentId } });
    const stagesBefore = await tx.tournamentStage.findMany({ where: { tournamentId, isActive: true }, orderBy: { sortOrder: "asc" } });

    if (!before) {
      throw new ApiError(404, "Tournament not found.");
    }

    if (before.status !== TournamentStatus.DRAFT && before.status !== TournamentStatus.REGISTRATION) {
      throw new ApiError(400, "Only DRAFT or REGISTRATION tournaments can be edited.");
    }

    await tx.tournament.update({
      where: { id: tournamentId },
        data: {
          ...tournamentData,
          ...(before.status === TournamentStatus.DRAFT ? { isTestTournament } : {}),
        },
    });
    let stagesAfter = stagesBefore;
    if (stagePoolEnabled !== undefined) {
      const result = await syncTournamentStagePool(tx, tournamentId, { stagePoolEnabled, stageNames });
      stagesAfter = result.after;
    }
    const after = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "TOURNAMENT_UPDATED",
        targetType: "Tournament",
        targetId: tournamentId,
        metadata: {
          before: {
            name: before.name,
            startsAt: before.startsAt?.toISOString() ?? null,
            endsAt: before.endsAt?.toISOString() ?? null,
            stageNames: stagesBefore.map((stage) => stage.name),
            isTestTournament: before.isTestTournament,
          },
          after: {
            name: after.name,
            startsAt: after.startsAt?.toISOString() ?? null,
            endsAt: after.endsAt?.toISOString() ?? null,
            stagePoolEnabled: stagePoolEnabled ?? before.stagePoolEnabled,
            stageNames: stagesAfter.map((stage) => stage.name),
            isTestTournament: after.isTestTournament,
          },
        },
      },
    });

    return after;
  });
}

export async function deleteTournament(user: AuthenticatedUser, tournamentId: string, input: { name?: unknown }) {
  const confirmationName = typeof input.name === "string" ? input.name : "";

  return prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        name: true,
        status: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            phases: true,
            participants: true,
            queueEntries: true,
            matches: true,
            ratingHistories: true,
            stages: true,
          },
        },
      },
    });

    if (!tournament) throw new ApiError(404, "大会が見つかりません。");

    const allowed = user.role === "ADMIN" || (user.role === "OWNER" && tournament.createdByUserId === user.id);
    if (!allowed) throw new ApiError(403, "大会を削除する権限がありません。");

    if (confirmationName !== tournament.name) {
      throw new ApiError(400, "大会名が一致しません。");
    }

    const phaseParticipants = await tx.tournamentPhaseParticipant.count({ where: { phase: { tournamentId } } });
    const blocks = await tx.tournamentBlock.count({ where: { phase: { tournamentId } } });
    const blockParticipants = await tx.tournamentBlockParticipant.count({ where: { phase: { tournamentId } } });
    const matchPlayers = await tx.matchPlayer.count({ where: { match: { tournamentId } } });
    const resultReports = await tx.matchResultReport.count({ where: { match: { tournamentId } } });
    const playerVotes = await tx.playerVote.count({ where: { match: { tournamentId } } });
    const ratingConfigs = await tx.tournamentRatingConfig.count({ where: { tournamentId } });

    await tx.adminActionLog.create({
      data: {
        adminUserId: user.id,
        action: "TOURNAMENT_DELETED",
        targetType: "Tournament",
        targetId: tournamentId,
        metadata: {
          deletedTournament: {
            id: tournament.id,
            name: tournament.name,
            status: tournament.status,
            createdByUserId: tournament.createdByUserId,
            createdAt: tournament.createdAt.toISOString(),
            updatedAt: tournament.updatedAt.toISOString(),
          },
          deletedCounts: {
            ...tournament._count,
            ratingConfigs,
            phaseParticipants,
            blocks,
            blockParticipants,
            matchPlayers,
            resultReports,
            playerVotes,
          },
        },
      },
    });

    await tx.tournament.delete({ where: { id: tournamentId } });
    return { deleted: true as const, tournamentId, name: tournament.name };
  });
}

export async function openRegistration(adminUserId: string, tournamentId: string) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.tournament.findUnique({ where: { id: tournamentId } });

    if (!before) {
      throw new ApiError(404, "Tournament not found.");
    }

    if (before.status !== TournamentStatus.DRAFT) {
      throw new ApiError(400, "Only DRAFT tournaments can open registration.");
    }

    const after = await tx.tournament.update({
      where: { id: tournamentId },
      data: { status: TournamentStatus.REGISTRATION },
    });

    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "TOURNAMENT_REGISTRATION_OPENED",
        targetType: "Tournament",
        targetId: tournamentId,
        metadata: { before: { status: before.status }, after: { status: after.status } },
      },
    });

    return after;
  });
}

export async function createRatingConfigVersion(
  adminUserId: string,
  tournamentId: string,
  input: RatingConfigInput,
) {
  const normalized = normalizeRatingConfigInput(input);

  return prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });

    if (!tournament) {
      throw new ApiError(404, "Tournament not found.");
    }

    if (tournament.status === TournamentStatus.FINISHED) {
      throw new ApiError(400, "FINISHED tournaments cannot change rating config.");
    }

    const activeBefore = await tx.tournamentRatingConfig.findFirst({
      where: { tournamentId, isActive: true },
      include: { xpMultiplierTiers: true },
    });

    const latest = await tx.tournamentRatingConfig.findFirst({
      where: { tournamentId },
      orderBy: { version: "desc" },
    });

    await tx.tournamentRatingConfig.updateMany({
      where: { tournamentId, isActive: true },
      data: { isActive: false },
    });

    const created = await tx.tournamentRatingConfig.create({
      data: {
        tournamentId,
        version: (latest?.version ?? 0) + 1,
        initialRating: normalized.initialRating,
        winBonus: normalized.winBonus,
        strongVotePoints: normalized.strongVotePoints,
        weakVotePoints: normalized.weakVotePoints,
        losingStreakPenalty: normalized.losingStreakPenalty,
        xpTierStepSize: normalized.xpTierStepSize,
        isActive: true,
        xpMultiplierTiers: {
          create: normalized.tiers.map((tier) => ({
            minXp: tier.minXp,
            maxXp: tier.maxXp,
            multiplier: tier.multiplier,
            sortOrder: tier.sortOrder,
          })),
        },
      },
      include: { xpMultiplierTiers: true },
    });

    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: activeBefore ? "RATING_CONFIG_VERSION_CREATED" : "RATING_CONFIG_CREATED",
        targetType: "Tournament",
        targetId: tournamentId,
        metadata: {
          before: activeBefore ? configSnapshot(activeBefore) : null,
          after: configSnapshot(created),
        },
      },
    });

    return created;
  });
}

export async function joinTournament(userId: string, tournamentId: string, input: { areaXp: unknown; participantName: unknown }) {
  const areaXp = areaXpValue(input.areaXp);
  const participantName = participantNameValue(input.participantName);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(404, "User not found.");
    const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });

    if (!tournament) {
      throw new ApiError(404, "Tournament not found.");
    }

    if (tournament.status !== TournamentStatus.REGISTRATION) {
      throw new ApiError(400, "Tournament registration is not open.");
    }

    const existing = await tx.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });

    if (existing?.isActive) {
      throw new ApiError(409, "Already joined this tournament.");
    }

    if (existing) {
      return tx.tournamentParticipant.update({
        where: { id: existing.id },
        data: {
          areaXp,
          participantName,
          rating: null,
          ratingInitializedAt: null,
          initialRatingConfigId: null,
          initialRatingConfigVersion: null,
          isActive: true,
        },
      });
    }

    return tx.tournamentParticipant.create({
      data: {
        tournamentId,
        userId,
        participantName,
        areaXp,
        rating: null,
        ratingInitializedAt: null,
      },
    });
  });
}

export async function updateParticipantName(user: AuthenticatedUser, tournamentId: string, input: { participantName: unknown }) {
  const participantName = participantNameValue(input.participantName);

  return prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new ApiError(404, "Tournament not found.");

    const participant = await tx.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId: user.id } },
    });
    if (!participant || !participant.isActive) throw new ApiError(404, "Active participation not found.");
    if (tournament.status !== TournamentStatus.REGISTRATION) {
      throw new ApiError(400, "participantName can be changed only during REGISTRATION.");
    }

    return tx.tournamentParticipant.update({
      where: { id: participant.id },
      data: { participantName },
    });
  });
}

export async function leaveTournament(userId: string, tournamentId: string) {
  return prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });

    if (!tournament) {
      throw new ApiError(404, "Tournament not found.");
    }

    if (tournament.status !== TournamentStatus.REGISTRATION) {
      throw new ApiError(400, "You can leave only during REGISTRATION.");
    }

    const participant = await tx.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });

    if (!participant || !participant.isActive) {
      throw new ApiError(404, "Active participation not found.");
    }

    return tx.tournamentParticipant.update({
      where: { id: participant.id },
      data: { isActive: false },
    });
  });
}

export async function startTournament(adminUserId: string, tournamentId: string) {
  return prisma.$transaction(
    async (tx) => {
      const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });

      if (!tournament) {
        throw new ApiError(404, "Tournament not found.");
      }

      if (tournament.status !== TournamentStatus.REGISTRATION) {
        throw new ApiError(400, "Only REGISTRATION tournaments can be started.");
      }
      if (tournament.stagePoolEnabled) {
        const stageCount = await tx.tournamentStage.count({ where: { tournamentId, isActive: true } });
        if (stageCount === 0) throw new ApiError(400, "使用ステージを1つ以上選択してください。");
      }

      const activeConfigs = await tx.tournamentRatingConfig.findMany({
        where: { tournamentId, isActive: true },
        include: { xpMultiplierTiers: true },
      });

      if (activeConfigs.length !== 1) {
        throw new ApiError(400, "Tournament must have exactly one active rating config.");
      }

      const activeConfig = activeConfigs[0];
      validateCompleteRatingConfig(activeConfig);

      const participants = await tx.tournamentParticipant.findMany({
        where: { tournamentId, isActive: true },
      });

      if (participants.length === 0) {
        throw new ApiError(400, "Tournament must have at least one active participant.");
      }

      for (const participant of participants) {
        areaXpValue(participant.areaXp);
      }

      const initializedAt = new Date();

      await tx.tournamentParticipant.updateMany({
        where: { tournamentId, isActive: true },
        data: {
          rating: activeConfig.initialRating,
          ratingInitializedAt: initializedAt,
          initialRatingConfigId: activeConfig.id,
          initialRatingConfigVersion: activeConfig.version,
        },
      });

      const after = await tx.tournament.update({
        where: { id: tournamentId },
        data: {
          status: TournamentStatus.ACTIVE,
          startRatingConfigId: activeConfig.id,
          startRatingConfigVersion: activeConfig.version,
          startsAt: tournament.startsAt ?? initializedAt,
        },
      });

      await tx.adminActionLog.create({
        data: {
          adminUserId,
          action: "TOURNAMENT_STARTED",
          targetType: "Tournament",
          targetId: tournamentId,
          metadata: {
            ratingConfig: configSnapshot(activeConfig),
            participantCount: participants.length,
          },
        },
      });

      return after;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
