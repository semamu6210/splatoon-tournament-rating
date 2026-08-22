import { fail, ok } from "@/lib/http";
import { auth } from "@/auth";
import { canManage } from "@/lib/permissions";
import { filterTournamentRankingsForViewer, getTournamentRankings } from "@/lib/ranking-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

function publicRow(row: Awaited<ReturnType<typeof getTournamentRankings>>["overall"][number]) {
  return {
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
  };
}

export async function GET(_request: Request, context: Context) {
  try {
    const { tournamentId } = await context.params;
    const session = await auth();
    const isAdmin = session?.user ? canManage(session.user.role) : false;
    const ranking = await filterTournamentRankingsForViewer({
      tournamentId,
      rankings: await getTournamentRankings(tournamentId),
      viewerUserId: session?.user?.id,
      isAdmin,
    });
    if (!isAdmin) {
      return ok({
        overall: ranking.overall.map(publicRow),
        blocks: ranking.blocks.map((block) => ({ ...block, rows: block.rows.map(publicRow) })),
      });
    }
    return ok(ranking);
  } catch (error) {
    return fail(error);
  }
}
