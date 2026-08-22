import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function createTournamentStages(tournamentId: string, names: unknown) {
  if (!Array.isArray(names) || names.length === 0) throw new ApiError(400, "names must be a non-empty array.");
  const normalized = names.map((name) => (typeof name === "string" ? name.trim() : "")).filter(Boolean);
  if (normalized.length === 0) throw new ApiError(400, "At least one stage name is required.");
  if (normalized.length !== new Set(normalized).size) throw new ApiError(400, "Stage names must be unique.");

  return prisma.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({ where: { id: tournamentId } });
    if (!tournament) throw new ApiError(404, "Tournament not found.");
    await tx.tournamentStage.createMany({
      data: normalized.map((name, index) => ({ tournamentId, name, sortOrder: index + 1 })),
      skipDuplicates: true,
    });
    return tx.tournamentStage.findMany({ where: { tournamentId }, orderBy: { sortOrder: "asc" } });
  });
}
