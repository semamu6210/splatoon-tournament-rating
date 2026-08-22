"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { rankingVisibilityLabel } from "@/lib/labels";
import { DEFAULT_STAGE_NAMES } from "@/lib/stages";

type TournamentFormProps = {
  mode: "create" | "edit";
  tournamentId?: string;
  initialName?: string;
  initialStartsAt?: string | null;
  initialEndsAt?: string | null;
  initialRankingVisibility?: "OWN_BLOCK_ONLY" | "OWN_AND_OTHER_BLOCKS" | "OVERALL_ONLY" | "ALL";
  initialStagePoolEnabled?: boolean;
  initialStageNames?: string[];
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
  initialStagePoolEnabled = true,
  initialStageNames = DEFAULT_STAGE_NAMES.slice(0, 4),
}: TournamentFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [stagePoolEnabled, setStagePoolEnabled] = useState(initialStagePoolEnabled);
  const [stageNames, setStageNames] = useState<string[]>(initialStageNames);
  const [pending, setPending] = useState(false);

  function toggleStage(name: string) {
    setStageNames((current) => (current.includes(name) ? current.filter((stage) => stage !== name) : [...current, name]));
  }

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
      stagePoolEnabled,
      stageNames: stagePoolEnabled ? stageNames : undefined,
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
          <option value="OWN_BLOCK_ONLY">{rankingVisibilityLabel.OWN_BLOCK_ONLY}</option>
          <option value="OWN_AND_OTHER_BLOCKS">{rankingVisibilityLabel.OWN_AND_OTHER_BLOCKS}</option>
          <option value="OVERALL_ONLY">{rankingVisibilityLabel.OVERALL_ONLY}</option>
          <option value="ALL">{rankingVisibilityLabel.ALL}</option>
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
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">使用ステージ</legend>
        <label className="flex items-center gap-2 text-sm">
          <input checked={stagePoolEnabled} className="size-4" onChange={(event) => setStagePoolEnabled(event.target.checked)} type="checkbox" />
          ステージプールを使用する
        </label>
        {stagePoolEnabled && (
          <>
            <p className="text-xs text-zinc-600">この大会で使用するステージを1つ以上選択してください。</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEFAULT_STAGE_NAMES.map((name) => {
                const checked = stageNames.includes(name);
                return (
                  <label
                    className={
                      checked
                        ? "flex min-h-12 items-center gap-3 rounded-md border border-zinc-950 bg-zinc-950 px-3 py-2 text-sm font-semibold text-white"
                        : "flex min-h-12 items-center gap-3 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
                    }
                    key={name}
                  >
                    <input checked={checked} className="size-4" onChange={() => toggleStage(name)} type="checkbox" />
                    <span>{name}</span>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </fieldset>
      <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400" disabled={pending}>
        {pending ? "保存中..." : "保存"}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </form>
  );
}
