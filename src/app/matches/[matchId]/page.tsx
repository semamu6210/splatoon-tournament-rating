import Link from "next/link";

import { AdminMatchActions } from "@/components/admin-match-actions";
import { AuthControls } from "@/components/auth-controls";
import { PlayerVoteForm } from "@/components/player-vote-form";
import { ResultReportForm } from "@/components/result-report-form";
import { auth } from "@/auth";
import { formatRating } from "@/lib/format";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ matchId: string }>;
};

export default async function MatchPage({ params }: PageProps) {
  const { matchId } = await params;
  const session = await auth();
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: {
        include: {
          user: {
            select: { id: true, name: true, discordUsername: true },
          },
        },
        orderBy: [{ team: "asc" }, { userId: "asc" }],
      },
      resultReports: true,
      playerVotes: true,
      ratingHistories: true,
      tournament: { select: { name: true } },
      phase: { select: { phaseType: true, rule: true } },
    },
  });

  if (!match) {
    return (
      <main className="px-5 py-8">
        <p>試合が見つかりません。</p>
      </main>
    );
  }

  const user = session?.user;
  const isAdmin = user ? canManage(user.role) : false;
  const myPlayer = user ? match.players.find((player) => player.userId === user.id) : null;

  if (!isAdmin && !myPlayer) {
    return (
      <main className="px-5 py-8">
        <AuthControls />
        <p className="mt-4 text-red-700">この試合は閲覧できません。</p>
      </main>
    );
  }

  const teamA = match.players.filter((player) => player.team === "A");
  const teamB = match.players.filter((player) => player.team === "B");
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId: match.tournamentId, userId: { in: match.players.map((player) => player.userId) } },
  });
  const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant]));
  const ruleLabel = { AREA: "ガチエリア", YAGURA: "ガチヤグラ", HOKO: "ガチホコ", ASARI: "ガチアサリ" }[match.rule];
  const teammateIds = myPlayer
    ? match.players.filter((player) => player.team === myPlayer.team && player.userId !== myPlayer.userId).map((player) => player.userId)
    : [];
  const teammateHistories =
    myPlayer && teammateIds.length > 0
      ? await prisma.matchPlayer.findMany({
          where: {
            userId: { in: teammateIds },
            matchId: { not: match.id },
            match: { tournamentId: match.tournamentId, status: "CONFIRMED" },
          },
          include: { match: { select: { id: true, winnerTeam: true, createdAt: true } } },
          orderBy: { match: { createdAt: "desc" } },
          take: teammateIds.length * 5,
        })
      : [];
  const opponents = myPlayer
    ? match.players
        .filter((player) => player.team !== myPlayer.team)
        .map((player) => ({
          userId: player.userId,
          label: player.user.discordUsername ?? player.user.name ?? player.userId,
        }))
    : [];
  const myHistory = user ? match.ratingHistories.find((history) => history.userId === user.id) : null;
  const voteSubmittedUserIds = new Set(match.playerVotes.map((vote) => vote.voterUserId));
  const myVotes = user ? match.playerVotes.filter((vote) => vote.voterUserId === user.id) : [];
  const myVoteComplete =
    myVotes.some((vote) => vote.voteType === "STRONG") && myVotes.some((vote) => vote.voteType === "WEAK");

  return (
    <main className="min-h-screen px-5 py-8">
      <section className="mx-auto grid max-w-4xl gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href={`/tournaments/${match.tournamentId}`}>← 大会へ</Link>
          <div>
            <h1 className="text-3xl font-bold">Match</h1>
            <p className="mt-2 text-sm text-zinc-600">
              {match.tournament.name} / {match.phase.phaseType} Match #{match.matchNumber ?? "-"} / {match.status}
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              ルール: {ruleLabel} / ステージ: {match.stageName ?? "未設定"}
            </p>
            {myPlayer && <p className="mt-1 text-sm font-semibold text-emerald-700">あなたはTeam {myPlayer.team}</p>}
          </div>
          <AuthControls />
        </header>

        <div className="grid gap-4 md:grid-cols-2">
          {[
            ["A", teamA],
            ["B", teamB],
          ].map(([team, players]) => (
            <section
              className={
                myPlayer?.team === team
                  ? "rounded-md border-2 border-emerald-500 bg-white p-4"
                  : "rounded-md border border-zinc-300 bg-white p-4"
              }
              key={team as string}
            >
              <h2 className="text-xl font-semibold">Team {team as string}</h2>
              <ul className="mt-3 grid gap-2">
                {(players as typeof teamA).map((player) => (
                  <li className="rounded-md bg-zinc-50 p-3 text-sm" key={player.id}>
                    <p className="font-semibold">
                      {participantByUserId.get(player.userId)?.participantName ?? player.user.discordUsername ?? player.user.name ?? player.userId}{" "}
                      {(() => {
                        const participant = participantByUserId.get(player.userId);
                        const badge =
                          participant && participant.winningStreak >= 3
                            ? `🔥 ${participant.winningStreak}連勝`
                            : participant && participant.losingStreak >= 3
                              ? `▼ ${participant.losingStreak}連敗`
                              : null;
                        return badge ? (
                          <button className="rounded bg-zinc-100 px-2 py-1 text-xs" title={badge} type="button">
                            {badge}
                          </button>
                        ) : null;
                      })()}
                    </p>
                    <p className="text-zinc-600">
                      rating: {formatRating(participantByUserId.get(player.userId)?.rating ?? player.ratingBefore)} /{" "}
                      {participantByUserId.get(player.userId)?.wins ?? 0}-{participantByUserId.get(player.userId)?.losses ?? 0}
                    </p>
                    {isAdmin && (
                      <p className="text-zinc-600">
                        matching: {formatRating(player.matchingRatingAtMatch)} / losingStreak: {player.losingStreakAtMatch}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {myPlayer && teammateIds.length > 0 && (
          <section className="rounded-md border border-zinc-300 bg-white p-4">
            <h2 className="text-lg font-semibold">味方の直近試合</h2>
            <div className="mt-3 grid gap-3 text-sm">
              {teammateIds.map((teammateId) => {
                const teammate = match.players.find((player) => player.userId === teammateId)!;
                const rows = teammateHistories.filter((history) => history.userId === teammateId).slice(0, 5);
                return (
                  <div className="rounded-md bg-zinc-50 p-3" key={teammateId}>
                    <p className="font-semibold">
                      {participantByUserId.get(teammateId)?.participantName ?? teammate.user.discordUsername ?? teammate.user.name ?? teammateId}
                    </p>
                    <ul className="mt-2 grid gap-1 text-zinc-700">
                      {rows.map((history) => (
                        <li key={history.id}>
                          {history.match.createdAt.toLocaleString("ja-JP")} /{" "}
                          {history.match.winnerTeam === history.team ? "WIN" : "LOSS"} / 増加{" "}
                          {formatRating(history.ratingAfter ? history.ratingAfter.sub(history.ratingBefore) : null)}
                        </li>
                      ))}
                      {rows.length === 0 && <li>履歴なし</li>}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {match.status === "PLAYING" && (
          <section className="rounded-md border border-zinc-300 bg-white p-4">
            <h2 className="text-lg font-semibold">試合中</h2>
            <p className="mt-2 text-sm text-zinc-600">試合終了後、管理者が勝敗報告を開始します。</p>
          </section>
        )}

        {match.status === "RESULT_REPORTING" && myPlayer && <ResultReportForm matchId={match.id} />}

        {match.status === "VOTE_REPORTING" && myPlayer && (
          <section className="grid gap-3">
            <div className="rounded-md border border-zinc-300 bg-white p-4 text-sm">
              <p>自分の投票状態: {myVoteComplete ? "投票済み" : "未投票"}</p>
              <p>投票受付: {match.votingClosedAt ? `締切済み (${match.votingClosedAt.toLocaleString("ja-JP")})` : "受付中"}</p>
            </div>
            {!match.votingClosedAt && !myVoteComplete && <PlayerVoteForm matchId={match.id} opponents={opponents} />}
            {match.votingClosedAt && <p className="text-sm text-zinc-600">ADMINにより投票受付は締め切られました。</p>}
          </section>
        )}

        {match.status === "CONFIRMED" && myHistory && (
          <section className="rounded-md border border-zinc-300 bg-white p-4">
            <h2 className="text-lg font-semibold">自分のレート変動</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div>試合前レート: {formatRating(myHistory.ratingBefore)}</div>
              <div>強い票: {myHistory.strongVotesReceived}</div>
              <div>弱い票: {myHistory.weakVotesReceived}</div>
              <div>強い票ポイント: {formatRating(myHistory.strongVotePointsUsed)}</div>
              <div>弱い票ポイント: {formatRating(myHistory.weakVotePointsUsed)}</div>
              <div>投票ポイント: +{formatRating(myHistory.votePoints)}</div>
              <div>勝利ポイント: +{formatRating(myHistory.winBonusUsed)}</div>
              <div>XP: {myHistory.areaXpUsed}</div>
              <div>XP倍率: x{formatRating(myHistory.xpMultiplierUsed)}</div>
              <div>増加: +{formatRating(myHistory.finalDelta)}</div>
              <div>試合後レート: {formatRating(myHistory.ratingAfter)}</div>
            </dl>
          </section>
        )}

        {isAdmin && (
          <>
            <AdminMatchActions matchId={match.id} />
            <section className="rounded-md border border-zinc-300 bg-white p-4">
              <h2 className="text-lg font-semibold">ADMIN確認</h2>
              <div className="mt-3 grid gap-2 text-sm">
                <p>winnerTeam: {match.winnerTeam ?? "未確定"}</p>
                <p>ratingAppliedAt: {match.ratingAppliedAt?.toLocaleString("ja-JP") ?? "未適用"}</p>
                <p>votingClosedAt: {match.votingClosedAt?.toLocaleString("ja-JP") ?? "受付中"}</p>
                <p>Config Version: {match.ratingConfigVersion}</p>
                <p>投票済み: {voteSubmittedUserIds.size} / 8</p>
              </div>
              <h3 className="mt-4 font-semibold">勝敗報告</h3>
              <ul className="mt-2 grid gap-1 text-sm">
                {match.players.map((player) => {
                  const report = match.resultReports.find((item) => item.userId === player.userId);
                  return (
                    <li key={player.userId}>
                      {player.user.discordUsername ?? player.user.name ?? player.userId}: {report?.reportedWinnerTeam ?? "未報告"}
                    </li>
                  );
                })}
              </ul>
              <h3 className="mt-4 font-semibold">PlayerVote提出状況</h3>
              <ul className="mt-2 grid gap-1 text-sm">
                {match.players.map((player) => (
                  <li key={player.userId}>
                    {player.user.discordUsername ?? player.user.name ?? player.userId}:{" "}
                    {voteSubmittedUserIds.has(player.userId) ? "提出済み" : "未提出"}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </section>
    </main>
  );
}
