import { requireUser } from "@/lib/authz";
import { fail, ok } from "@/lib/http";
import { serializeParticipant } from "@/lib/serializers";
import { leaveTournament } from "@/lib/tournament-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { tournamentId } = await context.params;
    const participant = await leaveTournament(user.id, tournamentId);

    return ok({ participant: serializeParticipant(participant) });
  } catch (error) {
    return fail(error);
  }
}
