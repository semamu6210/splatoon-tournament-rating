import Link from "next/link";

import { AuthControls } from "@/components/auth-controls";
import { ApiButton } from "@/components/api-button";
import { JoinForm } from "@/components/join-form";
import { ParticipantNameForm } from "@/components/participant-name-form";
import { PlayerAvatar } from "@/components/player-avatar";
import { QueuePanel } from "@/components/queue-panel";
import { RankingTabs } from "@/components/ranking-tabs";
import { auth } from "@/auth";
import { formatRating } from "@/lib/format";
import { tournamentPhaseStatusLabel, tournamentPhaseTypeLabel, tournamentStatusLabel } from "@/lib/labels";
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
    avatarUrl: row.avatarUrl,
    rating: row.rating,
    wins: row.wins,
    losses: row.losses,
    matchesPlayed: row.matchesPlayed,
    areaXp: row.areaXp,
    participantName: row.participantName,
    isDummy: row.isDummy,
    winningStreak: row.winningStreak,
    losingStreak: row.losingStreak,
    streakBadge: row.streakBadge,
    finalRank: row.finalRank,
    advancedToMainEvent: row.advancedToMainEvent,
    currentPhase: row.currentPhase,
  };
}

export default async function TournamentDetailPage({ params }: PageProps) {
  const { tournamentId } = await params;
  const session = await auth();
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      participants: {
        where: { isActive: true },
        include: {
          user: {
            select: { id: true, name: true, discordUsername: true, avatarUrl: true },
          },
        },
        orderBy: { joinedAt: "asc" },
      },
      phases: {
        include: { rounds: { orderBy: { roundNumber: "desc" }, take: 1 } },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!tournament) {
    return (
      <main className="px-5 py-8">
        <p>大会が見つかりません。</p>
      </main>
    );
  }

  const myParticipant = session?.user?.id
    ? tournament.participants.find((participant) => participant.userId === session.user?.id)
    : null;
  const activePhase = tournament.phases.find((phase) => phase.status === "ACTIVE") ?? null;
  const rankings = await filterTournamentRankingsForViewer({
    tournamentId: tournament.id,
    rankings: await getTournamentRankings(tournament.id),
    viewerUserId: session?.user?.id,
    isAdmin: session?.user ? canManage(session.user.role) : false,
  });
  const tabRankings = {
    overall: rankings.overall.map(plainRankingRow),
    blocks: rankings.blocks.map((block) => ({
      ...block,
      rows: block.rows.map(plainRankingRow),
    })),
  };
  const myRanking = session?.user?.id
    ? rankings.overall.find((row) => row.userId === session.user?.id)
    : null;
  const myBlock = session?.user?.id
    ? rankings.blocks.find((block) => block.rows.some((row) => row.userId === session.user?.id))
    : null;
  const queueEntry =
    session?.user?.id && activePhase
      ? await prisma.queueEntry.findFirst({
          where: {
            phaseId: activePhase.id,
            userId: session.user.id,
            status: { in: ["WAITING", "MATCHED"] },
          },
          orderBy: { joinedAt: "desc" },
        })
      : null;
  const activeMatch =
    session?.user?.id && activePhase
      ? await prisma.match.findFirst({
          where: {
            phaseId: activePhase.id,
            players: { some: { userId: session.user.id } },
            status: { in: ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING"] },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        })
      : null;
  const queueStatus =
    queueEntry?.status === "WAITING"
      ? {
          status: "WAITING" as const,
          joinedAt: queueEntry.joinedAt.toISOString(),
          waitingSeconds: 0,
        }
      : queueEntry?.status === "MATCHED" && queueEntry.matchId
        ? { status: "MATCHED" as const, matchId: queueEntry.matchId }
        : activeMatch
          ? { status: "MATCHED" as const, matchId: activeMatch.id }
        : { status: "NOT_QUEUED" as const };
  const myVoteStats =
    session?.user && myParticipant
      ? await prisma.playerVote.groupBy({
          by: ["voteType"],
          where: { targetUserId: session.user.id, match: { tournamentId: tournament.id } },
          _count: { voteType: true },
        })
      : [];
  const myPhaseVoteStats =
    session?.user && myParticipant && activePhase
      ? await prisma.playerVote.groupBy({
          by: ["voteType"],
          where: { targetUserId: session.user.id, match: { tournamentId: tournament.id, phaseId: activePhase.id } },
          _count: { voteType: true },
        })
      : [];
  const voteCount = (rows: typeof myVoteStats, voteType: "STRONG" | "WEAK") =>
    rows.find((row) => row.voteType === voteType)?._count.voteType ?? 0;
  const phaseIds = tournament.phases.map((phase) => phase.id);
  const [eligibleTargetCounts, confirmedSlotRows] =
    phaseIds.length > 0
      ? await Promise.all([
          prisma.tournamentPhaseParticipant.groupBy({
            by: ["phaseId"],
            where: { phaseId: { in: phaseIds }, isEligible: true },
            _count: { phaseId: true },
          }),
          prisma.matchPlayer.findMany({
            where: { match: { phaseId: { in: phaseIds }, status: "CONFIRMED" } },
            select: { match: { select: { phaseId: true } } },
          }),
        ])
      : [[], []];
  const targetCountByPhaseId = new Map(eligibleTargetCounts.map((row) => [row.phaseId, row._count.phaseId]));
  const completedSlotsByPhaseId = new Map<string, number>();
  for (const row of confirmedSlotRows) {
    completedSlotsByPhaseId.set(row.match.phaseId, (completedSlotsByPhaseId.get(row.match.phaseId) ?? 0) + 1);
  }
  const phaseProgress = tournament.phases.map((phase) => {
    const targetCount = targetCountByPhaseId.get(phase.id) || tournament.participants.length;
    const completedSlots = completedSlotsByPhaseId.get(phase.id) ?? 0;
    const totalSlots = targetCount * phase.requiredMatchesPerPlayer;
    return {
      phase,
      completedSlots,
      totalSlots,
      percentage: totalSlots > 0 ? Math.round((completedSlots / totalSlots) * 100) : 0,
    };
  });
  const activeRound = activePhase?.rounds[0] ?? null;
  const myActivePhaseCount = myRanking?.currentPhase?.confirmedMatchesInPhase ?? 0;
  const waitingForOtherBlocks =
    Boolean(activePhase && activeRound && !activeMatch && myRanking?.currentPhase && myActivePhaseCount < activePhase.requiredMatchesPerPlayer);

  return (
    <main className="min-h-screen px-5 py-8">
      <section className="mx-auto grid max-w-4xl gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href="/tournaments">← 大会一覧</Link>
          <div>
            <h1 className="text-3xl font-bold">{tournament.name}</h1>
            <p className="mt-2 text-sm text-zinc-600">{tournamentStatusLabel[tournament.status]}</p>
          </div>
          <Link className="w-fit rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white" href={`/tournaments/${tournament.id}/ranking`}>
            ランキング
          </Link>
          <AuthControls />
        </header>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-lg font-semibold">大会情報</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <div>開始: {tournament.startsAt?.toLocaleString("ja-JP") ?? "未定"}</div>
            <div>終了: {tournament.endsAt?.toLocaleString("ja-JP") ?? "未定"}</div>
            <div>参加者: {tournament.participants.length}人</div>
          </dl>
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-lg font-semibold">フェーズ</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {tournament.phases.map((phase) => (
              <li className="border-b border-zinc-100 pb-2" key={phase.id}>
                {tournamentPhaseTypeLabel[phase.phaseType]} / {tournamentPhaseStatusLabel[phase.status]} / 必要試合数 {phase.requiredMatchesPerPlayer}
                {phase.advancePlayerCount ? ` / 進出 ${phase.advancePlayerCount}位まで` : ""}
                {phase.rounds[0] ? ` / 第${phase.rounds[0].roundNumber}試合` : ""}
              </li>
            ))}
            {tournament.phases.length === 0 && <li className="text-zinc-600">フェーズ未作成</li>}
          </ul>
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-lg font-semibold">大会進行状況</h2>
          <div className="mt-3 grid gap-3 text-sm">
            {phaseProgress.map((item) => (
              <div key={item.phase.id}>
                <div className="flex justify-between">
                  <span>{tournamentPhaseTypeLabel[item.phase.phaseType]}</span>
                  <span>{item.completedSlots}/{item.totalSlots} ({item.percentage}%)</span>
                </div>
                <div className="mt-1 h-3 rounded bg-zinc-200">
                  <div className="h-3 rounded bg-emerald-600" style={{ width: `${Math.min(item.percentage, 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        {session?.user && myParticipant && tournament.status === "ACTIVE" && activePhase && (
          <QueuePanel initialStatus={queueStatus} phaseId={activePhase.id} queueEntryId={queueEntry?.id ?? null} />
        )}

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-lg font-semibold">自分の参加状況</h2>
          {!session?.user && <p className="mt-3 text-sm text-zinc-600">参加登録にはログインが必要です。</p>}
          {session?.user && myParticipant && (
            <div className="mt-3 grid gap-2 text-sm">
              <p>登録済み / XP: {myParticipant.areaXp}</p>
              <p>参加名: {myParticipant.participantName}</p>
              <p>現在レート: {myParticipant.rating ? formatRating(myParticipant.rating) : "大会開始前"}</p>
              {myRanking?.currentPhase && (
                <p>
                  {tournamentPhaseTypeLabel[activePhase?.phaseType ?? "QUALIFIER"]} 第
                  {Math.min(myRanking.currentPhase.confirmedMatchesInPhase + 1, myRanking.currentPhase.requiredMatchesPerPlayer)}試合 / 全
                  {myRanking.currentPhase.requiredMatchesPerPlayer}試合 / 残り {myRanking.currentPhase.remainingMatchesInPhase}
                </p>
              )}
              {waitingForOtherBlocks && (
                <div className="grid gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                  <p>第{activeRound?.roundNumber}試合が終了しました</p>
                  <p>他ブロックの試合終了を待っています</p>
                  <p>全ブロック終了後、自動で次のマッチングを開始します</p>
                </div>
              )}
              {myRanking && <p>全体順位: {myRanking.rank}位</p>}
              {myBlock && (
                <p>
                  自分のブロック: {myBlock.blockName} / ブロック順位{" "}
                  {myBlock.rows.find((row) => row.userId === session.user?.id)?.rank ?? "-"}位
                </p>
              )}
              <p>本戦進出状態: {myParticipant.advancedToMainEvent ? "本戦対象" : "未確定/対象外"}</p>
              <p>大会累計 1票目: {voteCount(myVoteStats, "STRONG")} / 2票目: {voteCount(myVoteStats, "WEAK")}</p>
              <p>現在フェーズ 1票目: {voteCount(myPhaseVoteStats, "STRONG")} / 2票目: {voteCount(myPhaseVoteStats, "WEAK")}</p>
              {tournament.status === "REGISTRATION" && (
                <div className="grid gap-3">
                  <ParticipantNameForm initialParticipantName={myParticipant.participantName} tournamentId={tournament.id} />
                  <ApiButton url={`/api/tournaments/${tournament.id}/leave`}>参加取消</ApiButton>
                </div>
              )}
            </div>
          )}
          {session?.user && !myParticipant && tournament.status === "REGISTRATION" && (
            <div className="mt-3">
              <JoinForm initialParticipantName={session.user.discordUsername ?? session.user.name ?? ""} tournamentId={tournament.id} />
            </div>
          )}
          {session?.user && !myParticipant && tournament.status !== "REGISTRATION" && (
            <p className="mt-3 text-sm text-zinc-600">現在は参加登録できません。</p>
          )}
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-lg font-semibold">参加者</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {tournament.participants.map((participant) => (
              <li className="border-b border-zinc-100 pb-2" key={participant.id}>
                <div className="flex items-center gap-3">
                  <PlayerAvatar avatarUrl={participant.user.avatarUrl} name={participant.participantName} />
                  <div>
                    <p className="font-semibold">
                      {participant.participantName}{" "}
                      {participant.winningStreak >= 3 ? (
                        <button className="rounded bg-zinc-100 px-2 py-1 text-xs" title={`🔥 ${participant.winningStreak}連勝中`} type="button">
                          🔥 {participant.winningStreak}連勝
                        </button>
                      ) : participant.losingStreak >= 3 ? (
                        <button className="rounded bg-zinc-100 px-2 py-1 text-xs" title={`▼ ${participant.losingStreak}連敗中`} type="button">
                          ▼ {participant.losingStreak}連敗
                        </button>
                      ) : null}
                    </p>
                    <p className="text-zinc-600">
                      現在レート {formatRating(participant.rating)} / {participant.wins}勝{participant.losses}敗 / 試合 {participant.matchesPlayed}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-lg font-semibold">全体ランキング</h2>
          <div className="mt-3">
            <RankingTabs
              blocks={tabRankings.blocks}
              overall={tabRankings.overall}
              showFinalRank={tournament.status === "FINISHED"}
            />
          </div>
        </section>
      </section>
    </main>
  );
}
