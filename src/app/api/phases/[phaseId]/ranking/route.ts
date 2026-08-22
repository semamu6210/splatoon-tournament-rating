import { ApiError, fail, ok } from "@/lib/http";
import { auth } from "@/auth";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getPhaseRanking } from "@/lib/ranking-service";

type Context = {
  params: Promise<{ phaseId: string }>;
};

function publicRanking(ranking: NonNullable<Awaited<ReturnType<typeof getPhaseRanking>>>) {
  return {
    phase: ranking.phase,
    rows: ranking.rows.map((row) => ({
      rank: row.rank,
      userId: row.userId,
      tournamentParticipantId: row.tournamentParticipantId,
      participantName: row.participantName,
      avatarUrl: row.avatarUrl,
      rating: row.rating,
      wins: row.wins,
      losses: row.losses,
      matchesPlayed: row.matchesPlayed,
      areaXp: row.areaXp,
      isDummy: row.isDummy,
      winningStreak: row.winningStreak,
      losingStreak: row.losingStreak,
      streakBadge: row.streakBadge,
      finalRank: row.finalRank,
      advancedToMainEvent: row.advancedToMainEvent,
      currentPhase: row.currentPhase,
    })),
  };
}

export async function GET(_request: Request, context: Context) {
  try {
    const { phaseId } = await context.params;
    const session = await auth();
    const ranking = await getPhaseRanking(phaseId);
    if (!ranking) throw new ApiError(404, "Phase not found.");
    const isAdmin = session?.user ? canManage(session.user.role) : false;
    if (isAdmin) return ok(ranking);

    const tournament = await prisma.tournament.findUnique({
      where: { id: ranking.phase.tournamentId },
      select: { rankingVisibility: true },
    });
    if (tournament?.rankingVisibility === "OWN_BLOCK_ONLY") {
      if (!session?.user?.id) return ok({ ...publicRanking(ranking), rows: [] });
      const ownMembership = await prisma.tournamentBlockParticipant.findFirst({
        where: {
          phaseId,
          tournamentParticipant: { userId: session.user.id },
        },
      });
      if (!ownMembership) return ok({ ...publicRanking(ranking), rows: [] });
      const blockParticipantIds = await prisma.tournamentBlockParticipant.findMany({
        where: { blockId: ownMembership.blockId },
        select: { tournamentParticipantId: true },
      });
      const allowed = new Set(blockParticipantIds.map((item) => item.tournamentParticipantId));
      return ok({ ...publicRanking(ranking), rows: publicRanking(ranking).rows.filter((row) => allowed.has(row.tournamentParticipantId)) });
    }
    if (tournament?.rankingVisibility === "OWN_AND_OTHER_BLOCKS") {
      return ok({ ...publicRanking(ranking), rows: [] });
    }
    return ok(publicRanking(ranking));
  } catch (error) {
    return fail(error);
  }
}
