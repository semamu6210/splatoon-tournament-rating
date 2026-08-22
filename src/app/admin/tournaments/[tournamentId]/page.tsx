import Link from "next/link";

import { AdvancementConfirmForm } from "@/components/advancement-confirm-form";
import { AuthControls } from "@/components/auth-controls";
import { ApiButton } from "@/components/api-button";
import { BlockManagementPanel } from "@/components/block-management-panel";
import { MatchmakingRunButton } from "@/components/matchmaking-run-button";
import { PhaseForm } from "@/components/phase-form";
import { RatingConfigForm } from "@/components/rating-config-form";
import { RankingTabs } from "@/components/ranking-tabs";
import { TournamentDeleteButton } from "@/components/tournament-delete-button";
import { TournamentForm } from "@/components/tournament-form";
import { TestDummyPanel } from "@/components/test-dummy-panel";
import { auth } from "@/auth";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { getTournamentOperationWarnings } from "@/lib/operations-monitor";
import { getTournamentRankings } from "@/lib/ranking-service";
import { getPhaseReadiness, getQualifierAdvancementPreview } from "@/lib/phase-service";
import { serializeRatingConfig } from "@/lib/serializers";
import { getTestDummyPhaseStatuses } from "@/lib/test-dummy-queue";
import { advancementModeLabel, matchStatusLabel, tournamentPhaseStatusLabel, tournamentPhaseTypeLabel, tournamentStatusLabel } from "@/lib/labels";

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
    isDummy: row.isDummy,
    currentPhase: row.currentPhase,
  };
}

function plainAdvancementPreview(preview: Awaited<ReturnType<typeof getQualifierAdvancementPreview>> | null) {
  if (!preview) return null;
  if ("blocks" in preview) {
    return {
      status: preview.status as "READY" | "NEEDS_ADMIN_DECISION",
      blocks: preview.blocks.map((block) => ({
        blockId: block.blockId,
        blockName: block.blockName,
        advancePlayerCount: block.advancePlayerCount,
        autoAdvanceRows: plainAdvancementRows(block.autoAdvanceRows),
        boundaryTieRows: plainAdvancementRows(block.boundaryTieRows),
        requiredAdminSelections: block.requiredAdminSelections,
        status: block.status,
      })),
      totalAdvancePlayerCount: preview.totalAdvancePlayerCount,
    };
  }
  if (preview.status === "READY") {
    return {
      status: "READY" as const,
      autoAdvanceRows: plainAdvancementRows(preview.autoAdvanceRows),
      boundaryTieRows: plainAdvancementRows(preview.boundaryTieRows),
      requiredAdminSelections: preview.requiredAdminSelections,
      advancePlayerCount: preview.advancePlayerCount,
    };
  }
  return {
    status: "NEEDS_ADMIN_DECISION" as const,
    autoAdvanceRows: plainAdvancementRows(preview.autoAdvanceRows),
    boundaryTieRows: plainAdvancementRows(preview.boundaryTieRows),
    requiredAdminSelections: preview.requiredAdminSelections,
    advancePlayerCount: preview.advancePlayerCount,
  };
}

function plainAdvancementRows(rows: Awaited<ReturnType<typeof getTournamentRankings>>["overall"]) {
  return rows.map((row) => ({
    tournamentParticipantId: row.tournamentParticipantId,
    userId: row.userId,
    playerName: row.playerName,
    discordUsername: row.discordUsername,
    rank: row.rank,
    rating: row.rating,
  }));
}

function previewRequiredSelections(preview: Awaited<ReturnType<typeof getQualifierAdvancementPreview>> | null) {
  if (!preview) return 0;
  return "blocks" in preview
    ? preview.blocks.reduce((sum, block) => sum + block.requiredAdminSelections, 0)
    : preview.requiredAdminSelections;
}

function previewBoundaryLabels(preview: Awaited<ReturnType<typeof getQualifierAdvancementPreview>> | null) {
  if (!preview) return "";
  const rows = "blocks" in preview ? preview.blocks.flatMap((block) => block.boundaryTieRows) : preview.boundaryTieRows;
  return rows.map((row) => row.discordUsername ?? row.playerName ?? row.userId).join(", ");
}

function previewAutoLabels(preview: Awaited<ReturnType<typeof getQualifierAdvancementPreview>> | null) {
  if (!preview) return "";
  const rows = "blocks" in preview ? preview.blocks.flatMap((block) => block.autoAdvanceRows) : preview.autoAdvanceRows;
  return rows.map((row) => row.discordUsername ?? row.playerName ?? row.userId).join(", ");
}

