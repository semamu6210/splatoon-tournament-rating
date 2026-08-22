"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type PhaseFormProps = {
  tournamentId?: string;
  phaseId?: string;
  mode: "create" | "edit";
  initial?: {
    phaseType: "QUALIFIER" | "MAIN_EVENT";
    requiredMatchesPerPlayer: number;
    advancePlayerCount: number | null;
    advancementMode: "OVERALL" | "BLOCK";
    rule?: "AREA" | "YAGURA" | "HOKO" | "ASARI";
    stageSelectionMode?: "ADMIN" | "RANDOM";
    sortOrder: number;
  };
};

export function PhaseForm({ tournamentId, phaseId, mode, initial }: PhaseFormProps) {
  const router = useRouter();
  const [phaseType, setPhaseType] = useState(initial?.phaseType ?? "QUALIFIER");
  const [requiredMatchesPerPlayer, setRequiredMatchesPerPlayer] = useState(String(initial?.requiredMatchesPerPlayer ?? 1));
  const [advancePlayerCount, setAdvancePlayerCount] = useState(initial?.advancePlayerCount?.toString() ?? "");
  const [advancementMode, setAdvancementMode] = useState(initial?.advancementMode ?? "OVERALL");
  const [rule, setRule] = useState(initial?.rule ?? "AREA");
  const [stageSelectionMode, setStageSelectionMode] = useState(initial?.stageSelectionMode ?? "RANDOM");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 1));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setMessage(null);
    const response = await fetch(mode === "create" ? `/api/tournaments/${tournamentId}/phases` : `/api/phases/${phaseId}`, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseType, requiredMatchesPerPlayer, advancePlayerCount, advancementMode, rule, stageSelectionMode, sortOrder }),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setMessage(json?.error ?? "Request failed.");
      return;
    }
    setMessage("保存しました。");
    router.refresh();
  }

  return (
    <div className="grid gap-3 text-sm">
      {mode === "create" && (
        <label className="grid gap-1">
          <span>phaseType</span>
          <select className="rounded-md border border-zinc-300 px-3 py-2" value={phaseType} onChange={(event) => setPhaseType(event.target.value as "QUALIFIER" | "MAIN_EVENT")}>
            <option value="QUALIFIER">QUALIFIER</option>
            <option value="MAIN_EVENT">MAIN_EVENT</option>
          </select>
        </label>
      )}
      <label className="grid gap-1">
        <span>requiredMatchesPerPlayer</span>
        <input className="rounded-md border border-zinc-300 px-3 py-2" value={requiredMatchesPerPlayer} onChange={(event) => setRequiredMatchesPerPlayer(event.target.value)} />
      </label>
      <label className="grid gap-1">
        <span>advancePlayerCount</span>
        <input className="rounded-md border border-zinc-300 px-3 py-2" value={advancePlayerCount} onChange={(event) => setAdvancePlayerCount(event.target.value)} />
      </label>
      <label className="grid gap-1">
        <span>advancementMode</span>
        <select className="rounded-md border border-zinc-300 px-3 py-2" value={advancementMode} onChange={(event) => setAdvancementMode(event.target.value as "OVERALL" | "BLOCK")}>
          <option value="OVERALL">OVERALL</option>
          <option value="BLOCK">BLOCK</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span>rule</span>
        <select className="rounded-md border border-zinc-300 px-3 py-2" value={rule} onChange={(event) => setRule(event.target.value as "AREA" | "YAGURA" | "HOKO" | "ASARI")}>
          <option value="AREA">ガチエリア</option>
          <option value="YAGURA">ガチヤグラ</option>
          <option value="HOKO">ガチホコ</option>
          <option value="ASARI">ガチアサリ</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span>stageSelectionMode</span>
        <select className="rounded-md border border-zinc-300 px-3 py-2" value={stageSelectionMode} onChange={(event) => setStageSelectionMode(event.target.value as "ADMIN" | "RANDOM")}>
          <option value="RANDOM">登録ステージからランダム</option>
          <option value="ADMIN">ADMIN指定</option>
        </select>
      </label>
      {mode === "create" && (
        <label className="grid gap-1">
          <span>sortOrder</span>
          <input className="rounded-md border border-zinc-300 px-3 py-2" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
        </label>
      )}
      <button className="w-fit rounded-md bg-zinc-950 px-4 py-2 font-semibold text-white disabled:bg-zinc-400" disabled={pending} onClick={submit} type="button">
        {pending ? "処理中..." : "保存"}
      </button>
      {message && <p className="text-zinc-700">{message}</p>}
    </div>
  );
}
