"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AdvancementRow = {
  tournamentParticipantId: string;
  userId: string;
  playerName: string | null;
  discordUsername: string | null;
  rank: number;
  rating: string;
};

type AdvancementPreview = {
  status: "READY" | "NEEDS_ADMIN_DECISION";
  autoAdvanceRows: AdvancementRow[];
  boundaryTieRows: AdvancementRow[];
  requiredAdminSelections: number;
  advancePlayerCount: number;
};
type BlockAdvancementPreview = {
  status: "READY" | "NEEDS_ADMIN_DECISION";
  blocks: Array<{
    blockId: string;
    blockName: string;
    advancePlayerCount: number;
    autoAdvanceRows: AdvancementRow[];
    boundaryTieRows: AdvancementRow[];
    requiredAdminSelections: number;
    status: "READY" | "NEEDS_ADMIN_DECISION";
  }>;
  totalAdvancePlayerCount: number;
};

type AdvancementConfirmFormProps = {
  phaseId: string;
  preview: AdvancementPreview | BlockAdvancementPreview | null;
};

function label(row: AdvancementRow) {
  return `${row.discordUsername ?? row.playerName ?? row.userId} / ${row.rank}位 / ${row.rating}`;
}

export function AdvancementConfirmForm({ phaseId, preview }: AdvancementConfirmFormProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!preview) return null;

  function toggle(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function submit() {
    setPending(true);
    setMessage(null);
    const body =
      preview?.status === "NEEDS_ADMIN_DECISION"
        ? { selectedTournamentParticipantIds: selectedIds }
        : {};
    const response = await fetch(`/api/phases/${phaseId}/advancement`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    setPending(false);
    if (!response.ok) {
      setMessage(json?.error ?? "Request failed.");
      return;
    }
    setMessage("本戦進出者を確定しました。");
    router.refresh();
  }

  const requiredSelections =
    "blocks" in preview
      ? preview.blocks.reduce((sum, block) => sum + block.requiredAdminSelections, 0)
      : preview.requiredAdminSelections;
  const selectionReady = preview.status === "READY" || selectedIds.length === requiredSelections;

  return (
    <div className="mt-3 grid gap-2 rounded-md border border-zinc-200 p-3 text-sm">
      <p className="font-semibold">本戦進出者確定</p>
      {"blocks" in preview ? (
        <div className="grid gap-3">
          <p>合計進出人数: {preview.totalAdvancePlayerCount}</p>
          {preview.blocks.map((block) => (
            <div className="grid gap-2 border-t border-zinc-200 pt-2" key={block.blockId}>
              <p className="font-semibold">
                {block.blockName} / 進出 {block.advancePlayerCount}人
              </p>
              {block.autoAdvanceRows.length > 0 && <p>自動進出: {block.autoAdvanceRows.map(label).join(", ")}</p>}
              {block.status === "NEEDS_ADMIN_DECISION" && (
                <div className="grid gap-2">
                  <p className="font-semibold text-amber-800">同率境界: {block.requiredAdminSelections}人を選択</p>
                  {block.boundaryTieRows.map((row) => (
                    <label className="flex items-center gap-2" key={row.tournamentParticipantId}>
                      <input
                        checked={selectedIds.includes(row.tournamentParticipantId)}
                        onChange={() => toggle(row.tournamentParticipantId)}
                        type="checkbox"
                      />
                      <span>{label(row)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <>
      {preview.autoAdvanceRows.length > 0 && (
        <p>自動進出: {preview.autoAdvanceRows.map(label).join(", ")}</p>
      )}
      {preview.status === "NEEDS_ADMIN_DECISION" && (
        <div className="grid gap-2">
          <p className="font-semibold text-amber-800">
            同率境界: {preview.requiredAdminSelections}人を選択してください。
          </p>
          {preview.boundaryTieRows.map((row) => (
            <label className="flex items-center gap-2" key={row.tournamentParticipantId}>
              <input
                checked={selectedIds.includes(row.tournamentParticipantId)}
                onChange={() => toggle(row.tournamentParticipantId)}
                type="checkbox"
              />
              <span>{label(row)}</span>
            </label>
          ))}
        </div>
      )}
        </>
      )}
      <button
        className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400"
        disabled={pending || !selectionReady}
        onClick={submit}
        type="button"
      >
        {pending ? "処理中..." : "本戦進出者確定"}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </div>
  );
}
