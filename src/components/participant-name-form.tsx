"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ParticipantNameFormProps = {
  tournamentId: string;
  initialParticipantName: string;
};

export function ParticipantNameForm({ tournamentId, initialParticipantName }: ParticipantNameFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const participantName = String(form.get("participantName") ?? "");
    const response = await fetch(`/api/tournaments/${tournamentId}/me`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantName }),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "参加名の変更に失敗しました。");
      return;
    }

    setMessage("参加名を変更しました。");
    router.refresh();
  }

  return (
    <form className="grid gap-2" onSubmit={onSubmit}>
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
      <button className="w-fit rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold disabled:bg-zinc-100" disabled={pending} type="submit">
        {pending ? "保存中..." : "参加名を保存"}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </form>
  );
}
