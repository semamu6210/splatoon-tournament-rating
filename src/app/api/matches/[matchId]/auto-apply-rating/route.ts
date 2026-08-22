import { requireUser } from "@/lib/authz";
import { ApiError, fail, ok } from "@/lib/http";
import { attemptAutoApplyRatingForMatch } from "@/lib/match-flow/service";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ matchId: string }> };

export async function POST(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { matchId } = await context.params;
    const match = await prisma.match.findUnique({
      where: { id: matchId },
      include: { players: { select: { userId: true } } },
    });

    if (!match) throw new ApiError(404, "Match not found.");
    const canAccess = canManage(user.role) || match.players.some((player) => player.userId === user.id);
    if (!canAccess) throw new ApiError(403, "You cannot access this match.");

    const result = await attemptAutoApplyRatingForMatch(matchId);
    return ok({ result });
  } catch (error) {
    return fail(error);
  }
}
