"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type TournamentFormProps = {
  mode: "create" | "edit";
  tournamentId?: string;
  initialName?: string;
  initialStartsAt?: string | null;
  initialEndsAt?: string | null;
  initialRankingVisibility?: "OWN_BLOCK_ONLY" | "OWN_AND_OTHER_BLOCKS" | "OVERALL_ONLY" | "ALL";
};

function toInputDateTime(value?: string | null) {
  if (!value) return "";
  return value.slice(0, 16);
}

export function TournamentForm({
  mode,
  tournamentId,
  initialName = "",
  initialStartsAt,
  initialEndsAt,
  initialRankingVisibility = "ALL",
}: TournamentFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get("name"),
      startsAt: form.get("startsAt") || null,
      endsAt: form.get("endsAt") || null,
      rankingVisibility: form.get("rankingVisibility"),
    };

    const response = await fetch(mode === "create" ? "/api/tournaments" : `/api/tournaments/${tournamentId}`, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as {
      error?: string;
      tournament?: { id: string };
    } | null;

    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "保存に失敗しました。");
      return;
    }

    if (mode === "create" && json?.tournament?.id) {
      router.push(`/admin/tournaments/${json.tournament.id}`);
      return;
    }

    setMessage("保存しました。");
    router.refresh();
  }

  return (
    <form className="grid gap-4" onSubmit={onSubmit}>
      <label className="grid gap-1 text-sm">
        大会名
        <input
          className="rounded-md border border-zinc-300 px-3 py-2"
          defaultValue={initialName}
          name="name"
          required
        />
      </label>
      <label className="grid gap-1 text-sm">
        開始日時
        <input
          className="rounded-md border border-zinc-300 px-3 py-2"
          defaultValue={toInputDateTime(initialStartsAt)}
          name="startsAt"
          type="datetime-local"
        />
      </label>
      <label className="grid gap-1 text-sm">
        ランキング公開範囲
        <select className="rounded-md border border-zinc-300 px-3 py-2" defaultValue={initialRankingVisibility} name="rankingVisibility">
          <option value="OWN_BLOCK_ONLY">OWN_BLOCK_ONLY</option>
          <option value="OWN_AND_OTHER_BLOCKS">OWN_AND_OTHER_BLOCKS</option>
          <option value="OVERALL_ONLY">OVERALL_ONLY</option>
          <option value="ALL">ALL</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        終了日時
        <input
          className="rounded-md border border-zinc-300 px-3 py-2"
          defaultValue={toInputDateTime(initialEndsAt)}
          name="endsAt"
          type="datetime-local"
        />
      </label>
      <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400" disabled={pending}>
        {pending ? "保存中..." : "保存"}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </form>
  );
}
