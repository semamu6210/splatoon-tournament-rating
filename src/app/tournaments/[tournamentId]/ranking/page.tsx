import Link from "next/link";

import { RankingTabs } from "@/components/ranking-tabs";
import { auth } from "@/auth";
import { tournamentPhaseTypeLabel } from "@/lib/labels";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { filterTournamentRankingsForViewer, getTournamentRankings } from "@/lib/ranking-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ tournamentId: string }>;
};

function plainRankingRow(row: Awaited<ReturnType<typeof getTournamentRankings>>["overall"][number]) {
  return {
    rank: row.rank,
    userId: row.userId,
    playerName: row.playerName,
    discordUsername: row.discordUsername,
    rating: row.rating,
    wins: row.wins,
    losses: row.losses,
    matchesPlayed: row.matchesPlayed,
    areaXp: row.areaXp,
    participantName: row.participantName,
    winningStreak: row.winningStreak,
    losingStreak: row.losingStreak,
    streakBadge: row.streakBadge,
    finalRank: row.finalRank,
    advancedToMainEvent: row.advancedToMainEvent,
    currentPhase: row.currentPhase,
  };
}

export default async function TournamentRankingPage({ params }: PageProps) {
  const { tournamentId } = await params;
  const session = await auth();
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      phases: { where: { status: "ACTIVE" }, orderBy: { sortOrder: "asc" } },
    },
  });

  if (!tournament) {
    return (
      <main className="px-5 py-8">
        <p>大会が見つかりません。</p>
      </main>
    );
  }

  const rankings = await filterTournamentRankingsForViewer({
    tournamentId: tournament.id,
    rankings: await getTournamentRankings(tournament.id),
    viewerUserId: session?.user?.id,
    isAdmin: session?.user ? canManage(session.user.role) : false,
  });
  const tabRankings = {
    overall: rankings.overall.map(plainRankingRow),
    blocks: rankings.blocks.map((block) => ({ ...block, rows: block.rows.map(plainRankingRow) })),
  };
  const activePhase = tournament.phases[0] ?? null;

  return (
    <main className="min-h-screen px-5 py-8">
      <section className="mx-auto grid max-w-5xl gap-6">
        <header className="flex flex-col gap-3 border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href={`/tournaments/${tournament.id}`}>← 大会詳細</Link>
          <div>
            <h1 className="text-3xl font-bold">{tournament.name} ランキング</h1>
            <p className="mt-2 text-sm text-zinc-600">
              {tournament.status === "FINISHED" ? "最終結果" : "現在ランキング"} / 現在フェーズ{" "}
              {activePhase ? tournamentPhaseTypeLabel[activePhase.phaseType] : "-"}
            </p>
          </div>
        </header>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <RankingTabs
            blocks={tabRankings.blocks}
            overall={tabRankings.overall}
            showFinalRank={tournament.status === "FINISHED"}
          />
        </section>
      </section>
    </main>
  );
}
