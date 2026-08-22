import { Prisma } from "@prisma/client";

import { MATCHMAKING_CONFIG } from "@/lib/matchmaking/config";
import { calculateMatchingPower } from "@/lib/matchmaking/rating";
import type { MatchmakingPlayer, WaitingPlayer } from "@/lib/matchmaking/types";

function waitingMinutes(joinedAt: Date, now: Date) {
  return Math.max(0, (now.getTime() - joinedAt.getTime()) / 60000);
}

function scoreCandidate(anchor: MatchmakingPlayer, candidate: MatchmakingPlayer, now: Date) {
  const powerDifference = anchor.matchingPower.sub(candidate.matchingPower).abs().toNumber();
  const anchorWait = waitingMinutes(anchor.joinedAt, now);
  const candidateWait = waitingMinutes(candidate.joinedAt, now);
  const rangeAllowance =
    MATCHMAKING_CONFIG.BASE_RATING_RANGE +
    anchorWait * MATCHMAKING_CONFIG.RANGE_EXPANSION_PER_MINUTE;
  const outsideRangePenalty = Math.max(0, powerDifference - rangeAllowance);
  const rematchPenalty =
    anchor.recentOpponentIds.has(candidate.userId) || candidate.recentOpponentIds.has(anchor.userId)
      ? MATCHMAKING_CONFIG.REMATCH_PENALTY
      : 0;
  const waitingAdjustment = candidateWait * MATCHMAKING_CONFIG.WAITING_SCORE_REDUCTION_PER_MINUTE;

  return outsideRangePenalty + powerDifference - waitingAdjustment + rematchPenalty;
}

export function toMatchmakingPlayer(player: WaitingPlayer): MatchmakingPlayer {
  return {
    ...player,
    matchingPower: calculateMatchingPower({
      areaXp: player.areaXp,
      losingStreak: player.losingStreak,
    }),
  };
}

export function selectEightPlayers(waitingPlayers: WaitingPlayer[], now = new Date()) {
  if (waitingPlayers.length < 8) {
    return null;
  }

  const players = waitingPlayers.map(toMatchmakingPlayer);
  const minCompleted = Math.min(...players.map((player) => player.completedMatchesInPhase));
  const leastPlayedPlayers = players.filter((player) => player.completedMatchesInPhase === minCompleted);
  const anchor = leastPlayedPlayers.reduce((oldest, player) => (player.joinedAt < oldest.joinedAt ? player : oldest));
  const selectedCandidates = players
    .filter((player) => player.userId !== anchor.userId)
    .sort((a, b) => {
      const completedDiff = a.completedMatchesInPhase - b.completedMatchesInPhase;
      if (completedDiff !== 0) return completedDiff;

      const scoreDiff = scoreCandidate(anchor, a, now) - scoreCandidate(anchor, b, now);
      if (scoreDiff !== 0) return scoreDiff;

      const powerDiff = anchor.matchingPower.sub(a.matchingPower).abs().cmp(
        anchor.matchingPower.sub(b.matchingPower).abs(),
      );
      if (powerDiff !== 0) return powerDiff;

      return a.joinedAt.getTime() - b.joinedAt.getTime();
    })
    .slice(0, 7);

  return [anchor, ...selectedCandidates];
}

export function decimal(value: Prisma.Decimal.Value) {
  return new Prisma.Decimal(value);
}
