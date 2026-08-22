"use client";

import { useEffect, useState } from "react";

import { ApiButton } from "@/components/api-button";

type MatchPlayingActionsProps = {
  hostLabel: string;
  isRoomHost: boolean;
  matchId: string;
  startedAt: string | null;
};

export function MatchPlayingActions({ hostLabel, isRoomHost, matchId, startedAt }: MatchPlayingActionsProps) {
  const [remainingSeconds, setRemainingSeconds] = useState(60);

  useEffect(() => {
    function updateRemaining() {
      const startedMs = startedAt ? new Date(startedAt).getTime() : Date.now();
      setRemainingSeconds(Math.max(60 - Math.floor((Date.now() - startedMs) / 1000), 0));
    }

    updateRemaining();
    const intervalId = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(intervalId);
  }, [startedAt]);

  const canOpenResultReporting = remainingSeconds === 0;

  return (
    <>
      {!canOpenResultReporting ? (
        <div className="grid gap-1 text-sm text-zinc-600">
          <p>結果報告は試合開始1分後から可能です。</p>
          <p>結果報告まで {remainingSeconds}秒</p>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">Splatoonでの試合が終わったら、部屋主が試合終了を押してください。</p>
      )}
      {isRoomHost && canOpenResultReporting && (
        <ApiButton url={`/api/matches/${matchId}/open-result-reporting`}>
          試合終了
        </ApiButton>
      )}
      {!isRoomHost && <p className="text-sm text-zinc-600">部屋主の{hostLabel}さんが試合終了操作を行います。</p>}
    </>
  );
}
