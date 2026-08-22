import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeTournament } from "@/lib/serializers";
import { createTournament, type TournamentInput } from "@/lib/tournament-service";

export async function GET() {
  try {
    const tournaments = await prisma.tournament.findMany({
      orderBy: [{ createdAt: "desc" }],
    });

    return ok({ tournaments: tournaments.map(serializeTournament) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin();
    const body = await readJson<TournamentInput>(request);
    const tournament = await createTournament(user.id, body);

    return ok({ tournament: serializeTournament(tournament) }, 201);
  } catch (error) {
    return fail(error);
  }
}
