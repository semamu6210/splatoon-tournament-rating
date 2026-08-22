import { prisma } from "@/lib/prisma";

const LONG_WAITING_MINUTES = 20;
const LONG_PLAYING_MINUTES = 60;

export async function getTournamentOperationWarnings(tournamentId: string) {
  const now = Date.now();
  const warnings: Array<{ type: string; message: string; targetId: string }> = [];

  const waiting = await prisma.queueEntry.findMany({
    where: { tournamentId, status: "WAITING" },
  });
  for (const entry of waiting) {
    if (now - entry.joinedAt.getTime() > LONG_WAITING_MINUTES * 60 * 1000) {
      warnings.push({ type: "LONG_WAITING", message: "WAITINGのまま長時間経過", targetId: entry.id });
    }
  }

  const matches = await prisma.match.findMany({
    where: { tournamentId },
    include: { players: true, playerVotes: true, resultReports: true, ratingHistories: true },
  });
  for (const match of matches) {
    if (match.status === "PLAYING" && now - match.createdAt.getTime() > LONG_PLAYING_MINUTES * 60 * 1000) {
      warnings.push({ type: "LONG_PLAYING", message: "PLAYINGのまま長時間経過", targetId: match.id });
    }
    if (match.status === "RESULT_REPORTING" && match.resultReports.length < 8) {
      warnings.push({ type: "RESULT_REPORTING_INCOMPLETE", message: "RESULT_REPORTINGで報告不足", targetId: match.id });
    }
    if (match.status === "VOTE_REPORTING") {
      const completedVotes = new Set(
        match.players
          .filter((player) => {
            const votes = match.playerVotes.filter((vote) => vote.voterUserId === player.userId);
            return votes.some((vote) => vote.voteType === "STRONG") && votes.some((vote) => vote.voteType === "WEAK");
          })
          .map((player) => player.userId),
      );
      if (completedVotes.size < match.players.length) {
        warnings.push({ type: "VOTE_REPORTING_INCOMPLETE", message: "VOTE_REPORTINGで未投票あり", targetId: match.id });
      }
    }
    if (match.players.length !== 8) {
      warnings.push({ type: "INVALID_PLAYER_COUNT", message: "MatchPlayerが8人ではありません", targetId: match.id });
    }
    if (match.players.filter((player) => player.team === "A").length !== 4 || match.players.filter((player) => player.team === "B").length !== 4) {
      warnings.push({ type: "INVALID_TEAM_SIZE", message: "Teamが4v4ではありません", targetId: match.id });
    }
    if (match.ratingAppliedAt && match.status !== "CONFIRMED") {
      warnings.push({ type: "APPLIED_BUT_NOT_CONFIRMED", message: "ratingAppliedAtがあるのにCONFIRMEDではありません", targetId: match.id });
    }
    if (match.status === "CONFIRMED" && match.ratingHistories.length !== 8) {
      warnings.push({ type: "MISSING_RATING_HISTORY", message: "CONFIRMEDなのにRatingHistoryが8件ありません", targetId: match.id });
    }
  }

  return warnings;
}
