"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { weaponGroupLabel } from "@/lib/labels";

type JoinFormProps = {
  tournamentId: string;
  initialParticipantName?: string;
};

export function JoinForm({ tournamentId, initialParticipantName = "" }: JoinFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const areaXp = Number(form.get("areaXp"));
    const participantName = String(form.get("participantName") ?? "");
    const weaponGroup = String(form.get("weaponGroup") ?? "");

    const response = await fetch(`/api/tournaments/${tournamentId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ areaXp, participantName, weaponGroup }),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;

    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "参加登録に失敗しました。");
      return;
    }

    setMessage("参加登録しました。");
    router.refresh();
  }

  return (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <label className="grid gap-1 text-sm">
        参加名
        <input
          className="rounded-md border border-zinc-300 px-3 py-2"
          defaultValue={initialParticipantName}
          maxLength={20}
          name="participantName"
          required
          type="text"
        />
      </label>
      <label className="grid gap-1 text-sm">
        エリアXP
        <input
          className="rounded-md border border-zinc-300 px-3 py-2"
          min={0}
          name="areaXp"
          required
          step={1}
          type="number"
        />
      </label>
      <label className="grid gap-1 text-sm">
        役割グループ
        <select className="rounded-md border border-zinc-300 px-3 py-2" defaultValue="" name="weaponGroup" required>
          <option disabled value="">
            選択してください
          </option>
          <option value="FRONT">{weaponGroupLabel.FRONT}</option>
          <option value="MID">{weaponGroupLabel.MID}</option>
          <option value="BACK">{weaponGroupLabel.BACK}</option>
        </select>
        <span className="text-xs text-zinc-600">塗り・キル・後衛の近い役割同士でマッチングします</span>
      </label>
      <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400" disabled={pending}>
        {pending ? "登録中..." : "参加登録"}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </form>
  );
}
