import { ApiError } from "@/lib/http";
import { getQueueStatusLite as getQueueStatusLiteFromMatchmaking } from "@/lib/matchmaking/service";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/lib/authz";

export async function getQueueStatusLite(userId: string, phaseId: string) {
  return getQueueStatusLiteFromMatchmaking(userId, phaseId);
}

export async function getMatchStatusLite(matchId: string, user: AuthenticatedUser) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      status: true,
      winnerTeam: true,
      ratingAppliedAt: true,
      players: { select: { userId: true } },
    },
  });

  if (!match) throw new ApiError(404, "Match not found.");
  if (!canManage(user.role) && !match.players.some((player) => player.userId === user.id)) {
    throw new ApiError(403, "You cannot view this match.");
  }

  const completeVoters = await prisma.playerVote.groupBy({
    by: ["voterUserId"],
    where: { matchId },
    _count: { voteType: true },
  });

  return {
    status: match.status,
    winnerTeam: match.winnerTeam,
    submittedVoterCount: completeVoters.filter((row) => row._count.voteType >= 2).length,
    ratingAppliedAt: match.ratingAppliedAt?.toISOString() ?? null,
  };
}
