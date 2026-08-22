import { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

function parseBlockInputs(input: unknown) {
  if (Array.isArray(input)) {
    return input.map((name, index) => ({
      name: typeof name === "string" ? name.trim() : "",
      advancePlayerCount: null as number | null,
      sortOrder: index + 1,
    }));
  }
  if (typeof input === "object" && input !== null && Array.isArray((input as { blocks?: unknown }).blocks)) {
    return (input as { blocks: Array<{ name?: unknown; advancePlayerCount?: unknown }> }).blocks.map((block, index) => {
      const advancePlayerCount =
        block.advancePlayerCount === undefined || block.advancePlayerCount === null || block.advancePlayerCount === ""
          ? null
          : Number(block.advancePlayerCount);
      if (advancePlayerCount !== null && (!Number.isInteger(advancePlayerCount) || advancePlayerCount < 0 || advancePlayerCount > 256)) {
        throw new ApiError(400, "block advancePlayerCount must be an integer between 0 and 256.");
      }
      return {
        name: typeof block.name === "string" ? block.name.trim() : "",
        advancePlayerCount,
        sortOrder: index + 1,
      };
    });
  }
  throw new ApiError(400, "names or blocks must be provided.");
}

export async function createPhaseBlocks(phaseId: string, namesOrBlocks: unknown, adminUserId?: string) {
  const normalized = parseBlockInputs(namesOrBlocks).filter((block) => block.name);
  if (normalized.length === 0) throw new ApiError(400, "At least one block is required.");
  if (normalized.length > 64) throw new ApiError(400, "Blocks must contain 64 entries or fewer.");
  if (normalized.some((block) => block.name.length > 80)) throw new ApiError(400, "Block name must be 80 characters or fewer.");
  if (normalized.length !== new Set(normalized.map((block) => block.name)).size) {
    throw new ApiError(400, "Block names must be unique.");
  }

  return prisma.$transaction(async (tx) => {
    const phase = await tx.tournamentPhase.findUnique({ where: { id: phaseId } });
    if (!phase) throw new ApiError(404, "Phase not found.");
    if (phase.status !== "PENDING") throw new ApiError(400, "Blocks can be changed only while phase is PENDING.");
    await tx.tournamentBlock.createMany({
      data: normalized.map((block) => ({ phaseId, ...block })),
      skipDuplicates: true,
    });
    if (adminUserId) {
      await tx.adminActionLog.create({
        data: {
          adminUserId,
          action: "PHASE_BLOCKS_CREATED",
          targetType: "TournamentPhase",
          targetId: phaseId,
          metadata: { blocks: normalized },
        },
      });
    }
    return tx.tournamentBlock.findMany({ where: { phaseId }, orderBy: { sortOrder: "asc" } });
  });
}

export async function autoAssignPhaseBlocks(phaseId: string, adminUserId?: string) {
  return prisma.$transaction(
    async (tx) => {
      const blocks = await tx.tournamentBlock.findMany({ where: { phaseId }, orderBy: { sortOrder: "asc" } });
      if (blocks.length === 0) throw new ApiError(400, "Create blocks before auto assignment.");

      const phase = await tx.tournamentPhase.findUnique({ where: { id: phaseId } });
      if (!phase) throw new ApiError(404, "Phase not found.");
      if (phase.status !== "PENDING") throw new ApiError(400, "Blocks can be assigned only while phase is PENDING.");

      const phaseParticipants = await tx.tournamentPhaseParticipant.findMany({
        where: { phaseId, isEligible: true },
        include: { tournamentParticipant: true },
        orderBy: { createdAt: "asc" },
      });
      const participants =
        phaseParticipants.length > 0
          ? phaseParticipants.map((item) => item.tournamentParticipant)
          : await tx.tournamentParticipant.findMany({
              where: { tournamentId: phase.tournamentId, isActive: true },
              orderBy: { joinedAt: "asc" },
            });

      await tx.tournamentBlockParticipant.deleteMany({ where: { phaseId } });
      await tx.tournamentBlockParticipant.createMany({
        data: participants.map((participant, index) => {
          const block = blocks[index % blocks.length];
          return { phaseId, blockId: block.id, tournamentParticipantId: participant.id };
        }),
      });
      if (adminUserId) {
        await tx.adminActionLog.create({
          data: {
            adminUserId,
            action: "PHASE_BLOCKS_AUTO_ASSIGNED",
            targetType: "TournamentPhase",
            targetId: phaseId,
            metadata: { participantCount: participants.length, blockCount: blocks.length },
          },
        });
      }

      return tx.tournamentBlock.findMany({
        where: { phaseId },
        include: { participants: true },
        orderBy: { sortOrder: "asc" },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function moveParticipantToBlock(phaseId: string, tournamentParticipantId: unknown, blockId: unknown, adminUserId?: string) {
  if (typeof tournamentParticipantId !== "string" || !tournamentParticipantId) {
    throw new ApiError(400, "tournamentParticipantId is required.");
  }
  if (typeof blockId !== "string" || !blockId) throw new ApiError(400, "blockId is required.");

  return prisma.$transaction(
    async (tx) => {
      const block = await tx.tournamentBlock.findUnique({ where: { id: blockId } });
      if (!block || block.phaseId !== phaseId) throw new ApiError(404, "Block not found in phase.");
      const phase = await tx.tournamentPhase.findUnique({ where: { id: phaseId } });
      if (!phase) throw new ApiError(404, "Phase not found.");
      if (phase.status !== "PENDING") throw new ApiError(400, "Blocks can be changed only while phase is PENDING.");

      await tx.tournamentBlockParticipant.deleteMany({ where: { phaseId, tournamentParticipantId } });
      const moved = await tx.tournamentBlockParticipant.create({
        data: { phaseId, blockId, tournamentParticipantId },
      });
      if (adminUserId) {
        await tx.adminActionLog.create({
          data: {
            adminUserId,
            action: "PHASE_BLOCK_PARTICIPANT_MOVED",
            targetType: "TournamentPhase",
            targetId: phaseId,
            metadata: { tournamentParticipantId, blockId },
          },
        });
      }
      return moved;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function updateBlock(blockId: string, input: { name?: unknown; advancePlayerCount?: unknown }, adminUserId?: string) {
  const data: { name?: string; advancePlayerCount?: number | null } = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) throw new ApiError(400, "name is required.");
    data.name = input.name.trim();
  }
  if (input.advancePlayerCount !== undefined) {
    if (input.advancePlayerCount === null || input.advancePlayerCount === "") {
      data.advancePlayerCount = null;
    } else {
      const value = Number(input.advancePlayerCount);
      if (!Number.isInteger(value) || value < 0 || value > 256) throw new ApiError(400, "advancePlayerCount must be an integer between 0 and 256.");
      data.advancePlayerCount = value;
    }
  }

  return prisma.$transaction(async (tx) => {
    const block = await tx.tournamentBlock.findUnique({ where: { id: blockId }, include: { phase: true } });
    if (!block) throw new ApiError(404, "Block not found.");
    if (block.phase.status !== "PENDING") throw new ApiError(400, "Blocks can be edited only while phase is PENDING.");
    const updated = await tx.tournamentBlock.update({ where: { id: blockId }, data });
    if (adminUserId) {
      await tx.adminActionLog.create({
        data: {
          adminUserId,
          action: "PHASE_BLOCK_UPDATED",
          targetType: "TournamentBlock",
          targetId: blockId,
          metadata: {
            before: { name: block.name, advancePlayerCount: block.advancePlayerCount },
            after: { name: updated.name, advancePlayerCount: updated.advancePlayerCount },
          },
        },
      });
    }
    return updated;
  });
}
