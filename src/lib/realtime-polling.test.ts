import { describe, expect, it } from "vitest";

import {
  isTerminalMatchStatus,
  isTerminalQueueStatus,
  matchFallbackIntervalMs,
  matchStatusChanged,
  queueFallbackIntervalMs,
} from "@/lib/realtime-polling";

describe("realtime polling fallback policy", () => {
  it("uses slow fallback polling while realtime is subscribed", () => {
    expect(queueFallbackIntervalMs(true)).toBe(30_000);
    expect(matchFallbackIntervalMs("VOTE_REPORTING", true)).toBe(30_000);
  });

  it("uses 8-10s fallback polling when realtime is unavailable", () => {
    expect(queueFallbackIntervalMs(false)).toBe(8_000);
    expect(matchFallbackIntervalMs("VOTE_REPORTING", false)).toBe(8_000);
    expect(matchFallbackIntervalMs("RESULT_REPORTING", false)).toBe(8_000);
    expect(matchFallbackIntervalMs("PLAYING", false)).toBe(10_000);
  });

  it("stops queue and match polling at terminal states", () => {
    expect(isTerminalQueueStatus("MATCHED")).toBe(true);
    expect(isTerminalQueueStatus("WAITING")).toBe(false);
    expect(isTerminalMatchStatus("CONFIRMED")).toBe(true);
    expect(isTerminalMatchStatus("CANCELLED")).toBe(true);
    expect(isTerminalMatchStatus("VOTE_REPORTING")).toBe(false);
  });

  it("refreshes match UI when status-lite observable fields change", () => {
    const previous = {
      status: "VOTE_REPORTING",
      winnerTeam: "A" as const,
      submittedVoterCount: 7,
      ratingAppliedAt: null,
    };
    expect(matchStatusChanged(previous, { ...previous, submittedVoterCount: 8 })).toBe(true);
    expect(matchStatusChanged(previous, { ...previous, status: "CONFIRMED", ratingAppliedAt: "2026-08-23T00:00:00.000Z" })).toBe(true);
    expect(matchStatusChanged(previous, { ...previous })).toBe(false);
  });
});
