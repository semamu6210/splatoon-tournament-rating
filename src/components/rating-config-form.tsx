"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { buildXpTierRanges } from "@/lib/xp-tiers";

type RatingConfigFormProps = {
  tournamentId: string;
  current?: {
    version: number;
    initialRating: string;
    winBonus: string;
    strongVotePoints: string;
    weakVotePoints: string;
    losingStreakPenalty: string;
    xpTierStepSize: number;
    xpMultiplierTiers?: Array<{
      minXp: number | null;
      maxXp: number | null;
      multiplier: string;
      sortOrder: number;
    }>;
  } | null;
};

function formatRange(minXp: number | null, maxXp: number | null) {
  if (minXp === null) return `〜${maxXp}`;
  if (maxXp === null) return `${minXp}〜`;
  return `${minXp}〜${maxXp}`;
}

export function RatingConfigForm({ tournamentId, current }: RatingConfigFormProps) {
  const router = useRouter();
  const [stepSize, setStepSize] = useState<50 | 100>((current?.xpTierStepSize as 50 | 100 | undefined) ?? 100);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const currentBySortOrder = useMemo(() => {
    return new Map(current?.xpMultiplierTiers?.map((tier) => [tier.sortOrder, tier.multiplier]) ?? []);
  }, [current]);

  const tiers = buildXpTierRanges(stepSize);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);

    const form = new FormData(event.currentTarget);
    const multipliers = tiers.map((tier) => ({
      sortOrder: tier.sortOrder,
      multiplier: form.get(`multiplier-${tier.sortOrder}`),
    }));

    const body = {
      initialRating: form.get("initialRating"),
      winBonus: form.get("winBonus"),
      strongVotePoints: form.get("strongVotePoints"),
      weakVotePoints: form.get("weakVotePoints"),
      losingStreakPenalty: form.get("losingStreakPenalty"),
      xpTierStepSize: stepSize,
      multipliers,
    };

    const response = await fetch(`/api/tournaments/${tournamentId}/rating-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as { error?: string } | null;

    setPending(false);

    if (!response.ok) {
      setMessage(json?.error ?? "レート設定の保存に失敗しました。");
      return;
    }

    setMessage("新しいVersionを作成しました。");
    router.refresh();
  }

  return (
    <form className="grid gap-5" onSubmit={onSubmit}>
      <div className="rounded-md border border-zinc-300 bg-white p-4">
        <p className="text-sm font-semibold text-zinc-600">
          現在のレート設定: {current ? `バージョン ${current.version}` : "未設定"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          初期レート
          <input className="rounded-md border border-zinc-300 px-3 py-2" defaultValue={current?.initialRating ?? "1000"} name="initialRating" required />
        </label>
        <label className="grid gap-1 text-sm">
          勝利ポイント
          <input className="rounded-md border border-zinc-300 px-3 py-2" defaultValue={current?.winBonus ?? "10"} name="winBonus" required />
        </label>
        <label className="grid gap-1 text-sm">
          1票目でもらえるポイント
          <input className="rounded-md border border-zinc-300 px-3 py-2" defaultValue={current?.strongVotePoints ?? "10"} name="strongVotePoints" required />
        </label>
        <label className="grid gap-1 text-sm">
          2票目でもらえるポイント
          <input className="rounded-md border border-zinc-300 px-3 py-2" defaultValue={current?.weakVotePoints ?? "5"} name="weakVotePoints" required />
        </label>
        <label className="grid gap-1 text-sm">
          連敗補正
          <input className="rounded-md border border-zinc-300 px-3 py-2" defaultValue={current?.losingStreakPenalty ?? "50"} name="losingStreakPenalty" required />
        </label>
        <label className="grid gap-1 text-sm">
          XP刻み幅
          <select
            className="rounded-md border border-zinc-300 px-3 py-2"
            onChange={(event) => setStepSize(Number(event.target.value) as 50 | 100)}
            value={stepSize}
          >
            <option value={100}>100</option>
            <option value={50}>50</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-md border border-zinc-300 bg-white">
        <table className="w-full min-w-96 text-left text-sm">
          <thead className="bg-zinc-100 text-zinc-600">
            <tr>
              <th className="px-3 py-2">XP帯</th>
              <th className="px-3 py-2">倍率</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((tier) => (
              <tr className="border-t border-zinc-200" key={tier.sortOrder}>
                <td className="px-3 py-2">{formatRange(tier.minXp, tier.maxXp)}</td>
                <td className="px-3 py-2">
                  <input
                    className="w-32 rounded-md border border-zinc-300 px-3 py-2"
                    defaultValue={currentBySortOrder.get(tier.sortOrder) ?? "1.0"}
                    name={`multiplier-${tier.sortOrder}`}
                    required
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-zinc-400" disabled={pending}>
        {pending ? "保存中..." : "新しいレート設定Versionを保存"}
      </button>
      {message && <p className="text-sm text-zinc-700">{message}</p>}
    </form>
  );
}
