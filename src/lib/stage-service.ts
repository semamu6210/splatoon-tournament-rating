import { Prisma, type MatchStatus } from "@prisma/client";

import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

export function normalizeStageNames(names: unknown) {
  if (!Array.isArray(names) || names.length === 0) throw new ApiError(400, "使用ステージを1つ以上選択してください。");
  const normalized = names.map((name) => (typeof name === "string" ? name.trim() : "")).filter(Boolean);
  if (normalized.length === 0) throw new ApiError(400, "使用ステージを1つ以上選択してください。");
  if (normalized.length !== new Set(normalized).size) throw new ApiError(400, "ステージ名が重複しています。");
  if (normalized.some((name) => name.length > 80)) throw new ApiError(400, "ステージ名は80文字以内で入力してください。");
  return normalized;
}

export function normalizeStagePoolEnabled(value: unknown) {
  if (value === undefined) return undefined;
  if (value === true) return true;
  if (value === false) return false;
  throw new ApiError(400, "ステージプール設定が不正です。");
}

export async function findUsableTournamentStage(tx: Tx, tournamentId: string, stageId: string) {
  return tx.tournamentStage.findFirst({
    where: {
      id: stageId,
      tournamentId,
      isActive: true,
    },
  });
}

export async function requireUsableTournamentStage(tx: Tx, tournamentId: string, stageId: string) {
  const stage = await findUsableTournamentStage(tx, tournamentId, stageId);
  if (!stage) throw new ApiError(400, "この大会で使用できないステージです。");
  return stage;
}

async function validateStageReferencesBeforeRemoving(
  tx: Tx,
  tournamentId: string,
  removedStageIds: string[],
  openMatchStatuses: MatchStatus[] = ["CREATED"],
) {
  if (removedStageIds.length === 0) return;

  const defaultPhase = await tx.tournamentPhase.findFirst({
    where: { tournamentId, defaultStageId: { in: removedStageIds } },
    select: { id: true },
  });
  if (defaultPhase) {
    throw new ApiError(400, "既定ステージとして使用中のステージは無効化できません。先にフェーズ設定を変更してください。");
  }

  const openMatch = await tx.match.findFirst({
    where: { tournamentId, stageId: { in: removedStageIds }, status: { in: openMatchStatuses } },
    select: { id: true },
  });
  if (openMatch) {
    throw new ApiError(400, "未開始の試合で使用中のステージは無効化できません。先に試合のステージを変更してください。");
  }
}

export async function syncTournamentStagePool(
  tx: Tx,
  tournamentId: string,
  input: { stagePoolEnabled: boolean; stageNames?: string[] },
) {
  const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
  if (!tournament) throw new ApiError(404, "大会が見つかりません。");

  const before = await tx.tournamentStage.findMany({ where: { tournamentId }, orderBy: { sortOrder: "asc" } });
  const activeBefore = before.filter((stage) => stage.isActive);

  if (!input.stagePoolEnabled) {
    await validateStageReferencesBeforeRemoving(
      tx,
      tournamentId,
      activeBefore.map((stage) => stage.id),
    );
    await tx.tournament.update({ where: { id: tournamentId }, data: { stagePoolEnabled: false } });
    return {
      before: activeBefore,
      after: activeBefore,
      stages: before,
    };
  }

  if (!input.stageNames) throw new ApiError(400, "使用ステージを1つ以上選択してください。");
  const normalized = input.stageNames;
  const nextNames = new Set(normalized);
  const removedStageIds = activeBefore.filter((stage) => !nextNames.has(stage.name)).map((stage) => stage.id);
  await validateStageReferencesBeforeRemoving(tx, tournamentId, removedStageIds);

  for (const [index, stage] of before.entries()) {
    await tx.tournamentStage.update({
      where: { id: stage.id },
      data: { isActive: false, sortOrder: -(index + 1) },
    });
  }

  for (const [index, name] of normalized.entries()) {
    const existing = before.find((stage) => stage.name === name);
    if (existing) {
      await tx.tournamentStage.update({
        where: { id: existing.id },
        data: { isActive: true, sortOrder: index + 1 },
      });
    } else {
      await tx.tournamentStage.create({
        data: { tournamentId, name, sortOrder: index + 1, isActive: true },
      });
    }
  }

  await tx.tournament.update({ where: { id: tournamentId }, data: { stagePoolEnabled: true } });
  const after = await tx.tournamentStage.findMany({ where: { tournamentId, isActive: true }, orderBy: { sortOrder: "asc" } });
  return {
    before: activeBefore,
    after,
    stages: await tx.tournamentStage.findMany({ where: { tournamentId }, orderBy: { sortOrder: "asc" } }),
  };
}

export async function syncTournamentStages(tournamentId: string, names: unknown, adminUserId?: string) {
  const normalized = normalizeStageNames(names);

  return prisma.$transaction(async (tx) => {
    const result = await syncTournamentStagePool(tx, tournamentId, { stagePoolEnabled: true, stageNames: normalized });
    if (adminUserId) {
      await tx.adminActionLog.create({
        data: {
          adminUserId,
          action: "TOURNAMENT_STAGES_UPDATED",
          targetType: "Tournament",
          targetId: tournamentId,
          metadata: { before: result.before.map((stage) => stage.name), after: result.after.map((stage) => stage.name) },
        },
      });
    }
    return result.stages;
  });
}

export async function createTournamentStages(tournamentId: string, names: unknown) {
  return syncTournamentStages(tournamentId, names);
}

export async function setMatchStage(adminUserId: string, matchId: string, stageId: unknown) {
  if (typeof stageId !== "string" || stageId.trim().length === 0) {
    throw new ApiError(400, "ステージを選択してください。");
  }

  return prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({ where: { id: matchId } });
    if (!match) throw new ApiError(404, "試合が見つかりません。");
    if (match.status === "CONFIRMED" || match.status === "CANCELLED") {
      throw new ApiError(400, "確定済みまたはキャンセル済みの試合はステージを変更できません。");
    }

    const stage = await requireUsableTournamentStage(tx, match.tournamentId, stageId);

    const updated = await tx.match.update({
      where: { id: matchId },
      data: { stageId: stage.id, stageName: stage.name },
    });
    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "MATCH_STAGE_UPDATED",
        targetType: "Match",
        targetId: matchId,
        metadata: { before: match.stageName, after: stage.name },
      },
    });
    return updated;
  });
}
