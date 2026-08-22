import { requireAdmin } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { serializeTournament } from "@/lib/serializers";
import { finishTournament } from "@/lib/phase-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { tournamentId } = await context.params;
    const tournament = await finishTournament(user.id, tournamentId);

    return ok({ tournament: serializeTournament(tournament) });
  } catch (error) {
    return fail(error);
  }
}
