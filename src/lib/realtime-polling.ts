export type MatchStatusLiteSnapshot = {
  ratingAppliedAt: string | null;
  status: string;
  submittedVoterCount: number;
  winnerTeam: "A" | "B" | null;
};

export function queueFallbackIntervalMs(realtimeReady: boolean) {
  return realtimeReady ? 30_000 : 8_000;
}

export function matchFallbackIntervalMs(status: string, realtimeReady: boolean) {
  if (realtimeReady) return 30_000;
  return status === "PLAYING" ? 10_000 : 8_000;
}

export function isTerminalQueueStatus(status: string) {
  return status === "MATCHED";
}

export function isTerminalMatchStatus(status: string) {
  return status === "CONFIRMED" || status === "CANCELLED";
}

export function matchStatusChanged(previous: MatchStatusLiteSnapshot, next: MatchStatusLiteSnapshot) {
  return (
    previous.status !== next.status ||
    previous.winnerTeam !== next.winnerTeam ||
    previous.submittedVoterCount !== next.submittedVoterCount ||
    previous.ratingAppliedAt !== next.ratingAppliedAt
  );
}
