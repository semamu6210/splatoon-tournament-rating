"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type AutoRatingApplyTriggerProps = {
  enabled: boolean;
  matchId: string;
};

export function AutoRatingApplyTrigger({ enabled, matchId }: AutoRatingApplyTriggerProps) {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;

    void fetch(`/api/matches/${matchId}/auto-apply-rating`, { method: "POST" }).finally(() => {
      router.refresh();
    });
  }, [enabled, matchId, router]);

  return null;
}