export default async function AdminTournamentPage({ params }: PageProps) {
  const { tournamentId } = await params;
  const session = await auth();
  const allowed = session?.user ? canManage(session.user.role) : false;

  const tournament = allowed
    ? await prisma.tournament.findUnique({
        where: { id: tournamentId },
        include: {
          participants: {
            include: {
              user: {
                select: { id: true, name: true, discordUsername: true, role: true },
              },
            },
            orderBy: { joinedAt: "asc" },
          },
          phases: {
            include: {
              queueEntries: {
                where: { status: "WAITING" },
                include: {
                  user: {
                    select: { id: true, name: true, discordUsername: true },
                  },
                },
                orderBy: { joinedAt: "asc" },
              },
              matches: {
                orderBy: { createdAt: "desc" },
                take: 5,
                include: {
                  players: true,
                },
              },
              blocks: { include: { participants: true }, orderBy: { sortOrder: "asc" } },
              participants: true,
            },
            orderBy: { sortOrder: "asc" },
          },
          stages: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
        },
      })
    : null;

  if (!allowed) {
    return (
      <main className="px-5 py-8">
        <AuthControls />
        <p className="mt-4 text-red-700">管理者またはオーナー権限が必要です。</p>
      </main>
    );
  }

  if (!tournament) {
    return (
      <main className="px-5 py-8">
        <p>大会が見つかりません。</p>
      </main>
    );
  }

  const activeRatingConfig = await prisma.tournamentRatingConfig.findFirst({
    where: { tournamentId: tournament.id, isActive: true },
    include: { xpMultiplierTiers: { orderBy: { sortOrder: "asc" } } },
  });
  const activeConfig = activeRatingConfig ? serializeRatingConfig(activeRatingConfig) : null;
  const rankings = await getTournamentRankings(tournament.id);
  const operationWarnings = await getTournamentOperationWarnings(tournament.id);
  const testDummyStatuses = tournament.isTestTournament ? await getTestDummyPhaseStatuses(tournament.id) : [];
  const tabRankings = {
    overall: rankings.overall.map(plainRankingRow),
    blocks: rankings.blocks.map((block) => ({
      ...block,
      rows: block.rows.map(plainRankingRow),
    })),
  };
  const readinessByPhaseId = new Map(
    await Promise.all(tournament.phases.map(async (phase) => [phase.id, await getPhaseReadiness(phase.id)] as const)),
  );
  const advancementByPhaseId = new Map(
    await Promise.all(
      tournament.phases
        .filter((phase) => phase.phaseType === "QUALIFIER" && phase.advancePlayerCount)
        .map(async (phase) => {
          try {
            return [phase.id, await getQualifierAdvancementPreview(phase.id)] as const;
          } catch {
            return [phase.id, null] as const;
          }
        }),
    ),
  );
  const waitingCount = tournament.phases.reduce((sum, phase) => sum + phase.queueEntries.length, 0);
  const unfinishedMatchCount = tournament.phases.reduce(
    (sum, phase) =>
      sum +
      phase.matches.filter((match) => ["CREATED", "PLAYING", "RESULT_REPORTING", "VOTE_REPORTING"].includes(match.status)).length,
    0,
  );
  const unvotedMatchCount = tournament.phases.reduce(
    (sum, phase) => sum + phase.matches.filter((match) => match.status === "VOTE_REPORTING").length,
    0,
  );

  return (
    <main className="min-h-screen px-5 py-8">
      <section className="mx-auto grid max-w-5xl gap-6">
        <header className="flex flex-col gap-4 border-b border-zinc-300 pb-5">
          <Link className="text-sm text-zinc-600" href="/admin">← 管理</Link>
          <div>
            <h1 className="text-3xl font-bold">{tournament.name}</h1>
            <p className="mt-2 text-sm text-zinc-600">{tournamentStatusLabel[tournament.status]}</p>
          </div>
          <AuthControls />
        </header>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="mb-4 text-xl font-semibold">大会基本編集</h2>
          <TournamentForm
            initialEndsAt={tournament.endsAt?.toISOString() ?? null}
            initialName={tournament.name}
            initialIsTestTournament={tournament.isTestTournament}
            initialRankingVisibility={tournament.rankingVisibility}
            initialStagePoolEnabled={tournament.stagePoolEnabled}
            initialStageNames={tournament.stages.map((stage) => stage.name)}
            initialStartsAt={tournament.startsAt?.toISOString() ?? null}
            canEditTestTournament={tournament.status === "DRAFT"}
            mode="edit"
            tournamentId={tournament.id}
          />
        </section>

        <TournamentDeleteButton tournamentId={tournament.id} tournamentName={tournament.name} />

        {tournament.isTestTournament && (
          <TestDummyPanel
            canDelete={tournament.status === "DRAFT" || tournament.status === "REGISTRATION"}
            statuses={testDummyStatuses}
            tournamentId={tournament.id}
          />
        )}

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-xl font-semibold">運営ダッシュボード</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>大会状態: {tournamentStatusLabel[tournament.status]}</div>
            <div>現在フェーズ: {tournament.phases.find((phase) => phase.status === "ACTIVE")?.phaseType ? tournamentPhaseTypeLabel[tournament.phases.find((phase) => phase.status === "ACTIVE")!.phaseType] : "-"}</div>
            <div>参加者数: {tournament.participants.filter((participant) => participant.isActive).length}</div>
            <div>WAITING数: {waitingCount}</div>
            <div>未確定Match数: {unfinishedMatchCount}</div>
            <div>未投票Match数: {unvotedMatchCount}</div>
            <div>警告数: {operationWarnings.length}</div>
          </dl>
          {operationWarnings.length > 0 && (
            <ul className="mt-3 grid gap-1 text-sm text-red-700">
              {operationWarnings.map((warning) => (
                <li key={`${warning.type}-${warning.targetId}`}>
                  {warning.type}: {warning.message} / {warning.targetId}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="mb-4 text-xl font-semibold">フェーズ作成</h2>
          <PhaseForm mode="create" stages={tournament.stages} tournamentId={tournament.id} />
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-xl font-semibold">マッチング管理</h2>
          <div className="mt-4 grid gap-4">
            {tournament.phases.length === 0 && (
              <p className="text-sm text-zinc-600">フェーズがありません。上のフォームからフェーズを作成してください。</p>
            )}
            {tournament.phases.map((phase) => (
              <div className="rounded-md border border-zinc-200 p-4" key={phase.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{tournamentPhaseTypeLabel[phase.phaseType]}</h3>
                    <p className="text-sm text-zinc-600">
                      {tournamentPhaseStatusLabel[phase.status]} / 必要試合数 {phase.requiredMatchesPerPlayer}
                      {phase.advancePlayerCount ? ` / 進出 ${phase.advancePlayerCount}位まで` : ""} / {advancementModeLabel[phase.advancementMode]}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {phase.status === "PENDING" && <ApiButton url={`/api/phases/${phase.id}/start`}>フェーズ開始</ApiButton>}
                    {phase.status === "ACTIVE" && <MatchmakingRunButton phaseId={phase.id} />}
                    {phase.status === "ACTIVE" && <ApiButton url={`/api/phases/${phase.id}/complete`}>フェーズ終了</ApiButton>}
                  </div>
                </div>
                {phase.status === "PENDING" && (
                  <div className="mt-3 rounded-md border border-zinc-200 p-3">
                    <h4 className="mb-3 text-sm font-semibold">フェーズ編集</h4>
                    <PhaseForm
                      initial={{
                        phaseType: phase.phaseType,
                        requiredMatchesPerPlayer: phase.requiredMatchesPerPlayer,
                        advancePlayerCount: phase.advancePlayerCount,
                        advancementMode: phase.advancementMode,
                        rule: phase.rule,
                        stageSelectionMode: phase.stageSelectionMode,
                        defaultStageId: phase.defaultStageId,
                        sortOrder: phase.sortOrder,
                      }}
                      mode="edit"
                      phaseId={phase.id}
                      stages={tournament.stages}
                    />
                  </div>
                )}
                {readinessByPhaseId.get(phase.id)?.canComplete ? (
                  <p className="mt-3 text-sm font-semibold text-green-700">全員規定試合数完了・フェーズを終了できます。</p>
                ) : (
                  <p className="mt-3 text-sm text-zinc-600">
                    完了状況: {readinessByPhaseId.get(phase.id)?.rows.filter((row) => row.complete).length ?? 0}/
                    {readinessByPhaseId.get(phase.id)?.rows.length ?? 0} / 未確定Match{" "}
                    {readinessByPhaseId.get(phase.id)?.unfinishedMatches ?? 0} / 待機中{" "}
                    {readinessByPhaseId.get(phase.id)?.waitingQueueEntries ?? 0}
                  </p>
                )}
                {advancementByPhaseId.get(phase.id)?.status === "NEEDS_ADMIN_DECISION" && (
                  <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-semibold">同率境界警告: NEEDS_ADMIN_DECISION</p>
                    <p>選択が必要な人数: {previewRequiredSelections(advancementByPhaseId.get(phase.id) ?? null)}</p>
                    <p>
                      境界同順位: {previewBoundaryLabels(advancementByPhaseId.get(phase.id) ?? null)}
                    </p>
                  </div>
                )}
                {advancementByPhaseId.get(phase.id)?.status === "READY" && (
                  <p className="mt-3 text-sm text-green-700">
                    自動進出対象: {previewAutoLabels(advancementByPhaseId.get(phase.id) ?? null)}
                  </p>
                )}
                {phase.status === "COMPLETED" && phase.phaseType === "QUALIFIER" && (
                  <AdvancementConfirmForm
                    phaseId={phase.id}
                    preview={plainAdvancementPreview(advancementByPhaseId.get(phase.id) ?? null)}
                  />
                )}
                <BlockManagementPanel
                  blocks={phase.blocks}
                  participants={tournament.participants
                    .filter((participant) => participant.isActive)
                    .map((participant) => ({
                      id: participant.id,
                      userId: participant.userId,
                      label: `${participant.participantName}${participant.isDummy ? "（テスト参加者）" : ""}`,
                    }))}
                  phaseId={phase.id}
                  phaseStatus={phase.status}
                />
                <p className="mt-3 text-sm font-semibold">待機中人数: {phase.queueEntries.length}</p>
                <ul className="mt-2 grid gap-1 text-sm text-zinc-700">
                  {phase.queueEntries.map((entry) => (
                    <li key={entry.id}>
                      {entry.user.discordUsername ?? entry.user.name ?? entry.userId} / {entry.joinedAt.toLocaleString("ja-JP")}
                    </li>
                  ))}
                </ul>
                <h4 className="mt-4 text-sm font-semibold">最近作成されたMatch</h4>
                <ul className="mt-2 grid gap-1 text-sm text-zinc-700">
                  {phase.matches.map((match) => (
                    <li key={match.id}>
                      <Link className="underline" href={`/matches/${match.id}`}>{match.id}</Link> / {matchStatusLabel[match.status]} / 使用ステージ {match.stageName ?? "未設定"} / {match.players.length}人
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-3 rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-xl font-semibold">状態操作</h2>
          <div className="flex flex-wrap gap-3">
            <ApiButton url={`/api/tournaments/${tournament.id}/open-registration`}>参加受付開始</ApiButton>
            <ApiButton url={`/api/tournaments/${tournament.id}/start`}>大会開始</ApiButton>
            <ApiButton url={`/api/tournaments/${tournament.id}/finish`}>大会終了・finalRank保存</ApiButton>
          </div>
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-xl font-semibold">使用ステージ</h2>
          <p className="mt-2 text-sm text-zinc-600">
            ステージプール: {tournament.stagePoolEnabled ? "有効" : "無効"} / 登録済み: {tournament.stages.map((stage) => stage.name).join(" / ") || "なし"}
          </p>
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="mb-4 text-xl font-semibold">レート設定 / XP倍率設定</h2>
          <RatingConfigForm current={activeConfig} tournamentId={tournament.id} />
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-xl font-semibold">全体ランキング</h2>
          <div className="mt-3">
            <RankingTabs blocks={tabRankings.blocks} overall={tabRankings.overall} showFinalRank />
          </div>
        </section>

        <section className="rounded-md border border-zinc-300 bg-white p-4">
          <h2 className="text-xl font-semibold">参加者一覧</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-96 text-left text-sm">
              <thead className="bg-zinc-100 text-zinc-600">
                <tr>
                  <th className="px-3 py-2">参加者</th>
                  <th className="px-3 py-2">XP</th>
                  <th className="px-3 py-2">ブロック</th>
                  <th className="px-3 py-2">現在レート</th>
                  <th className="px-3 py-2">本戦</th>
                  <th className="px-3 py-2">最終順位</th>
                  <th className="px-3 py-2">参加状態</th>
                </tr>
              </thead>
              <tbody>
                {tournament.participants.map((participant) => (
                  <tr className="border-t border-zinc-200" key={participant.id}>
                    <td className="px-3 py-2">
                      {participant.participantName}{" "}
                      {participant.isDummy && <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">テスト参加者</span>}{" "}
                      {participant.winningStreak >= 3
                        ? `🔥 ${participant.winningStreak}連勝`
                        : participant.losingStreak >= 3
                          ? `▼ ${participant.losingStreak}連敗`
                          : ""}
                    </td>
                    <td className="px-3 py-2">{participant.areaXp}</td>
                    <td className="px-3 py-2">{participant.blockName ?? "-"}</td>
                    <td className="px-3 py-2">{participant.rating?.toString() ?? "未初期化"}</td>
                    <td className="px-3 py-2">{participant.advancedToMainEvent ? "対象" : "-"}</td>
                    <td className="px-3 py-2">{participant.finalRank ?? "-"}</td>
                    <td className="px-3 py-2">{participant.isActive ? "参加中" : "取消済み"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}
