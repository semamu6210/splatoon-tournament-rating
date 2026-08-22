"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Block = {
  id: string;
  name: string;
  advancePlayerCount: number | null;
  participants: Array<{ tournamentParticipantId: string }>;
};

type Participant = {
  id: string;
  userId: string;
  label: string;
};

type BlockManagementPanelProps = {
  phaseId: string;
  phaseStatus: string;
  blocks: Block[];
  participants: Participant[];
};

export function BlockManagementPanel({ phaseId, phaseStatus, blocks, participants }: BlockManagementPanelProps) {
  const router = useRouter();
  const [blockCount, setBlockCount] = useState("4");
  const [message, setMessage] = useState<string | null>(null);

  async function request(url: string, method = "POST", body?: Record<string, unknown>) {
    setMessage(null);
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setMessage(json?.error ?? "Request failed.");
      return;
    }
    setMessage("保存しました。");
    router.refresh();
  }

  function createBlocks() {
    const count = Number(blockCount);
    const blocksPayload = Array.from({ length: Number.isInteger(count) && count > 0 ? count : 4 }, (_, index) => ({
      name: `ブロック${String.fromCharCode(65 + index)}`,
      advancePlayerCount: 0,
    }));
    void request(`/api/phases/${phaseId}/blocks`, "POST", { blocks: blocksPayload });
  }

  return (
    <div className="mt-3 grid gap-3 rounded-md border border-zinc-200 p-3 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span>ブロック数</span>
          <input className="w-24 rounded-md border border-zinc-300 px-3 py-2" value={blockCount} onChange={(event) => setBlockCount(event.target.value)} />
        </label>
        <button className="rounded-md bg-zinc-950 px-4 py-2 font-semibold text-white disabled:bg-zinc-400" disabled={phaseStatus !== "PENDING"} onClick={createBlocks} type="button">
          ブロック作成
        </button>
        <button className="rounded-md bg-zinc-950 px-4 py-2 font-semibold text-white disabled:bg-zinc-400" disabled={phaseStatus !== "PENDING"} onClick={() => void request(`/api/phases/${phaseId}/blocks/auto-assign`)} type="button">
          自動割当
        </button>
      </div>
      {blocks.map((block) => (
        <BlockEditor block={block} key={block.id} phaseId={phaseId} phaseStatus={phaseStatus} request={request} />
      ))}
      {blocks.length > 0 && (
        <div className="grid gap-2">
          <p className="font-semibold">手動移動</p>
          {participants.map((participant) => (
            <label className="flex flex-wrap items-center gap-2" key={participant.id}>
              <span className="min-w-40">{participant.label}</span>
              <select
                className="rounded-md border border-zinc-300 px-3 py-2"
                defaultValue={blocks.find((block) => block.participants.some((item) => item.tournamentParticipantId === participant.id))?.id ?? ""}
                disabled={phaseStatus !== "PENDING"}
                onChange={(event) =>
                  void request(`/api/phases/${phaseId}/blocks/participants`, "PATCH", {
                    tournamentParticipantId: participant.id,
                    blockId: event.target.value,
                  })
                }
              >
                <option value="">未所属</option>
                {blocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      {message && <p className="text-zinc-700">{message}</p>}
    </div>
  );
}

function BlockEditor({
  block,
  phaseId,
  phaseStatus,
  request,
}: {
  block: Block;
  phaseId: string;
  phaseStatus: string;
  request: (url: string, method?: string, body?: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState(block.name);
  const [advancePlayerCount, setAdvancePlayerCount] = useState(block.advancePlayerCount?.toString() ?? "");

  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-zinc-200 pt-3">
      <label className="grid gap-1">
        <span>ブロック名</span>
        <input className="rounded-md border border-zinc-300 px-3 py-2" disabled={phaseStatus !== "PENDING"} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className="grid gap-1">
        <span>進出人数</span>
        <input className="w-28 rounded-md border border-zinc-300 px-3 py-2" disabled={phaseStatus !== "PENDING"} value={advancePlayerCount} onChange={(event) => setAdvancePlayerCount(event.target.value)} />
      </label>
      <button className="rounded-md bg-zinc-950 px-4 py-2 font-semibold text-white disabled:bg-zinc-400" disabled={phaseStatus !== "PENDING"} onClick={() => void request(`/api/phases/${phaseId}/blocks/${block.id}`, "PATCH", { name, advancePlayerCount })} type="button">
        保存
      </button>
      <span className="text-zinc-600">所属 {block.participants.length}人</span>
    </div>
  );
}
