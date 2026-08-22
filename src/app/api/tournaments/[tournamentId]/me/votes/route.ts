import { requireUser } from "@/lib/authz";
import { ApiError, fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { tournamentId } = await context.params;
    const participant = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId: user.id } },
    });
    if (!participant?.isActive) throw new ApiError(404, "Active participation not found.");

    const activePhase = await prisma.tournamentPhase.findFirst({
      where: { tournamentId, status: "ACTIVE" },
      orderBy: { sortOrder: "asc" },
    });
    const tournamentVotes = await prisma.playerVote.groupBy({
      by: ["voteType"],
      where: {
        targetUserId: user.id,
        match: { tournamentId },
      },
      _count: { voteType: true },
    });
    const phaseVotes = activePhase
      ? await prisma.playerVote.groupBy({
          by: ["voteType"],
          where: {
            targetUserId: user.id,
            match: { tournamentId, phaseId: activePhase.id },
          },
          _count: { voteType: true },
        })
      : [];

    const count = (rows: typeof tournamentVotes, voteType: "STRONG" | "WEAK") =>
      rows.find((row) => row.voteType === voteType)?._count.voteType ?? 0;

    return ok({
      tournamentStrongVotes: count(tournamentVotes, "STRONG"),
      tournamentWeakVotes: count(tournamentVotes, "WEAK"),
      currentPhaseStrongVotes: count(phaseVotes, "STRONG"),
      currentPhaseWeakVotes: count(phaseVotes, "WEAK"),
      currentPhaseId: activePhase?.id ?? null,
    });
  } catch (error) {
    return fail(error);
  }
}
