"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type QueueStatus =
  | { status: "NOT_QUEUED" }
  | { status: "WAITING"; joinedAt: string; waitingSeconds: number }
  | { status: "MATCHED"; matchId: string | null };

type QueuePanelProps = {
  phaseId: string;
  initialStatus: QueueStatus;
};

export function QueuePanel({ phaseId, initialStatus }: QueuePanelProps) {
  const router = useRouter();
  const [status, setStatus] = useState<QueueStatus | null>(initialStatus);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const loadStatus = useCallback(async () => {
    const response = await fetch(`/api/phases/${phaseId}/queue/status`);
    if (!response.ok) {
      setStatus(null);
      return;
    }
    setStatus((await response.json()) as QueueStatus);
  }, [phaseId]);

  useEffect(() => {
    if (status?.status !== "WAITING") return;
    const id = window.setInterval(() => {
      void loadStatus();
    }, 5000);
    return () => window.clearInterval(id);
  }, [loadStatus, status?.status]);

  async function post(url: string) {
    setPending(true);
    setMessage(null);
    const response = await fetch(url, { method: "POST" });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "操作に失敗しました。");
      return;
    }

    await loadStatus();
    router.refresh();
  }

  return (
    <div className="grid gap-3 rounded-md border border-zinc-300 bg-white p-4">
      <h2 className="text-lg font-semibold">マッチング待機</h2>
      {!status && <p className="text-sm text-zinc-600">状態を確認中です。</p>}
      {status?.status === "NOT_QUEUED" && (
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400"
          disabled={pending}
          onClick={() => void post(`/api/phases/${phaseId}/queue/join`)}
          type="button"
        >
          待機開始
        </button>
      )}
      {status?.status === "WAITING" && (
        <div className="grid gap-2">
          <p className="text-sm text-zinc-700">マッチング待機中</p>
          <p className="text-sm text-zinc-600">開始: {new Date(status.joinedAt).toLocaleString("ja-JP")}</p>
          <p className="text-sm text-zinc-600">待機秒数: {status.waitingSeconds}</p>
          <button
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:bg-zinc-100"
            disabled={pending}
            onClick={() => void post(`/api/phases/${phaseId}/queue/leave`)}
            type="button"
          >
            待機解除
          </button>
        </div>
      )}
      {status?.status === "MATCHED" && (
        <div className="grid gap-2 rounded-md border border-emerald-400 bg-emerald-50 p-3">
          <p className="text-lg font-bold text-emerald-800">マッチング成立</p>
          <p className="text-sm text-emerald-700">通知音は将来ここで再生できる構造です。</p>
          {status.matchId ? (
            <Link className="rounded-md bg-zinc-950 px-4 py-2 text-center text-sm font-semibold text-white" href={`/matches/${status.matchId}`}>
              試合を見る
            </Link>
          ) : (
            <p className="text-sm text-zinc-600">試合IDを確認中です。</p>
          )}
        </div>
      )}
      {message && <p className="text-sm text-red-700">{message}</p>}
    </div>
  );
}
