"use client";

import { useState } from "react";

import { tournamentPhaseTypeLabel } from "@/lib/labels";

type RankingRow = {
  rank: number;
  userId: string;
  playerName: string | null;
  discordUsername: string | null;
  rating: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
  areaXp: number;
  participantName: string;
  isDummy: boolean;
  winningStreak: number;
  losingStreak: number;
  streakBadge: string | null;
  finalRank: number | null;
  advancedToMainEvent: boolean;
  currentPhase?: {
    requiredMatchesPerPlayer: number;
    confirmedMatchesInPhase: number;
    remainingMatchesInPhase: number;
  } | null;
};

type RankingBlock = {
  blockId: string;
  blockName: string;
  phaseType: keyof typeof tournamentPhaseTypeLabel;
  rows: RankingRow[];
};

type RankingTabsProps = {
  overall: RankingRow[];
  blocks: RankingBlock[];
  showFinalRank?: boolean;
};

function playerLabel(row: RankingRow) {
  return row.participantName ?? row.discordUsername ?? row.playerName ?? row.userId;
}

function DummyBadge({ show }: { show: boolean }) {
  return show ? <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">テスト参加者</span> : null;
}

export function RankingTabs({ overall, blocks, showFinalRank = false }: RankingTabsProps) {
  const tabs = [
    { id: "overall", label: "全体ランキング", rows: overall },
    ...blocks.map((block) => ({
      id: block.blockId,
      label: `${tournamentPhaseTypeLabel[block.phaseType]} ${block.blockName}`,
      rows: block.rows,
    })),
  ];
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "overall");
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <div className="grid gap-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((tab) => (
          <button
            className={`shrink-0 rounded-md border px-3 py-2 text-sm font-semibold ${
              activeTab === tab.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 bg-white text-zinc-800"
            }`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2 md:hidden">
        {active.rows.map((row) => (
          <div className="rounded-md border border-zinc-200 bg-white p-3 text-sm" key={row.userId}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {row.rank}位 {playerLabel(row)} <DummyBadge show={row.isDummy} />
                </p>
                <p className="mt-1 text-zinc-600">
                  現在レート {row.rating} / {row.wins}勝{row.losses}敗
                </p>
              </div>
              {row.streakBadge && (
                <span className="shrink-0 rounded bg-zinc-100 px-2 py-1 text-xs" title={row.streakBadge}>
                  {row.streakBadge}
                </span>
              )}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-zinc-600">
              <p>
                試合{" "}
                {row.currentPhase
                  ? `${row.currentPhase.confirmedMatchesInPhase}/${row.currentPhase.requiredMatchesPerPlayer}`
                  : row.matchesPlayed}
              </p>
              <p>XP {row.areaXp}</p>
              <p>本戦 {row.advancedToMainEvent ? "対象" : "-"}</p>
              {showFinalRank && <p>最終順位 {row.finalRank ?? "-"}</p>}
            </div>
          </div>
        ))}
        {active.rows.length === 0 && <p className="text-sm text-zinc-600">ランキング対象者がいません。</p>}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-100 text-zinc-600">
            <tr>
              <th className="px-3 py-2">順位</th>
              <th className="px-3 py-2">参加者</th>
              <th className="px-3 py-2">現在レート</th>
              <th className="px-3 py-2">勝敗</th>
              <th className="px-3 py-2">試合</th>
              <th className="px-3 py-2">XP</th>
              <th className="px-3 py-2">本戦</th>
              {showFinalRank && <th className="px-3 py-2">最終順位</th>}
            </tr>
          </thead>
          <tbody>
            {active.rows.map((row) => (
              <tr className="border-t border-zinc-200" key={row.userId}>
                <td className="px-3 py-2">{row.rank}</td>
                <td className="px-3 py-2">
                  {playerLabel(row)} <DummyBadge show={row.isDummy} />{" "}
                  {row.streakBadge && (
                    <button className="rounded bg-zinc-100 px-2 py-1 text-xs" title={row.streakBadge} type="button">
                      {row.streakBadge}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2">{row.rating}</td>
                <td className="px-3 py-2">
                  {row.wins}-{row.losses}
                </td>
                <td className="px-3 py-2">
                  {row.currentPhase
                    ? `${row.currentPhase.confirmedMatchesInPhase}/${row.currentPhase.requiredMatchesPerPlayer}`
                    : row.matchesPlayed}
                </td>
                <td className="px-3 py-2">{row.areaXp}</td>
                <td className="px-3 py-2">{row.advancedToMainEvent ? "対象" : "-"}</td>
                {showFinalRank && <td className="px-3 py-2">{row.finalRank ?? "-"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {active.rows.length === 0 && <p className="mt-3 text-sm text-zinc-600">ランキング対象者がいません。</p>}
      </div>
    </div>
  );
}
