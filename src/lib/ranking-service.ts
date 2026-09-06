import { Prisma, type TournamentParticipant, type TournamentPhaseType, type User, type WeaponGroup } from "@prisma/client";

import { formatRating } from "@/lib/format";
import { prisma } from "@/lib/prisma";

type RankedParticipant = TournamentParticipant & {
  user: Pick<User, "id" | "name" | "discordUsername"> & { avatarUrl?: string | null };
};

export type RankingRow = {
  rank: number;
  userId: string;
  playerName: string | null;
  discordUsername: string | null;
  avatarUrl: string | null;
  rating: string;
  wins: number;
  losses: number;
  matchesPlayed: number;
  areaXp: number;
  weaponGroup: WeaponGroup;
  participantName: string;
  isDummy: boolean;
  winningStreak: number;
  losingStreak: number;
  streakBadge: string | null;
  finalRank: number | null;
  advancedToMainEvent: boolean;
  tournamentParticipantId: string;
  participant: RankedParticipant;
  currentPhase?: {
    id: string;
    phaseType: string;
    status: string;
    requiredMatchesPerPlayer: number;
    confirmedMatchesInPhase: number;
    remainingMatchesInPhase: number;
  } | null;
};

type TournamentRankingBlock = {
  phaseId: string;
  phaseType: TournamentPhaseType;
  blockId: string;
  blockName: string;
  rows: RankingRow[];
};

export type AdvancementTiePolicy = "NEEDS_ADMIN_DECISION";

export const ADVANCEMENT_TIE_POLICY: AdvancementTiePolicy = "NEEDS_ADMIN_DECISION";

export type AdvancementCandidates =
  | {
      status: "READY";
      autoAdvanceRows: RankingRow[];
      boundaryTieRows: [];
      requiredAdminSelections: 0;
      advancePlayerCount: number;
    }
  | {
      status: "NEEDS_ADMIN_DECISION";
      autoAdvanceRows: RankingRow[];
      boundaryTieRows: RankingRow[];
      requiredAdminSelections: number;
      advancePlayerCount: number;
    };

export type BlockAdvancementCandidates = {
  status: "READY" | "NEEDS_ADMIN_DECISION";
  blocks: Array<{
    blockId: string;
    blockName: string;
    advancePlayerCount: number;
    autoAdvanceRows: RankingRow[];
    boundaryTieRows: RankingRow[];
    requiredAdminSelections: number;
    status: "READY" | "NEEDS_ADMIN_DECISION";
  }>;
  totalAdvancePlayerCount: number;
};

const TOURNAMENT_RANKINGS_TTL_MS = 20_000;
const tournamentRankingCache = new Map<string, { expiresAt: number; value: Promise<{ overall: RankingRow[]; blocks: TournamentRankingBlock[] }> }>();

type PhaseForRanking = {
  id: string;
  tournamentId: string;
  phaseType: TournamentPhaseType;
  status: string;
  requiredMatchesPerPlayer: number;
};

export function assignCompetitionRanks(participants: RankedParticipant[]): RankingRow[] {
  const rows: RankingRow[] = [];
  let previousRating: Prisma.Decimal | null = null;
  let currentRank = 0;

  participants.forEach((participant, index) => {
    const rating = new Prisma.Decimal(participant.rating ?? 0);
    if (!previousRating || !rating.equals(previousRating)) {
      currentRank = index + 1;
      previousRating = rating;
    }

    rows.push({
      rank: currentRank,
      userId: participant.userId,
      playerName: participant.user.name,
      discordUsername: participant.user.discordUsername,
      avatarUrl: participant.user.avatarUrl ?? null,
      rating: formatRating(rating),
      wins: participant.wins,
      losses: participant.losses,
      matchesPlayed: participant.matchesPlayed,
      areaXp: participant.areaXp,
      weaponGroup: participant.weaponGroup,
      participantName: participant.participantName,
      isDummy: participant.isDummy,
      winningStreak: participant.winningStreak,
      losingStreak: participant.losingStreak,
      streakBadge:
        participant.winningStreak >= 3
          ? `🔥 ${participant.winningStreak}連勝`
          : participant.losingStreak >= 3
            ? `▼ ${participant.losingStreak}連敗`
            : null,
      finalRank: participant.finalRank,
      advancedToMainEvent: participant.advancedToMainEvent,
      tournamentParticipantId: participant.id,
      participant,
    });
  });

  return rows;
}

