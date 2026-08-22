"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { isTerminalMatchStatus, matchFallbackIntervalMs, matchStatusChanged } from "@/lib/realtime-polling";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type MatchStatusRefreshProps = {
  initialStatus: string;
  matchId: string;
};

type MatchStatusLite = {
  status: string;
  winnerTeam: "A" | "B" | null;
  submittedVoterCount: number;
  ratingAppliedAt: string | null;
};

export function MatchStatusRefresh({ initialStatus, matchId }: MatchStatusRefreshProps) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const previousRef = useRef<MatchStatusLite | null>(null);
  const stoppedRef = useRef(isTerminalMatchStatus(initialStatus));

  const loadStatus = useCallback(async (forceRefreshOnFirstStatus = false) => {
    const response = await fetch(`/api/matches/${matchId}/status-lite`, { cache: "no-store" });
    const next = response.ok ? ((await response.json()) as MatchStatusLite) : null;
    if (!next) return;

    const previous = previousRef.current;
    previousRef.current = next;
    setStatus(next.status);
    stoppedRef.current = isTerminalMatchStatus(next.status);

    if (!previous) {
      if (forceRefreshOnFirstStatus || next.status !== status) router.refresh();
      return;
    }
    if (matchStatusChanged(previous, next)) {
      router.refresh();
    }
  }, [matchId, router, status]);

  useEffect(() => {
    if (isTerminalMatchStatus(status)) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    stoppedRef.current = false;
    const channel = supabase
      .channel(`match-status:${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "MatchStatusEvent",
          filter: `matchId=eq.${matchId}`,
        },
        () => {
          if (!stoppedRef.current) void loadStatus(true);
        },
      )
      .subscribe((subscriptionStatus) => {
        setRealtimeReady(subscriptionStatus === "SUBSCRIBED");
      });

    return () => {
      stoppedRef.current = true;
      setRealtimeReady(false);
      void supabase.removeChannel(channel);
    };
  }, [loadStatus, matchId, status]);

  useEffect(() => {
    if (isTerminalMatchStatus(status)) return;
    const intervalMs = matchFallbackIntervalMs(status, realtimeReady);
    const intervalId = window.setInterval(() => {
      void loadStatus();
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [loadStatus, realtimeReady, status]);

  return null;
}
