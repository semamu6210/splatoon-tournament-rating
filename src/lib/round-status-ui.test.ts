import { describe, expect, it } from "vitest";

import { currentRoundStatusMessage, shouldShowWaitingForOtherBlocks } from "@/lib/round-status-ui";

describe("round status UI policy", () => {
  it("does not show other-block waiting before the current round match is confirmed with rating applied", () => {
    for (const status of ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING", "CONFIRMED"]) {
      expect(
        shouldShowWaitingForOtherBlocks({
          activePhaseExists: true,
          activeRoundExists: true,
          currentRoundMatch: { status, ratingAppliedAt: null },
          hasCurrentPhaseRanking: true,
          confirmedMatchesInPhase: 0,
          requiredMatchesPerPlayer: 2,
        }),
      ).toBe(false);
    }
  });

  it("shows other-block waiting only after this round match is fully confirmed", () => {
    expect(
      shouldShowWaitingForOtherBlocks({
        activePhaseExists: true,
        activeRoundExists: true,
        currentRoundMatch: { status: "CONFIRMED", ratingAppliedAt: "2026-08-23T00:00:00.000Z" },
        hasCurrentPhaseRanking: true,
        confirmedMatchesInPhase: 1,
        requiredMatchesPerPlayer: 2,
      }),
    ).toBe(true);
  });

  it("shows in-progress messages for non-terminal match states", () => {
    expect(currentRoundStatusMessage({ status: "CREATED" }, 1)).toBe("第1試合のマッチングが成立しました");
    expect(currentRoundStatusMessage({ status: "PLAYING" }, 1)).toBe("第1試合 進行中");
    expect(currentRoundStatusMessage({ status: "RESULT_REPORTING" }, 1)).toBe("試合結果を入力中");
    expect(currentRoundStatusMessage({ status: "VOTE_REPORTING" }, 1)).toBe("投票受付中");
    expect(currentRoundStatusMessage({ status: "CONFIRMED" }, 1)).toBeNull();
  });
});
