import { ApiError } from "@/lib/http";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { serializeDecimal } from "@/lib/serializers";
import { stageImagePath } from "@/lib/stages";
import type { AuthenticatedUser } from "@/lib/authz";

export async function getMatchViewForUser(matchId: string, user: AuthenticatedUser) {
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
      tournament: { select: { name: true } },
      phase: { select: { phaseType: true } },
      stage: true,
      roomHost: {
        select: {
          id: true,
          name: true,
          discordUsername: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!match) throw new ApiError(404, "Match not found.");

  const isAdmin = canManage(user.role);
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
      participantName: participant?.participantName ?? player.user.discordUsername ?? player.user.name ?? player.userId,
      isDummy: participant?.isDummy ?? false,
      team: player.team,
      avatarUrl: player.user.avatarUrl,
      user: { id: player.user.id, avatarUrl: player.user.avatarUrl },
      ratingBefore: serializeDecimal(player.ratingBefore),
      areaXpAtMatch: player.areaXpAtMatch,
      wins: participant?.wins ?? 0,
      losses: participant?.losses ?? 0,
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

  return {
    match: {
      id: match.id,
      tournamentId: match.tournamentId,
      tournamentName: match.tournament.name,
      phaseId: match.phaseId,
      phaseType: match.phase.phaseType,
      status: match.status,
      matchNumber: match.matchNumber,
      rule: match.rule,
      stage: match.stage
        ? {
            id: match.stage.id,
            name: match.stage.name,
            imagePath: stageImagePath(match.stage.name),
          }
        : null,
      stageName: match.stageName,
      stageImage: stageImagePath(match.stageName),
      privateRoomCode: match.privateRoomCode,
      roomHost: match.roomHost
        ? {
            id: match.roomHost.id,
            participantName:
              participantByUserId.get(match.roomHost.id)?.participantName ??
              match.roomHost.name ??
              match.roomHost.id,
            avatarUrl: match.roomHost.avatarUrl,
          }
        : null,
      isRoomHost: match.roomHostUserId === user.id,
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
            winningStreakBefore: myHistory.winningStreakBefore,
            winningStreakAfter: myHistory.winningStreakAfter,
            winningStreakBonusApplied: myHistory.winningStreakBonusApplied,
            winningStreakBonusMultiplierUsed: serializeDecimal(myHistory.winningStreakBonusMultiplierUsed),
            totalVotesReceived: myHistory.totalVotesReceived,
            voteCountBonusApplied: myHistory.voteCountBonusApplied,
            voteCountBonusMultiplierUsed: serializeDecimal(myHistory.voteCountBonusMultiplierUsed),
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
  };
}
