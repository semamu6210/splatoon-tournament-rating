"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type TestDummyPanelProps = {
  canDelete: boolean;
  statuses: Array<{
    id: string;
    name: string;
    status: string;
    completedMatches: number;
    requiredMatches: number;
  }>;
  tournamentId: string;
};

export function TestDummyPanel({ canDelete, statuses, tournamentId }: TestDummyPanelProps) {
  const router = useRouter();
  const [count, setCount] = useState(6);
  const [areaXp, setAreaXp] = useState(2500);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function request(url: string, method: "POST" | "DELETE", body?: Record<string, unknown>) {
    if (pending) return;
    setPending(true);
    setMessage(null);
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json().catch(() => null)) as { error?: string; queued?: number; skipped?: number } | null;
    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "操作に失敗しました。");
      return;
    }

    setMessage("完了しました。");
    router.refresh();
  }

  return (
    <section className="rounded-md border border-zinc-300 bg-white p-4">
      <h2 className="text-xl font-semibold">テスト用ダミー参加者</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          人数
          <input
            className="rounded-md border border-zinc-300 px-3 py-2"
            max={30}
            min={1}
            onChange={(event) => setCount(Number(event.target.value))}
            type="number"
            value={count}
          />
        </label>
        <label className="grid gap-1 text-sm">
          XP
          <input
            className="rounded-md border border-zinc-300 px-3 py-2"
            min={0}
            onChange={(event) => setAreaXp(Number(event.target.value))}
            type="number"
            value={areaXp}
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400"
          disabled={pending}
          onClick={() => void request(`/api/admin/tournaments/${tournamentId}/test-dummies`, "POST", { count, areaXp })}
          type="button"
        >
          ダミーを追加
        </button>
        <button
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold disabled:bg-zinc-100"
          disabled={pending}
          onClick={() => void request(`/api/admin/tournaments/${tournamentId}/test-dummies/queue`, "POST")}
          type="button"
        >
          ダミーを全員マッチング待機にする
        </button>
        {canDelete && (
          <button
            className="rounded-md border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 disabled:bg-zinc-100"
            disabled={pending}
            onClick={() => window.confirm("ダミー参加者を削除しますか？") && void request(`/api/admin/tournaments/${tournamentId}/test-dummies`, "DELETE")}
            type="button"
          >
            ダミーを削除
          </button>
        )}
      </div>
      {statuses.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-80 text-left text-sm">
            <thead className="bg-zinc-100 text-zinc-600">
              <tr>
                <th className="px-3 py-2">ダミー</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2">試合数</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((status) => (
                <tr className="border-t border-zinc-200" key={status.id}>
                  <td className="px-3 py-2">{status.name}</td>
                  <td className="px-3 py-2">{status.status}</td>
                  <td className="px-3 py-2">
                    {status.completedMatches}/{status.requiredMatches}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {message && <p className="mt-3 text-sm text-zinc-700">{message}</p>}
    </section>
  );
}
