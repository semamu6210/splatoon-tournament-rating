import { requireUser } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { serializeParticipant } from "@/lib/serializers";
import { joinTournament } from "@/lib/tournament-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { tournamentId } = await context.params;
    const body = await readJson<{ areaXp: unknown }>(request);
    const participant = await joinTournament(user.id, tournamentId, body);

    return ok({ participant: serializeParticipant(participant) }, 201);
  } catch (error) {
    return fail(error);
  }
}