async function buildPhaseScopedRows(phase: PhaseForRanking, participants: RankedParticipant[]) {
  const userIds = participants.map((participant) => participant.userId);
  const [histories, matchPlayers] = await Promise.all([
    prisma.ratingHistory.findMany({
      where: { userId: { in: userIds }, match: { phaseId: phase.id, status: "CONFIRMED" } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.matchPlayer.findMany({
      where: { userId: { in: userIds }, match: { phaseId: phase.id, status: "CONFIRMED" } },
      select: { userId: true, team: true, match: { select: { winnerTeam: true } } },
    }),
  ]);
  const latestRatingByUserId = new Map<string, Prisma.Decimal>();
  for (const history of histories) {
    latestRatingByUserId.set(history.userId, history.ratingAfter);
  }
  const statsByUserId = new Map<string, { wins: number; losses: number; matchesPlayed: number }>();
  for (const player of matchPlayers) {
    const stats = statsByUserId.get(player.userId) ?? { wins: 0, losses: 0, matchesPlayed: 0 };
    stats.matchesPlayed += 1;
    if (player.match.winnerTeam === player.team) stats.wins += 1;
    if (player.match.winnerTeam && player.match.winnerTeam !== player.team) stats.losses += 1;
    statsByUserId.set(player.userId, stats);
  }

  const scopedParticipants = participants.map((participant) => {
    const stats = statsByUserId.get(participant.userId) ?? { wins: 0, losses: 0, matchesPlayed: 0 };
    return {
      ...participant,
      rating: latestRatingByUserId.get(participant.userId) ?? participant.rating,
      wins: stats.wins,
      losses: stats.losses,
      matchesPlayed: stats.matchesPlayed,
    };
  });

  const rows = assignCompetitionRanks(
    scopedParticipants.sort((left, right) => new Prisma.Decimal(right.rating ?? 0).comparedTo(left.rating ?? 0)),
  );

  return rows.map((row) => ({
    ...row,
    currentPhase: {
      id: phase.id,
      phaseType: phase.phaseType,
      status: phase.status,
      requiredMatchesPerPlayer: phase.requiredMatchesPerPlayer,
      confirmedMatchesInPhase: row.matchesPlayed,
      remainingMatchesInPhase: Math.max(phase.requiredMatchesPerPlayer - row.matchesPlayed, 0),
    },
  }));
}

async function confirmedCountsByUser(phaseId: string, userIds: string[]) {
  if (userIds.length === 0) return new Map<string, number>();

  const counts = await prisma.matchPlayer.groupBy({
    by: ["userId"],
    where: {
      userId: { in: userIds },
      match: { phaseId, status: "CONFIRMED" },
    },
    _count: { userId: true },
  });

  return new Map(counts.map((count) => [count.userId, count._count.userId]));
}

export async function getPhaseTargetParticipants(phaseId: string) {
  const phase = await prisma.tournamentPhase.findUnique({
    where: { id: phaseId },
    include: {
      participants: {
        where: { isEligible: true },
        include: {
          tournamentParticipant: {
            include: { user: { select: { id: true, name: true, discordUsername: true, avatarUrl: true } } },
          },
        },
      },
    },
  });

  if (!phase) return null;

  if (phase.participants.length > 0) {
    return {
      phase,
      participants: phase.participants.map((item) => item.tournamentParticipant).filter((item) => item.isActive),
    };
  }

  const where =
    phase.phaseType === "MAIN_EVENT"
      ? { tournamentId: phase.tournamentId, isActive: true, advancedToMainEvent: true, rating: { not: null } }
      : { tournamentId: phase.tournamentId, isActive: true, rating: { not: null } };

  const participants = await prisma.tournamentParticipant.findMany({
    where,
    include: { user: { select: { id: true, name: true, discordUsername: true, avatarUrl: true } } },
    orderBy: { rating: "desc" },
  });

  return { phase, participants };
}

export async function getPhaseRanking(phaseId: string) {
  const target = await getPhaseTargetParticipants(phaseId);
  if (!target) return null;

  return {
    phase: target.phase,
    rows: await buildPhaseScopedRows(target.phase, target.participants),
  };
}

async function loadTournamentRankings(tournamentId: string) {
  const allParticipants = await prisma.tournamentParticipant.findMany({
    where: {
      tournamentId,
      isActive: true,
      rating: { not: null },
    },
    include: {
      user: {
        select: { id: true, name: true, discordUsername: true, avatarUrl: true },
      },
    },
    orderBy: { rating: "desc" },
  });
  const activePhase = await prisma.tournamentPhase.findFirst({
    where: { tournamentId, status: "ACTIVE" },
    orderBy: { sortOrder: "asc" },
  });
  const displayPhase =
    activePhase ??
    (await prisma.tournamentPhase.findFirst({
      where: { tournamentId, phaseType: "MAIN_EVENT", status: "COMPLETED" },
      orderBy: { sortOrder: "desc" },
    })) ??
    (await prisma.tournamentPhase.findFirst({
      where: { tournamentId, phaseType: "QUALIFIER", status: "COMPLETED" },
      orderBy: { sortOrder: "desc" },
    }));
  const displayPhaseTarget = displayPhase ? await getPhaseTargetParticipants(displayPhase.id) : null;
  const rows = displayPhaseTarget
    ? await buildPhaseScopedRows(displayPhaseTarget.phase, displayPhaseTarget.participants)
    : assignCompetitionRanks(allParticipants);

  if (activePhase && !displayPhaseTarget) {
    const counts = await confirmedCountsByUser(activePhase.id, rows.map((row) => row.userId));
    for (const row of rows) {
      const confirmedMatchesInPhase = counts.get(row.userId) ?? 0;
      row.currentPhase = {
        id: activePhase.id,
        phaseType: activePhase.phaseType,
        status: activePhase.status,
        requiredMatchesPerPlayer: activePhase.requiredMatchesPerPlayer,
        confirmedMatchesInPhase,
        remainingMatchesInPhase: Math.max(activePhase.requiredMatchesPerPlayer - confirmedMatchesInPhase, 0),
      };
    }
  }

  const phases = await prisma.tournamentPhase.findMany({
    where: { tournamentId },
    include: {
      blocks: {
        include: {
          participants: {
            include: {
              tournamentParticipant: {
                include: { user: { select: { id: true, name: true, discordUsername: true, avatarUrl: true } } },
              },
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  const blocks: TournamentRankingBlock[] = [];
  for (const phase of phases) {
    for (const block of phase.blocks) {
      const participants = block.participants
        .map((item) => item.tournamentParticipant)
        .filter((participant) => participant.isActive && participant.rating !== null);
      blocks.push({
        phaseId: phase.id,
        phaseType: phase.phaseType,
        blockId: block.id,
        blockName: block.name,
        rows: await buildPhaseScopedRows(phase, participants),
      });
    }
  }

  return { overall: rows, blocks };
}

export async function getTournamentRankings(tournamentId: string) {
  if (process.env.NODE_ENV === "test") {
    return loadTournamentRankings(tournamentId);
  }

  const cached = tournamentRankingCache.get(tournamentId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = loadTournamentRankings(tournamentId).catch((error) => {
    tournamentRankingCache.delete(tournamentId);
    throw error;
  });
  tournamentRankingCache.set(tournamentId, { expiresAt: Date.now() + TOURNAMENT_RANKINGS_TTL_MS, value });
  return value;
}

export function buildOverallAdvancementCandidates(rows: RankingRow[], advancePlayerCount: number): AdvancementCandidates {
  const selectedByRank = rows.filter((row) => row.rank <= advancePlayerCount);
  if (selectedByRank.length <= advancePlayerCount) {
    return {
      status: "READY",
      autoAdvanceRows: selectedByRank,
      boundaryTieRows: [],
      requiredAdminSelections: 0,
      advancePlayerCount,
    };
  }

  const boundaryRank = rows[advancePlayerCount - 1]?.rank;
  const boundaryTieRows = boundaryRank ? rows.filter((row) => row.rank === boundaryRank) : [];
  const autoAdvanceRows = rows.filter((row) => row.rank < (boundaryRank ?? 0));

  return {
    status: ADVANCEMENT_TIE_POLICY,
    autoAdvanceRows,
    boundaryTieRows,
    requiredAdminSelections: advancePlayerCount - autoAdvanceRows.length,
    advancePlayerCount,
  };
}

export function buildBlockAdvancementCandidates(
  blocks: Array<{ blockId: string; blockName: string; advancePlayerCount: number | null; rows: RankingRow[] }>,
): BlockAdvancementCandidates {
  const blockPreviews = blocks.map((block) => {
    const advancePlayerCount = block.advancePlayerCount && block.advancePlayerCount > 0 ? block.advancePlayerCount : block.rows.length;
    const preview = buildOverallAdvancementCandidates(block.rows, advancePlayerCount);
    return {
      blockId: block.blockId,
      blockName: block.blockName,
      advancePlayerCount,
      autoAdvanceRows: preview.autoAdvanceRows,
      boundaryTieRows: preview.boundaryTieRows,
      requiredAdminSelections: preview.requiredAdminSelections,
      status: preview.status,
    };
  });

  return {
    status: blockPreviews.some((block) => block.status === "NEEDS_ADMIN_DECISION")
      ? "NEEDS_ADMIN_DECISION"
      : "READY",
    blocks: blockPreviews,
    totalAdvancePlayerCount: blockPreviews.reduce((sum, block) => sum + block.advancePlayerCount, 0),
  };
}

export async function filterTournamentRankingsForViewer(params: {
  tournamentId: string;
  rankings: Awaited<ReturnType<typeof getTournamentRankings>>;
  viewerUserId?: string | null;
  isAdmin?: boolean;
}) {
  if (params.isAdmin) return params.rankings;

  const tournament = await prisma.tournament.findUnique({
    where: { id: params.tournamentId },
    select: { rankingVisibility: true },
  });
  const visibility = tournament?.rankingVisibility ?? "ALL";

  if (visibility === "ALL") return params.rankings;
  if (visibility === "OVERALL_ONLY") return { overall: params.rankings.overall, blocks: [] };
  if (visibility === "OWN_AND_OTHER_BLOCKS") return { overall: [], blocks: params.rankings.blocks };
  if (!params.viewerUserId) return { overall: [], blocks: [] };

  const ownMemberships = await prisma.tournamentBlockParticipant.findMany({
    where: {
      tournamentParticipant: {
        tournamentId: params.tournamentId,
        userId: params.viewerUserId,
      },
    },
    select: { blockId: true },
  });
  const ownBlockIds = new Set(ownMemberships.map((membership) => membership.blockId));

  return {
    overall: [],
    blocks: params.rankings.blocks.filter((block) => ownBlockIds.has(block.blockId)),
  };
}
