"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type TournamentDeleteButtonProps = {
  tournamentId: string;
  tournamentName: string;
};

export function TournamentDeleteButton({ tournamentId, tournamentName }: TournamentDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const confirmed = confirmationName === tournamentName;

  async function deleteTournament() {
    if (!confirmed || pending) return;
    setPending(true);
    setMessage(null);
    const response = await fetch(`/api/tournaments/${tournamentId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: confirmationName }),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "大会削除に失敗しました。");
      return;
    }

    router.push("/tournaments?deleted=1");
    router.refresh();
  }

  return (
    <div className="grid gap-3 rounded-md border border-red-300 bg-red-50 p-4">
      <div>
        <h2 className="text-xl font-semibold text-red-900">大会削除</h2>
        <p className="mt-2 text-sm text-red-800">進行中・終了済み大会も削除できますが、削除後は元に戻せません。</p>
      </div>
      {!open ? (
        <button className="w-fit rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => setOpen(true)} type="button">
          大会を削除
        </button>
      ) : (
        <div className="grid gap-3 rounded-md border border-red-300 bg-white p-4">
          <div className="grid gap-2 text-sm text-zinc-800">
            <p className="text-lg font-bold text-red-900">この大会を削除しますか？</p>
            <p>大会、試合、投票、ランキングなど、この大会に関連するデータが削除されます。この操作は元に戻せません。</p>
          </div>
          <label className="grid gap-1 text-sm">
            最終確認のため大会名を入力してください
            <input
              className="rounded-md border border-zinc-300 px-3 py-2"
              onChange={(event) => setConfirmationName(event.target.value)}
              value={confirmationName}
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400"
              disabled={!confirmed || pending}
              onClick={() => void deleteTournament()}
              type="button"
            >
              {pending ? "削除中..." : "完全に削除する"}
            </button>
            <button
              className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-semibold"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setConfirmationName("");
                setMessage(null);
              }}
              type="button"
            >
              キャンセル
            </button>
          </div>
          {message && <p className="text-sm text-red-700">{message}</p>}
        </div>
      )}
    </div>
  );
}
