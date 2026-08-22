"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type MatchmakingRunButtonProps = {
  phaseId: string;
};

export function MatchmakingRunButton({ phaseId }: MatchmakingRunButtonProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function run() {
    setPending(true);
    setMessage(null);
    const response = await fetch(`/api/phases/${phaseId}/matchmaking/run`, { method: "POST" });
    const json = (await response.json().catch(() => null)) as {
      error?: string;
      matched?: boolean;
      reason?: string;
      matchId?: string;
    } | null;
    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "マッチングに失敗しました。");
      return;
    }

    if (json?.matched) {
      setMessage(`試合作成: ${json.matchId}`);
    } else {
      setMessage(json?.reason ?? "マッチング未成立");
    }

    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <button
        className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400"
        disabled={pending}
        onClick={run}
        type="button"
      >
        {pending ? "実行中..." : "マッチング実行"}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </div>
  );
}
