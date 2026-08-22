import { Prisma } from "@prisma/client";

import { MATCHMAKING_CONFIG } from "@/lib/matchmaking/config";
import { calculateMatchingRating } from "@/lib/matchmaking/rating";
import type { MatchmakingPlayer, WaitingPlayer } from "@/lib/matchmaking/types";

function waitingMinutes(joinedAt: Date, now: Date) {
  return Math.max(0, (now.getTime() - joinedAt.getTime()) / 60000);
}

function scoreCandidate(anchor: MatchmakingPlayer, candidate: MatchmakingPlayer, now: Date) {
  const ratingDifference = anchor.matchingRating.sub(candidate.matchingRating).abs().toNumber();
  const anchorWait = waitingMinutes(anchor.joinedAt, now);
  const candidateWait = waitingMinutes(candidate.joinedAt, now);
  const rangeAllowance =
    MATCHMAKING_CONFIG.BASE_RATING_RANGE +
    anchorWait * MATCHMAKING_CONFIG.RANGE_EXPANSION_PER_MINUTE;
  const outsideRangePenalty = Math.max(0, ratingDifference - rangeAllowance);
  const rematchPenalty =
    anchor.recentOpponentIds.has(candidate.userId) || candidate.recentOpponentIds.has(anchor.userId)
      ? MATCHMAKING_CONFIG.REMATCH_PENALTY
      : 0;
  const waitingAdjustment = candidateWait * MATCHMAKING_CONFIG.WAITING_SCORE_REDUCTION_PER_MINUTE;

  return outsideRangePenalty + ratingDifference + rematchPenalty - waitingAdjustment;
}

export function toMatchmakingPlayer(player: WaitingPlayer): MatchmakingPlayer {
  return {
    ...player,
    matchingRating: calculateMatchingRating({
      rating: player.rating,
      losingStreak: player.losingStreak,
      losingStreakPenalty: player.losingStreakPenalty,
    }),
  };
}

export function selectEightPlayers(waitingPlayers: WaitingPlayer[], now = new Date()) {
  if (waitingPlayers.length < 8) {
    return null;
  }

  const players = waitingPlayers.map(toMatchmakingPlayer);
  const anchor = players.reduce((oldest, player) => (player.joinedAt < oldest.joinedAt ? player : oldest));
  const selectedCandidates = players
    .filter((player) => player.userId !== anchor.userId)
    .sort((a, b) => {
      const scoreDiff = scoreCandidate(anchor, a, now) - scoreCandidate(anchor, b, now);
      if (scoreDiff !== 0) return scoreDiff;

      const ratingDiff = anchor.matchingRating.sub(a.matchingRating).abs().cmp(
        anchor.matchingRating.sub(b.matchingRating).abs(),
      );
      if (ratingDiff !== 0) return ratingDiff;

      return a.joinedAt.getTime() - b.joinedAt.getTime();
    })
    .slice(0, 7);

  return [anchor, ...selectedCandidates];
}

export function decimal(value: Prisma.Decimal.Value) {
  return new Prisma.Decimal(value);
}
