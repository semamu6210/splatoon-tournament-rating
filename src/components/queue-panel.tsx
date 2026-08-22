"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { isTerminalQueueStatus, queueFallbackIntervalMs } from "@/lib/realtime-polling";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type QueueStatus =
  | { status: "NOT_QUEUED" }
  | { status: "WAITING"; joinedAt: string; waitingSeconds: number }
  | { status: "MATCHED"; matchId: string };

type QueuePanelProps = {
  phaseId: string;
  initialStatus: QueueStatus;
  queueEntryId: string | null;
};

export function QueuePanel({ phaseId, initialStatus, queueEntryId }: QueuePanelProps) {
  const router = useRouter();
  const [status, setStatus] = useState<QueueStatus | null>(initialStatus);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const stoppedRef = useRef(isTerminalQueueStatus(initialStatus.status));

  const loadStatus = useCallback(async () => {
    const response = await fetch(`/api/phases/${phaseId}/queue/status-lite`, { cache: "no-store" });
    if (!response.ok) {
      setStatus(null);
      return;
    }
    const liteStatus = (await response.json()) as { status: QueueStatus["status"]; matchId: string | null };
    setStatus((current) => {
      if (liteStatus.status === "WAITING") {
        if (current?.status === "WAITING") {
          return {
            ...current,
            waitingSeconds: Math.floor((Date.now() - new Date(current.joinedAt).getTime()) / 1000),
          };
        }
        return { status: "WAITING", joinedAt: new Date().toISOString(), waitingSeconds: 0 };
      }
      if (liteStatus.status === "MATCHED" && liteStatus.matchId) {
        stoppedRef.current = isTerminalQueueStatus(liteStatus.status);
        return { status: "MATCHED", matchId: liteStatus.matchId };
      }
      stoppedRef.current = false;
      return { status: "NOT_QUEUED" };
    });
  }, [phaseId]);

  useEffect(() => {
    if (status?.status !== "WAITING" || !queueEntryId) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    stoppedRef.current = false;
    const channel = supabase
      .channel(`queue-status:${phaseId}:${queueEntryId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "QueueStatusEvent",
          filter: `queueEntryId=eq.${queueEntryId}`,
        },
        () => {
          if (!stoppedRef.current) void loadStatus();
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
  }, [loadStatus, phaseId, queueEntryId, status?.status]);

  useEffect(() => {
    if (status?.status !== "WAITING") return;
    const intervalMs = queueFallbackIntervalMs(realtimeReady);
    const id = window.setInterval(() => {
      void loadStatus();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [loadStatus, realtimeReady, status?.status]);

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
    if (url.endsWith("/join") || url.endsWith("/leave")) {
      router.refresh();
    }
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
        <div className="grid gap-3 rounded-md border-2 border-emerald-500 bg-emerald-50 p-4">
          <p className="text-2xl font-bold text-emerald-900">マッチングが成立しました</p>
          <p className="text-sm font-semibold text-emerald-800">試合画面を開いて、部屋コードとチームを確認してください。</p>
          {status.matchId ? (
            <Link className="rounded-md bg-zinc-950 px-4 py-2 text-center text-sm font-semibold text-white" href={`/matches/${status.matchId}`}>
              試合へ進む
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
