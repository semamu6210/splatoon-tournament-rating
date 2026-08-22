import { requireUser } from "@/lib/authz";
import { fail, ok, ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { serializeDecimal } from "@/lib/serializers";

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
            user: {
              select: {
                id: true,
                name: true,
                discordUsername: true,
                avatarUrl: true,
              },
            },
          },
          orderBy: [{ team: "asc" }, { userId: "asc" }],
        },
        resultReports: true,
        playerVotes: true,
        ratingHistories: true,
      },
    });

    if (!match) {
      throw new ApiError(404, "Match not found.");
    }

    const isAdmin = user.role === "ADMIN" || user.role === "OWNER";
    const ownPlayer = match.players.find((player) => player.userId === user.id);
    const myHistory = match.ratingHistories.find((history) => history.userId === user.id);

    if (!isAdmin && !ownPlayer) {
      throw new ApiError(403, "You cannot view this match.");
    }
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: match.tournamentId, userId: { in: match.players.map((player) => player.userId) } },
    });
    const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant]));
    const publicPlayer = (player: (typeof match.players)[number]) => {
      const participant = participantByUserId.get(player.userId);
      return {
        userId: player.userId,
        user: player.user,
        participantName: participant?.participantName ?? player.user.discordUsername ?? player.user.name ?? player.userId,
        team: player.team,
        ratingBefore: serializeDecimal(player.ratingBefore),
        areaXpAtMatch: player.areaXpAtMatch,
        winningStreak: participant?.winningStreak ?? 0,
        losingStreak: participant?.losingStreak ?? 0,
        streakBadge:
          participant && participant.winningStreak >= 3
            ? `🔥 ${participant.winningStreak}連勝`
            : participant && participant.losingStreak >= 3
              ? `▼ ${participant.losingStreak}連敗`
              : null,
        matchingRatingAtMatch: isAdmin ? serializeDecimal(player.matchingRatingAtMatch) : undefined,
        losingStreakAtMatch: isAdmin ? player.losingStreakAtMatch : undefined,
      };
    };

    return ok({
      match: {
        id: match.id,
        tournamentId: match.tournamentId,
        phaseId: match.phaseId,
        status: match.status,
        matchNumber: match.matchNumber,
        rule: match.rule,
        stageName: match.stageName,
        winnerTeam: match.winnerTeam,
        ratingConfigVersion: isAdmin ? match.ratingConfigVersion : undefined,
        myTeam: ownPlayer?.team ?? null,
        ratingAppliedAt: match.ratingAppliedAt?.toISOString() ?? null,
        myRatingHistory: myHistory
          ? {
              ...myHistory,
              createdAt: myHistory.createdAt.toISOString(),
              ratingBefore: serializeDecimal(myHistory.ratingBefore),
              strongVotePointsUsed: serializeDecimal(myHistory.strongVotePointsUsed),
              weakVotePointsUsed: serializeDecimal(myHistory.weakVotePointsUsed),
              winBonusUsed: serializeDecimal(myHistory.winBonusUsed),
              votePoints: serializeDecimal(myHistory.votePoints),
              baseDelta: serializeDecimal(myHistory.baseDelta),
              xpMultiplierUsed: serializeDecimal(myHistory.xpMultiplierUsed),
              finalDelta: serializeDecimal(myHistory.finalDelta),
              ratingAfter: serializeDecimal(myHistory.ratingAfter),
            }
          : null,
        admin: isAdmin
          ? {
              resultReports: match.resultReports,
              voteSubmittedUserIds: [...new Set(match.playerVotes.map((vote) => vote.voterUserId))],
            }
          : undefined,
        teamA: match.players
          .filter((player) => player.team === "A")
          .map(publicPlayer),
        teamB: match.players
          .filter((player) => player.team === "B")
          .map(publicPlayer),
      },
    });
  } catch (error) {
    return fail(error);
  }
}
