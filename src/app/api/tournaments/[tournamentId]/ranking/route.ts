import { fail, ok } from "@/lib/http";
import { auth } from "@/auth";
import { canManage } from "@/lib/permissions";
import { filterTournamentRankingsForViewer, getTournamentRankings } from "@/lib/ranking-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const { tournamentId } = await context.params;
    const session = await auth();
    const ranking = await filterTournamentRankingsForViewer({
      tournamentId,
      rankings: await getTournamentRankings(tournamentId),
      viewerUserId: session?.user?.id,
      isAdmin: session?.user ? canManage(session.user.role) : false,
    });
    return ok(ranking);
  } catch (error) {
    return fail(error);
  }
}
