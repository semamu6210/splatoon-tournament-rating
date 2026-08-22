import Link from "next/link";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getTournamentRankings } from "@/lib/ranking-service";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ tournamentId: string; participantId: string }>;
};

export default async function PlayerProfilePage({ params }: PageProps) {
  const { tournamentId, participantId } = await params;
  const session = await auth();
  const participant = await prisma.tournamentParticipant.findUnique({
    where: { id: participantId },
    include: { blockParticipations: { include: { block: true } } },
  });
  if (!participant || participant.tournamentId !== tournamentId || !participant.isActive) {
    return <main className="px-5 py-8">参加者が見つかりません。</main>;
  }
  const rankings = await getTournamentRankings(tournamentId);
  const rank = rankings.overall.find((row) => row.tournamentParticipantId === participant.id)?.rank ?? null;
  const block = participant.blockParticipations[0]?.block ?? null;
  const isMe = session?.user?.id === participant.userId;
  const voteStats = isMe
    ? await prisma.playerVote.groupBy({
        by: ["voteType"],
        where: { targetUserId: participant.userId, match: { tournamentId } },
        _count: { voteType: true },
      })
    : [];
  const histories = isMe
    ? await prisma.ratingHistory.findMany({
        where: { tournamentId, userId: participant.userId },
        orderBy: { createdAt: "desc" },
        take: 10,
      })
    : [];
  const voteCount = (voteType: "STRONG" | "WEAK") => voteStats.find((row) => row.voteType === voteType)?._count.voteType ?? 0;
  const badge =
    participant.winningStreak >= 3
      ? `🔥 ${participant.winningStreak}連勝`
      : participant.losingStreak >= 3
        ? `▼ ${participant.losingStreak}連敗`
        : null;

  return (
    <main className="min-h-screen px-5 py-8">
      <section className="mx-auto grid max-w-3xl gap-6">
        <header className="border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href={`/tournaments/${tournamentId}`}>← 大会詳細</Link>
          <h1 className="mt-3 text-3xl font-bold">{participant.participantName}</h1>
          {badge && <p className="mt-2 text-sm font-semibold">{badge}</p>}
        </header>
        <section className="rounded-md border border-zinc-300 bg-white p-4 text-sm">
          <div>現在レート: {participant.rating?.toString() ?? "-"}</div>
          <div>現在順位: {rank ? `${rank}位` : "-"}</div>
          <div>勝敗: {participant.wins}-{participant.losses}</div>
          <div>終了試合数: {participant.matchesPlayed}</div>
          <div>所属ブロック: {block?.name ?? "-"}</div>
        </section>
        {isMe && (
          <section className="rounded-md border border-zinc-300 bg-white p-4 text-sm">
            <h2 className="text-lg font-semibold">自分だけの情報</h2>
            <p className="mt-2">1票目得票: {voteCount("STRONG")} / 2票目得票: {voteCount("WEAK")}</p>
            <h3 className="mt-4 font-semibold">レート変動履歴</h3>
            <ul className="mt-2 grid gap-1">
              {histories.map((history) => (
                <li key={history.id}>
                  {history.createdAt.toLocaleString("ja-JP")} / +{history.finalDelta.toString()} / {history.ratingAfter.toString()}
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  );
}
