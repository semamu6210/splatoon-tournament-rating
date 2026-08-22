"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AdminMatchActionsProps = {
  matchId: string;
  stages?: Array<{ id: string; name: string }>;
  currentStageId?: string | null;
  isTestTournament?: boolean;
};

export function AdminMatchActions({ matchId, stages = [], currentStageId = null, isTestTournament = false }: AdminMatchActionsProps) {
  const router = useRouter();
  const [winner, setWinner] = useState<"A" | "B">("A");
  const [stageId, setStageId] = useState(currentStageId ?? "");
  const [reason, setReason] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function post(url: string, body?: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setMessage(json?.error ?? "操作に失敗しました。");
      return;
    }
    setMessage("完了しました。");
    router.refresh();
  }

  async function patch(url: string, body: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setMessage(json?.error ?? "操作に失敗しました。");
      return;
    }
    setMessage("保存しました。");
    router.refresh();
  }

  return (
    <div className="grid gap-3 rounded-md border border-zinc-300 bg-white p-4">
      <h2 className="text-lg font-semibold">ADMIN操作</h2>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm" onClick={() => void post(`/api/matches/${matchId}/start`)} type="button">
          試合開始
        </button>
        <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm" onClick={() => void post(`/api/matches/${matchId}/open-result-reporting`)} type="button">
          試合終了（トラブル時）
        </button>
        <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm" onClick={() => void post(`/api/matches/${matchId}/apply-rating`)} type="button">
          手動レート確定（トラブル時）
        </button>
      </div>
      <div className="grid gap-2 border-t border-zinc-200 pt-3">
        <label className="grid gap-1 text-sm">
          使用ステージ
          <select className="rounded-md border border-zinc-300 px-3 py-2" onChange={(e) => setStageId(e.target.value)} value={stageId}>
            <option value="">未設定</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold" disabled={!stageId} onClick={() => void patch(`/api/admin/matches/${matchId}/stage`, { stageId })} type="button">
          ステージを保存
        </button>
      </div>
      <div className="grid gap-2">
        <select className="rounded-md border border-zinc-300 px-3 py-2" onChange={(e) => setWinner(e.target.value as "A" | "B")} value={winner}>
          <option value="A">チームA 勝利</option>
          <option value="B">チームB 勝利</option>
        </select>
        <input className="rounded-md border border-zinc-300 px-3 py-2" onChange={(e) => setReason(e.target.value)} placeholder="強制確定理由" value={reason} />
        <button className="rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white" onClick={() => window.confirm("勝敗を強制確定しますか？") && void post(`/api/admin/matches/${matchId}/force-result`, { winnerTeam: winner, reason })} type="button">
          勝敗を強制確定
        </button>
      </div>
      <div className="grid gap-2 border-t border-zinc-200 pt-3">
        <input className="rounded-md border border-zinc-300 px-3 py-2" onChange={(e) => setCloseReason(e.target.value)} placeholder="投票締切理由" value={closeReason} />
        <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold" onClick={() => window.confirm("投票受付を締め切りますか？") && void post(`/api/admin/matches/${matchId}/close-voting`, { reason: closeReason })} type="button">
          投票受付を締め切る
        </button>
      </div>
      <div className="grid gap-2 border-t border-zinc-200 pt-3">
        <input className="rounded-md border border-zinc-300 px-3 py-2" onChange={(e) => setCancelReason(e.target.value)} placeholder="キャンセル理由" value={cancelReason} />
        <button className="rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700" onClick={() => window.confirm("Matchをキャンセルしますか？参加者はQueueへ自動復帰しません。") && void post(`/api/admin/matches/${matchId}/cancel`, { reason: cancelReason })} type="button">
          Matchキャンセル
        </button>
      </div>
      {isTestTournament && (
        <div className="grid gap-2 border-t border-zinc-200 pt-3">
          <button className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold" onClick={() => void post(`/api/admin/matches/${matchId}/test-dummy-votes`)} type="button">
            ダミーの投票を自動提出
          </button>
          <button className="rounded-md bg-amber-600 px-3 py-2 text-sm font-semibold text-white" onClick={() => window.confirm("この試合をテスト用に完全自動進行しますか？") && void post(`/api/admin/matches/${matchId}/fully-automate-test`)} type="button">
            この試合を完全自動進行
          </button>
        </div>
      )}
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </div>
  );
}
