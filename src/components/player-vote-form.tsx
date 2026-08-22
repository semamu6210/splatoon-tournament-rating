"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Opponent = { userId: string; label: string };
type PlayerVoteFormProps = { matchId: string; opponents: Opponent[] };

export function PlayerVoteForm({ matchId, opponents }: PlayerVoteFormProps) {
  const router = useRouter();
  const [strong, setStrong] = useState("");
  const [weak, setWeak] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  function setStrongSafe(userId: string) {
    setStrong(userId);
    setConfirming(false);
    if (weak === userId) setWeak("");
  }

  function setWeakSafe(userId: string) {
    setWeak(userId);
    setConfirming(false);
    if (strong === userId) setStrong("");
  }

  async function submit() {
    if (!strong || !weak || strong === weak || pending) return;
    setPending(true);
    setMessage(null);

    const response = await fetch(`/api/matches/${matchId}/player-votes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        votes: [
          { targetUserId: strong, voteType: "STRONG" },
          { targetUserId: weak, voteType: "WEAK" },
        ],
      }),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "投票に失敗しました。");
      return;
    }
    setMessage("投票しました。送信後の変更はできません。");
    router.refresh();
  }

  return (
    <div className="grid gap-4 rounded-md border border-zinc-300 bg-white p-4">
      <h2 className="text-lg font-semibold">選手評価投票</h2>
      <div className="grid gap-3">
        {opponents.map((opponent) => (
          <div className="rounded-md border border-zinc-200 p-3" key={opponent.userId}>
            <p className="font-semibold">{opponent.label}</p>
            <div className="mt-2 flex gap-2">
              <button
                className={strong === opponent.userId ? "rounded-md bg-emerald-700 px-3 py-2 text-sm text-white" : "rounded-md border border-zinc-300 px-3 py-2 text-sm"}
                onClick={() => setStrongSafe(opponent.userId)}
                type="button"
              >
                強い票
              </button>
              <button
                className={weak === opponent.userId ? "rounded-md bg-amber-700 px-3 py-2 text-sm text-white" : "rounded-md border border-zinc-300 px-3 py-2 text-sm"}
                onClick={() => setWeakSafe(opponent.userId)}
                type="button"
              >
                弱い票
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-md bg-zinc-50 p-3 text-sm">
        <p>強い票: {opponents.find((opponent) => opponent.userId === strong)?.label ?? "未選択"}</p>
        <p>弱い票: {opponents.find((opponent) => opponent.userId === weak)?.label ?? "未選択"}</p>
      </div>
      {!confirming ? (
        <button
          className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400"
          disabled={!strong || !weak || strong === weak}
          onClick={() => setConfirming(true)}
          type="button"
        >
          投票内容を確認
        </button>
      ) : (
        <div className="grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <div>
            <p className="font-semibold">強い票:</p>
            <p>{opponents.find((opponent) => opponent.userId === strong)?.label}</p>
          </div>
          <div>
            <p className="font-semibold">弱い票:</p>
            <p>{opponents.find((opponent) => opponent.userId === weak)?.label}</p>
          </div>
          <p className="font-semibold text-amber-900">送信後は変更できません</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400"
              disabled={pending}
              onClick={() => void submit()}
              type="button"
            >
              {pending ? "送信中..." : "この内容で送信"}
            </button>
            <button className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold" onClick={() => setConfirming(false)} type="button">
              選び直す
            </button>
          </div>
        </div>
      )}
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </div>
  );
}
