"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

type MatchStatusRefreshProps = {
  enabled: boolean;
};

export function MatchStatusRefresh({ enabled }: MatchStatusRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const intervalId = window.setInterval(() => {
      router.refresh();
    }, 10000);

    return () => window.clearInterval(intervalId);
  }, [enabled, router]);

  return null;
}
