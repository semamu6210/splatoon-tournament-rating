import { requireAdmin } from "@/lib/authz";
import { fail, ok, readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import {
  serializeParticipant,
  serializeRatingConfig,
  serializeTournament,
} from "@/lib/serializers";
import { updateTournament, type TournamentInput } from "@/lib/tournament-service";

type Context = {
  params: Promise<{ tournamentId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const { tournamentId } = await context.params;
    const tournament = await prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: {
          where: { isActive: true },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                discordUsername: true,
                avatarUrl: true,
                role: true,
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
        ratingConfigs: {
          where: { isActive: true },
          include: { xpMultiplierTiers: { orderBy: { sortOrder: "asc" } } },
        },
      },
    });

    if (!tournament) {
      return ok({ tournament: null }, 404);
    }

    return ok({
      tournament: serializeTournament(tournament),
      activeRatingConfig: tournament.ratingConfigs[0]
        ? serializeRatingConfig(tournament.ratingConfigs[0])
        : null,
      participants: tournament.participants.map(serializeParticipant),
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireAdmin();
    const { tournamentId } = await context.params;
    const body = await readJson<TournamentInput>(request);
    const tournament = await updateTournament(user.id, tournamentId, body);

    return ok({ tournament: serializeTournament(tournament) });
  } catch (error) {
    return fail(error);
  }
}
