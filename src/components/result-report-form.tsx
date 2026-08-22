"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ResultReportFormProps = { matchId: string };

export function ResultReportForm({ matchId }: ResultReportFormProps) {
  const router = useRouter();
  const [winner, setWinner] = useState<"A" | "B">("A");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    if (pending) return;
    setPending(true);
    setMessage(null);

    const response = await fetch(`/api/matches/${matchId}/result-reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportedWinnerTeam: winner }),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "勝敗報告に失敗しました。");
      return;
    }
    setMessage("勝敗を報告しました。変更はできません。");
    router.refresh();
  }

  return (
    <div className="grid gap-3 rounded-md border border-zinc-300 bg-white p-4">
      <h2 className="text-lg font-semibold">勝敗報告</h2>
      <select className="rounded-md border border-zinc-300 px-3 py-2" onChange={(e) => setWinner(e.target.value as "A" | "B")} value={winner}>
        <option value="A">Team A 勝利</option>
        <option value="B">Team B 勝利</option>
      </select>
      <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400" disabled={pending} onClick={() => void submit()} type="button">
        {pending ? "送信中..." : "報告する"}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </div>
  );
}
