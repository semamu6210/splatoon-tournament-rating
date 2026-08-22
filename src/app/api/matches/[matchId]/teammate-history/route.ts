import { requireUser } from "@/lib/authz";
import { ApiError, fail, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type Context = {
  params: Promise<{ matchId: string }>;
};

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { matchId } = await context.params;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: {
        players: {
          include: {
            user: { select: { id: true, name: true, discordUsername: true } },
          },
        },
      },
    });
    if (!match) throw new ApiError(404, "Match not found.");
    const me = match.players.find((player) => player.userId === user.id);
    if (!me) throw new ApiError(403, "Only match players can view teammate history.");

    const teammateIds = match.players
      .filter((player) => player.team === me.team && player.userId !== user.id)
      .map((player) => player.userId);
    const histories = await prisma.matchPlayer.findMany({
      where: {
        userId: { in: teammateIds },
        matchId: { not: matchId },
        match: {
          tournamentId: match.tournamentId,
          status: "CONFIRMED",
        },
      },
      include: {
        user: { select: { id: true, name: true, discordUsername: true } },
        match: { select: { id: true, winnerTeam: true, createdAt: true } },
      },
      orderBy: { match: { createdAt: "desc" } },
      take: teammateIds.length * 5,
    });

    return ok({
      teammates: teammateIds.map((teammateId) => {
        const player = match.players.find((item) => item.userId === teammateId)!;
        return {
          userId: teammateId,
          participantName: player.user.discordUsername ?? player.user.name ?? teammateId,
          recentMatches: histories
            .filter((history) => history.userId === teammateId)
            .slice(0, 5)
            .map((history) => ({
              matchId: history.matchId,
              result: history.match.winnerTeam === history.team ? "WIN" : "LOSS",
              playedAt: history.match.createdAt.toISOString(),
              ratingDelta:
                history.ratingAfter && history.ratingBefore
                  ? history.ratingAfter.sub(history.ratingBefore).toFixed(2)
                  : null,
            })),
        };
      }),
    });
  } catch (error) {
    return fail(error);
  }
}
