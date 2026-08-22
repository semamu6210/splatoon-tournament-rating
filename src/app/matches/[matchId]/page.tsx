import Link from "next/link";
import Image from "next/image";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { AdminMatchActions } from "@/components/admin-match-actions";
import { ApiButton } from "@/components/api-button";
import { AuthControls } from "@/components/auth-controls";
import { MatchStatusRefresh } from "@/components/match-status-refresh";
import { MatchPlayingActions } from "@/components/match-playing-actions";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerVoteForm } from "@/components/player-vote-form";
import { ResultReportForm } from "@/components/result-report-form";
import { auth } from "@/auth";
import { formatRating } from "@/lib/format";
import { matchRuleLabel, matchStatusLabel, teamLabel, tournamentPhaseTypeLabel } from "@/lib/labels";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { stageImagePath } from "@/lib/stages";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ matchId: string }>;
};

function publicImageExists(imagePath: string | null) {
  if (!imagePath?.startsWith("/stages/")) return false;
  return existsSync(join(process.cwd(), "public", imagePath.slice(1)));
}

export default async function MatchPage({ params }: PageProps) {
  const { matchId } = await params;
  const session = await auth();
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: {
        include: {
          user: {
            select: { id: true, name: true, discordUsername: true, avatarUrl: true },
          },
        },
        orderBy: [{ team: "asc" }, { userId: "asc" }],
      },
      resultReports: true,
      playerVotes: true,
      ratingHistories: true,
      tournament: { select: { name: true, isTestTournament: true } },
      stage: true,
      phase: { select: { phaseType: true, rule: true } },
      roomHost: { select: { id: true, name: true, discordUsername: true, avatarUrl: true } },
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
  const myTeamPlayers = myPlayer ? match.players.filter((player) => player.team === myPlayer.team) : [];
  const opponentPlayers = myPlayer ? match.players.filter((player) => player.team !== myPlayer.team) : [];
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId: match.tournamentId, userId: { in: match.players.map((player) => player.userId) } },
  });
  const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant]));
  const stages = isAdmin
    ? await prisma.tournamentStage.findMany({ where: { tournamentId: match.tournamentId, isActive: true }, orderBy: { sortOrder: "asc" } })
    : [];
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
          label: `${participantByUserId.get(player.userId)?.participantName ?? player.user.discordUsername ?? player.user.name ?? player.userId}${participantByUserId.get(player.userId)?.isDummy ? "（テスト参加者）" : ""}`,
        }))
    : [];
  const myHistory = user ? match.ratingHistories.find((history) => history.userId === user.id) : null;
  const completeVoteSubmittedUserIds = new Set(
    match.players
      .filter((player) => {
        const votes = match.playerVotes.filter((vote) => vote.voterUserId === player.userId);
        return votes.some((vote) => vote.voteType === "STRONG") && votes.some((vote) => vote.voteType === "WEAK");
      })
      .map((player) => player.userId),
  );
  const myVotes = user ? match.playerVotes.filter((vote) => vote.voterUserId === user.id) : [];
  const myVoteComplete =
    myVotes.some((vote) => vote.voteType === "STRONG") && myVotes.some((vote) => vote.voteType === "WEAK");
  const ratingCalculationPending =
    match.status === "VOTE_REPORTING" &&
    completeVoteSubmittedUserIds.size === 8 &&
    Boolean(match.winnerTeam) &&
    !match.votingClosedAt &&
    !match.ratingAppliedAt;
  const ratingCalculationFailed =
    match.status === "VOTE_REPORTING" &&
    completeVoteSubmittedUserIds.size === 8 &&
    Boolean(match.winnerTeam) &&
    Boolean(match.votingClosedAt) &&
    !match.ratingAppliedAt;
  const imagePath = stageImagePath(match.stage?.name ?? match.stageName);
  const visibleImagePath = publicImageExists(imagePath) ? imagePath : null;
  const hostLabel = match.roomHost
    ? participantByUserId.get(match.roomHost.id)?.participantName ?? match.roomHost.name ?? match.roomHost.id
    : "未設定";
  const isRoomHost = Boolean(user && match.roomHostUserId === user.id);
  const myParticipant = myPlayer ? participantByUserId.get(myPlayer.userId) : null;
  const playerLabel = (player: (typeof match.players)[number]) =>
    participantByUserId.get(player.userId)?.participantName ?? player.user.discordUsername ?? player.user.name ?? player.userId;
  const playerCard = (player: (typeof match.players)[number], showRecent: boolean) => {
    const participant = participantByUserId.get(player.userId);
    const badge =
      participant && participant.winningStreak >= 3
        ? `🔥 ${participant.winningStreak}連勝`
        : participant && participant.losingStreak >= 3
          ? `▼ ${participant.losingStreak}連敗`
          : null;
    const rows = showRecent ? teammateHistories.filter((history) => history.userId === player.userId).slice(0, 3) : [];
    return (
      <li className="rounded-md bg-zinc-50 p-3 text-sm" key={player.id}>
        <div className="flex items-start gap-3">
          <PlayerAvatar avatarUrl={player.user.avatarUrl} name={playerLabel(player)} />
          <div className="min-w-0">
            <p className="font-semibold">
              {playerLabel(player)}{" "}
              {participant?.isDummy && <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">テスト参加者</span>}{" "}
              {badge && (
                <button className="rounded bg-zinc-100 px-2 py-1 text-xs" title={badge} type="button">
                  {badge}
                </button>
              )}
            </p>
            <p className="mt-1 text-zinc-600">
              公開レート: {formatRating(participant?.rating ?? player.ratingBefore)} / {participant?.wins ?? 0}勝{participant?.losses ?? 0}敗
            </p>
            {isAdmin && (
              <p className="mt-1 text-xs text-zinc-600">
                エリアXP: {player.areaXpAtMatch} / 連敗数: {player.losingStreakAtMatch} / 内部マッチング値:{" "}
                {formatRating(player.matchingRatingAtMatch)}
              </p>
            )}
          </div>
        </div>
        {showRecent && (
          <ul className="mt-2 grid gap-1 text-xs text-zinc-600">
            {rows.map((history) => (
              <li key={history.id}>
                直近: {history.match.winnerTeam === history.team ? "勝ち" : "負け"} / 増加{" "}
                {formatRating(history.ratingAfter ? history.ratingAfter.sub(history.ratingBefore) : null)}
              </li>
            ))}
            {rows.length === 0 && <li>直近履歴なし</li>}
          </ul>
        )}
      </li>
    );
  };

  return (
    <main className="min-h-screen px-5 py-8">
      <MatchStatusRefresh initialStatus={match.status} matchId={match.id} />
      <section className="mx-auto grid max-w-4xl gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href={`/tournaments/${match.tournamentId}`}>← 大会へ</Link>
          <div>
            <h1 className="text-3xl font-bold">試合</h1>
            <p className="mt-2 text-sm text-zinc-600">
              {match.tournament.name} / {tournamentPhaseTypeLabel[match.phase.phaseType]} / {matchStatusLabel[match.status]}
            </p>
            <p className="mt-1 text-sm text-zinc-600">
              試合番号: #{match.matchNumber ?? "-"} / 第{match.roundNumber ?? "-"}試合 / ルール: {matchRuleLabel[match.rule]}
            </p>
          </div>
          <AuthControls />
        </header>

        <section className="grid gap-4 rounded-md border border-emerald-400 bg-emerald-50 p-4">
          <div>
            <p className="text-sm font-semibold text-emerald-800">マッチング成立</p>
            <h2 className="mt-1 text-2xl font-bold text-emerald-950">試合 #{match.matchNumber ?? "-"}</h2>
          </div>
          <div className="overflow-hidden rounded-md border border-zinc-200 bg-white">
            {visibleImagePath ? (
              <Image alt={`${match.stageName}のステージ画像`} className="h-auto w-full object-cover" height={720} priority src={visibleImagePath} width={1280} />
            ) : (
              <div className="flex aspect-video items-center justify-center bg-zinc-100 text-sm text-zinc-600">ステージ画像を準備中です</div>
            )}
          </div>
          <div className="grid gap-2 text-sm">
            <p>
              ステージ: <span className="font-semibold">{match.stageName ?? "未設定"}</span>
            </p>
            <p>
              ルール: <span className="font-semibold">{matchRuleLabel[match.rule]}</span>
            </p>
            <p>
              部屋コード: <span className="rounded bg-white px-2 py-1 text-xl font-bold tracking-widest text-zinc-950">{match.privateRoomCode ?? "---"}</span>
            </p>
          </div>
        </section>

        <section className={isRoomHost ? "rounded-md border-2 border-amber-500 bg-amber-50 p-4" : "rounded-md border border-zinc-300 bg-white p-4"}>
          <h2 className="text-xl font-bold">{isRoomHost ? "あなたが部屋を建ててください" : `${hostLabel}さんが部屋を作成します`}</h2>
          <p className="mt-2 text-sm text-zinc-700">
            {isRoomHost ? "プライベートマッチを作成してください。" : "部屋ができるまでお待ちください。"}
          </p>
          <p className="mt-3 text-sm">
            使用コード: <span className="rounded bg-zinc-950 px-3 py-2 text-lg font-bold tracking-widest text-white">{match.privateRoomCode ?? "---"}</span>
          </p>
        </section>

        {myPlayer && (
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-md border-2 border-emerald-500 bg-white p-4">
              <p className="text-sm font-semibold text-emerald-700">あなたのチーム</p>
              <h2 className="mt-1 text-xl font-semibold">{teamLabel[myPlayer.team]}</h2>
              <p className="mt-2 text-sm text-zinc-600">あなたは{teamLabel[myPlayer.team]}です。味方3人を確認してください。</p>
              <ul className="mt-3 grid gap-2">{myTeamPlayers.map((player) => playerCard(player, player.userId !== myPlayer.userId))}</ul>
            </section>
            <section className="rounded-md border border-zinc-300 bg-white p-4">
              <p className="text-sm font-semibold text-zinc-600">対戦相手</p>
              <h2 className="mt-1 text-xl font-semibold">{teamLabel[myPlayer.team === "A" ? "B" : "A"]}</h2>
              <ul className="mt-3 grid gap-2">{opponentPlayers.map((player) => playerCard(player, false))}</ul>
            </section>
          </div>
        )}

        {isAdmin && (
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ["A", teamA],
              ["B", teamB],
            ].map(([team, players]) => (
              <section className="rounded-md border border-zinc-300 bg-white p-4" key={team as string}>
                <h2 className="text-xl font-semibold">{teamLabel[team as "A" | "B"]}</h2>
                <ul className="mt-3 grid gap-2">{(players as typeof teamA).map((player) => playerCard(player, false))}</ul>
              </section>
            ))}
          </div>
        )}

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
                          {history.match.winnerTeam === history.team ? "勝ち" : "負け"} / 増加{" "}
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
          <section className="grid gap-3 rounded-md border border-zinc-300 bg-white p-4">
            <h2 className="text-lg font-semibold">試合中</h2>
            <MatchPlayingActions hostLabel={hostLabel} isRoomHost={isRoomHost} matchId={match.id} startedAt={match.startedAt?.toISOString() ?? null} />
          </section>
        )}

        {match.status === "RESULT_REPORTING" && myPlayer && (
          isRoomHost ? (
            <ResultReportForm matchId={match.id} />
          ) : (
            <section className="rounded-md border border-zinc-300 bg-white p-4">
              <h2 className="text-lg font-semibold">試合終了・結果入力待ち</h2>
              <p className="mt-2 text-sm text-zinc-600">部屋主の{hostLabel}さんが試合結果を入力しています。</p>
            </section>
          )
        )}

        {match.status === "VOTE_REPORTING" && myPlayer && (
          <section className="grid gap-3">
            <div className="rounded-md border border-zinc-300 bg-white p-4 text-sm">
              <p>自分の投票状態: {myVoteComplete ? "投票済み" : "未投票"}</p>
              <p>投票完了: {completeVoteSubmittedUserIds.size} / 8</p>
              <p>投票受付: {match.votingClosedAt ? `締切済み (${match.votingClosedAt.toLocaleString("ja-JP")})` : "受付中"}</p>
            </div>
            {ratingCalculationPending && (
              <div className="grid gap-1 text-sm font-semibold text-emerald-700">
                <p>全員の投票が完了しました</p>
                <p>レートを計算しています...</p>
              </div>
            )}
            {ratingCalculationFailed && isAdmin && (
              <div className="grid gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm">
                <p className="font-semibold text-red-700">レート計算に失敗しました</p>
                <ApiButton url={`/api/matches/${match.id}/apply-rating`}>
                  レート計算を再試行
                </ApiButton>
              </div>
            )}
            {!match.votingClosedAt && !myVoteComplete && <PlayerVoteForm matchId={match.id} opponents={opponents} />}
            {!match.votingClosedAt && myVoteComplete && !ratingCalculationPending && <p className="text-sm text-zinc-600">他の参加者の投票を待っています。</p>}
            {match.votingClosedAt && <p className="text-sm text-zinc-600">ADMINにより投票受付は締め切られました。</p>}
          </section>
        )}

        {match.status === "CONFIRMED" && (
          <section className="rounded-md border border-zinc-300 bg-white p-4">
            <h2 className="text-lg font-semibold">試合終了</h2>
            <p className="mt-2 text-sm font-semibold text-emerald-700">レート計算が完了しました</p>
            {myHistory && (
              <dl className="mt-3 grid gap-2 text-sm">
                <div>勝敗: {myPlayer && match.winnerTeam === myPlayer.team ? "勝利" : "敗北"}</div>
                <div>試合前レート: {formatRating(myHistory.ratingBefore)}</div>
                <div>今回の増加: +{formatRating(myHistory.finalDelta)}</div>
                <div>現在レート: {formatRating(myParticipant?.rating ?? myHistory.ratingAfter)}</div>
                <div>1票目を受けた数: {myHistory.strongVotesReceived}</div>
                <div>2票目を受けた数: {myHistory.weakVotesReceived}</div>
                <div>1票目でもらえるポイント: {formatRating(myHistory.strongVotePointsUsed)}</div>
                <div>2票目でもらえるポイント: {formatRating(myHistory.weakVotePointsUsed)}</div>
                <div>投票ポイント: +{formatRating(myHistory.votePoints)}</div>
                <div>勝利ポイント: +{formatRating(myHistory.winBonusUsed)}</div>
                <div>基本増加: +{formatRating(myHistory.baseDelta)}</div>
                <div>XP: {myHistory.areaXpUsed}</div>
                <div>XP倍率: ×{formatRating(myHistory.xpMultiplierUsed)}</div>
                {myHistory.winningStreakBonusApplied && (
                  <div>
                    3連勝ボーナス: ×{formatRating(myHistory.winningStreakBonusMultiplierUsed)} ({myHistory.winningStreakBefore}→
                    {myHistory.winningStreakAfter}連勝)
                  </div>
                )}
                {myHistory.voteCountBonusApplied && (
                  <div>
                    高得票ボーナス: ×{formatRating(myHistory.voteCountBonusMultiplierUsed)} ({myHistory.totalVotesReceived}票)
                  </div>
                )}
                <div>最終増加: +{formatRating(myHistory.finalDelta)}</div>
                <div>試合後レート: {formatRating(myHistory.ratingAfter)}</div>
              </dl>
            )}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-zinc-200 text-zinc-600">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">プレイヤー</th>
                    <th className="py-2 pr-3 font-semibold">計算前レート</th>
                    <th className="py-2 pr-3 font-semibold">今回の増加</th>
                    <th className="py-2 pr-3 font-semibold">計算後レート</th>
                  </tr>
                </thead>
                <tbody>
                  {match.players.map((player) => {
                    const history = match.ratingHistories.find((item) => item.userId === player.userId);
                    return (
                      <tr className="border-b border-zinc-100" key={player.userId}>
                        <td className="py-2 pr-3">{playerLabel(player)}</td>
                        <td className="py-2 pr-3">{formatRating(history?.ratingBefore ?? player.ratingBefore)}</td>
                        <td className="py-2 pr-3">+{formatRating(history?.finalDelta ?? null)}</td>
                        <td className="py-2 pr-3">{formatRating(history?.ratingAfter ?? player.ratingAfter)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Link className="mt-4 inline-flex rounded-md bg-zinc-950 px-4 py-2 text-sm font-semibold text-white" href={`/tournaments/${match.tournamentId}`}>
              次のマッチングへ
            </Link>
          </section>
        )}

        {isAdmin && (
          <>
            <AdminMatchActions currentStageId={match.stageId} isTestTournament={match.tournament.isTestTournament} matchId={match.id} stages={stages} />
            <section className="rounded-md border border-zinc-300 bg-white p-4">
              <h2 className="text-lg font-semibold">ADMIN確認</h2>
              <div className="mt-3 grid gap-2 text-sm">
                <p>winnerTeam: {match.winnerTeam ?? "未確定"}</p>
                <p>ratingAppliedAt: {match.ratingAppliedAt?.toLocaleString("ja-JP") ?? "未適用"}</p>
                <p>votingClosedAt: {match.votingClosedAt?.toLocaleString("ja-JP") ?? "受付中"}</p>
                <p>レート設定バージョン: {match.ratingConfigVersion}</p>
                <p>部屋コード: {match.privateRoomCode ?? "未設定"}</p>
                <p>部屋作成担当: {hostLabel}</p>
                <p>使用ステージ: {match.stageName ?? "未設定"}</p>
                <p>投票済み: {completeVoteSubmittedUserIds.size} / 8</p>
              </div>
              <h3 className="mt-4 font-semibold">勝敗報告</h3>
              <ul className="mt-2 grid gap-1 text-sm">
                {match.players.map((player) => {
                  const report = match.resultReports.find((item) => item.userId === player.userId);
                  return (
                    <li key={player.userId}>
                      {playerLabel(player)}: {report?.reportedWinnerTeam ?? "未報告"}
                    </li>
                  );
                })}
              </ul>
              <h3 className="mt-4 font-semibold">PlayerVote提出状況</h3>
              <ul className="mt-2 grid gap-1 text-sm">
                {match.players.map((player) => (
                  <li key={player.userId}>
                    {playerLabel(player)}:{" "}
                    {completeVoteSubmittedUserIds.has(player.userId) ? "提出済み" : "未提出"}
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
