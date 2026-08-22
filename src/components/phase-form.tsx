"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { advancementModeLabel, matchRuleLabel, stageSelectionModeLabel, tournamentPhaseTypeLabel } from "@/lib/labels";

type PhaseFormProps = {
  tournamentId?: string;
  phaseId?: string;
  mode: "create" | "edit";
  stages?: Array<{ id: string; name: string }>;
  initial?: {
    phaseType: "QUALIFIER" | "MAIN_EVENT";
    requiredMatchesPerPlayer: number;
    advancePlayerCount: number | null;
    advancementMode: "OVERALL" | "BLOCK";
    rule?: "AREA" | "YAGURA" | "HOKO" | "ASARI";
    stageSelectionMode?: "ADMIN" | "RANDOM";
    defaultStageId?: string | null;
    sortOrder: number;
  };
};

export function PhaseForm({ tournamentId, phaseId, mode, initial, stages = [] }: PhaseFormProps) {
  const router = useRouter();
  const [phaseType, setPhaseType] = useState(initial?.phaseType ?? "QUALIFIER");
  const [requiredMatchesPerPlayer, setRequiredMatchesPerPlayer] = useState(String(initial?.requiredMatchesPerPlayer ?? 1));
  const [advancePlayerCount, setAdvancePlayerCount] = useState(initial?.advancePlayerCount?.toString() ?? "");
  const [advancementMode, setAdvancementMode] = useState(initial?.advancementMode ?? "OVERALL");
  const [rule, setRule] = useState(initial?.rule ?? "AREA");
  const [stageSelectionMode, setStageSelectionMode] = useState(initial?.stageSelectionMode ?? "RANDOM");
  const [defaultStageId, setDefaultStageId] = useState(initial?.defaultStageId ?? "");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 1));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    setMessage(null);
    const response = await fetch(mode === "create" ? `/api/tournaments/${tournamentId}/phases` : `/api/phases/${phaseId}`, {
      method: mode === "create" ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phaseType, requiredMatchesPerPlayer, advancePlayerCount, advancementMode, rule, stageSelectionMode, defaultStageId, sortOrder }),
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
          <span>フェーズ種別</span>
          <select className="rounded-md border border-zinc-300 px-3 py-2" value={phaseType} onChange={(event) => setPhaseType(event.target.value as "QUALIFIER" | "MAIN_EVENT")}>
            <option value="QUALIFIER">{tournamentPhaseTypeLabel.QUALIFIER}</option>
            <option value="MAIN_EVENT">{tournamentPhaseTypeLabel.MAIN_EVENT}</option>
          </select>
        </label>
      )}
      <label className="grid gap-1">
        <span>必要試合数</span>
        <input className="rounded-md border border-zinc-300 px-3 py-2" value={requiredMatchesPerPlayer} onChange={(event) => setRequiredMatchesPerPlayer(event.target.value)} />
      </label>
      <label className="grid gap-1">
        <span>進出人数</span>
        <input className="rounded-md border border-zinc-300 px-3 py-2" value={advancePlayerCount} onChange={(event) => setAdvancePlayerCount(event.target.value)} />
      </label>
      <label className="grid gap-1">
        <span>進出方式</span>
        <select className="rounded-md border border-zinc-300 px-3 py-2" value={advancementMode} onChange={(event) => setAdvancementMode(event.target.value as "OVERALL" | "BLOCK")}>
          <option value="OVERALL">{advancementModeLabel.OVERALL}</option>
          <option value="BLOCK">{advancementModeLabel.BLOCK}</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span>ルール</span>
        <select className="rounded-md border border-zinc-300 px-3 py-2" value={rule} onChange={(event) => setRule(event.target.value as "AREA" | "YAGURA" | "HOKO" | "ASARI")}>
          <option value="AREA">{matchRuleLabel.AREA}</option>
          <option value="YAGURA">{matchRuleLabel.YAGURA}</option>
          <option value="HOKO">{matchRuleLabel.HOKO}</option>
          <option value="ASARI">{matchRuleLabel.ASARI}</option>
        </select>
      </label>
      <label className="grid gap-1">
        <span>ステージ決定方式</span>
        <select className="rounded-md border border-zinc-300 px-3 py-2" value={stageSelectionMode} onChange={(event) => setStageSelectionMode(event.target.value as "ADMIN" | "RANDOM")}>
          <option value="RANDOM">{stageSelectionModeLabel.RANDOM}</option>
          <option value="ADMIN">{stageSelectionModeLabel.ADMIN}</option>
        </select>
      </label>
      {stageSelectionMode === "ADMIN" && (
        <label className="grid gap-1">
          <span>既定ステージ</span>
          <select className="rounded-md border border-zinc-300 px-3 py-2" value={defaultStageId} onChange={(event) => setDefaultStageId(event.target.value)}>
            <option value="">Matchごとに指定</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {mode === "create" && (
        <label className="grid gap-1">
          <span>表示順</span>
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
