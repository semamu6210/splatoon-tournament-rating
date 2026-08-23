export function isConfirmedMatchComplete(match: { ratingAppliedAt: Date | string | null; status: string } | null | undefined) {
  return match?.status === "CONFIRMED" && match.ratingAppliedAt !== null;
}

export function shouldShowWaitingForOtherBlocks(params: {
  activePhaseExists: boolean;
  activeRoundExists: boolean;
  currentRoundMatch: { ratingAppliedAt: Date | string | null; status: string } | null;
  hasCurrentPhaseRanking: boolean;
  confirmedMatchesInPhase: number;
  requiredMatchesPerPlayer: number;
}) {
  return (
    params.activePhaseExists &&
    params.activeRoundExists &&
    isConfirmedMatchComplete(params.currentRoundMatch) &&
    params.hasCurrentPhaseRanking &&
    params.confirmedMatchesInPhase < params.requiredMatchesPerPlayer
  );
}

export function currentRoundStatusMessage(match: { status: string } | null | undefined, roundNumber: number | null | undefined) {
  if (!match) return null;
  if (match.status === "CREATED") return `第${roundNumber}試合のマッチングが成立しました`;
  if (match.status === "PLAYING") return `第${roundNumber}試合 進行中`;
  if (match.status === "RESULT_REPORTING") return "試合結果を入力中";
  if (match.status === "VOTE_REPORTING") return "投票受付中";
  return null;
}
