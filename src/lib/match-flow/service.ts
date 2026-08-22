import { MatchStatus, Prisma, type Team, type UserRole, type VoteType } from "@prisma/client";

import { ApiError } from "@/lib/http";
import { calculatePlayerRatingResults } from "@/lib/match-flow/rating";
import { canManage } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { ensureTestDummiesWaitingForPhase } from "@/lib/test-dummy-queue";
import { submitAutomaticTestVotes } from "@/lib/test-dummy-votes";

type Tx = Prisma.TransactionClient;

const OPEN_MATCH_STATUSES: MatchStatus[] = [
  "CREATED",
  "PLAYING",
  "RESULT_REPORTING",
  "VOTE_REPORTING",
];
const RATING_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 30_000,
} as const;

function assertTeam(value: unknown): Team {
  if (value !== "A" && value !== "B") {
    throw new ApiError(400, "winnerTeam must be A or B.");
  }
  return value;
}

function validateMatchPlayers(players: Array<{ userId: string; team: Team }>) {
  if (players.length !== 8) {
    throw new ApiError(400, "Match must have exactly 8 players.");
  }
  if (new Set(players.map((player) => player.userId)).size !== 8) {
    throw new ApiError(400, "Match players must be unique.");
  }
  if (players.filter((player) => player.team === "A").length !== 4) {
    throw new ApiError(400, "Team A must have 4 players.");
  }
  if (players.filter((player) => player.team === "B").length !== 4) {
    throw new ApiError(400, "Team B must have 4 players.");
  }
}

async function getMatchWithPlayers(tx: Tx, matchId: string) {
  const match = await tx.match.findUnique({
    where: { id: matchId },
    include: { players: true },
  });
  if (!match) throw new ApiError(404, "Match not found.");
  return match;
}

function canOperateAsHostOrAdmin(match: { roomHostUserId: string | null }, userId: string | undefined, role: UserRole | undefined) {
  return Boolean((userId && match.roomHostUserId === userId) || (role && canManage(role)));
}

export async function startMatch(matchId: string) {
  return prisma.$transaction(async (tx) => {
    const match = await getMatchWithPlayers(tx, matchId);
    if (match.status !== "CREATED") throw new ApiError(400, "Only CREATED matches can start.");
    validateMatchPlayers(match.players);
    const tournament = await tx.tournament.findUnique({ where: { id: match.tournamentId } });
    if (tournament?.stagePoolEnabled) {
      if (!match.stageId) throw new ApiError(400, "使用ステージを設定してください。");
      const stage = await tx.tournamentStage.findUnique({ where: { id: match.stageId } });
      if (!stage || stage.tournamentId !== match.tournamentId || !stage.isActive) {
        throw new ApiError(400, "この大会で使用できないステージです。");
      }
    }
    return tx.match.update({ where: { id: matchId }, data: { status: "PLAYING" } });
  });
}

export async function openResultReporting(matchId: string, userId?: string, role?: UserRole) {
  return prisma.$transaction(async (tx) => {
    const match = await getMatchWithPlayers(tx, matchId);
    if (match.status !== "PLAYING") {
      throw new ApiError(400, "Only PLAYING matches can open result reporting.");
    }
    if (userId && !canOperateAsHostOrAdmin(match, userId, role)) {
      throw new ApiError(403, "Only the room host or admin can end the match.");
    }
    return tx.match.update({ where: { id: matchId }, data: { status: "RESULT_REPORTING" } });
  });
}

export async function submitResultReport(userId: string, matchId: string, reportedWinnerTeam: unknown, role?: UserRole) {
  const team = assertTeam(reportedWinnerTeam);
  const match = await prisma.$transaction(async (tx) => {
    const match = await getMatchWithPlayers(tx, matchId);
    if (match.status !== "RESULT_REPORTING") {
      throw new ApiError(400, "Match is not accepting result reports.");
    }
    if (!match.players.some((player) => player.userId === userId)) {
      if (!role || !canManage(role)) {
        throw new ApiError(403, "Only match players can report results.");
      }
    }
    if (!canOperateAsHostOrAdmin(match, userId, role)) {
      throw new ApiError(403, "Only the room host or admin can confirm the result.");
    }
    await tx.matchResultReport.upsert({
      where: { matchId_userId: { matchId, userId } },
      update: { reportedWinnerTeam: team },
      create: { matchId, userId, reportedWinnerTeam: team },
    });
    return tx.match.update({
      where: { id: matchId },
      data: { winnerTeam: team, status: "VOTE_REPORTING" },
    });
  });

  await submitAutomaticTestVotesIfAllowed(matchId);
  await attemptAutoApplyRatingForMatch(matchId);
  return match;
}

export async function forceResult(adminUserId: string, matchId: string, winnerTeam: unknown, reason: unknown) {
  const team = assertTeam(winnerTeam);
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ApiError(400, "reason is required.");
  }
  return prisma.$transaction(async (tx) => {
    const before = await getMatchWithPlayers(tx, matchId);
    if (before.status !== "RESULT_REPORTING" && before.status !== "PLAYING") {
      throw new ApiError(400, "Only PLAYING or RESULT_REPORTING matches can be force-confirmed.");
    }
    validateMatchPlayers(before.players);
    const after = await tx.match.update({
      where: { id: matchId },
      data: { winnerTeam: team, status: "VOTE_REPORTING" },
    });
    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "MATCH_RESULT_FORCED",
        targetType: "Match",
        targetId: matchId,
        metadata: {
          before: { status: before.status, winnerTeam: before.winnerTeam },
          after: { status: after.status, winnerTeam: after.winnerTeam },
          reason: reason.trim(),
        },
      },
    });
    return after;
  });
}

type VoteInput = {
  targetUserId?: unknown;
  voteType?: unknown;
};

function assertVoteType(value: unknown): VoteType {
  if (value !== "STRONG" && value !== "WEAK") {
    throw new ApiError(400, "voteType must be STRONG or WEAK.");
  }
  return value;
}

export async function submitPlayerVotes(userId: string, matchId: string, votes: unknown) {
  if (!Array.isArray(votes) || votes.length !== 2) {
    throw new ApiError(400, "Submit exactly STRONG and WEAK votes.");
  }
  const normalized = (votes as VoteInput[]).map((vote) => ({
    targetUserId: typeof vote.targetUserId === "string" ? vote.targetUserId : "",
    voteType: assertVoteType(vote.voteType),
  }));
  if (new Set(normalized.map((vote) => vote.voteType)).size !== 2) {
    throw new ApiError(400, "Submit one STRONG and one WEAK vote.");
  }
  if (new Set(normalized.map((vote) => vote.targetUserId)).size !== 2) {
    throw new ApiError(400, "STRONG and WEAK cannot target the same player.");
  }

  const submittedVotes = await prisma.$transaction(async (tx) => {
    const match = await getMatchWithPlayers(tx, matchId);
    if (match.status !== "VOTE_REPORTING") {
      throw new ApiError(400, "Match is not accepting player votes.");
    }
    const voter = match.players.find((player) => player.userId === userId);
    if (!voter) throw new ApiError(403, "Only match players can vote.");
    const existing = await tx.playerVote.count({ where: { matchId, voterUserId: userId } });
    if (existing > 0) throw new ApiError(409, "Votes have already been submitted.");

    for (const vote of normalized) {
      const target = match.players.find((player) => player.userId === vote.targetUserId);
      if (!target) throw new ApiError(400, "Vote target must be a match player.");
      if (target.userId === userId) throw new ApiError(400, "Cannot vote for yourself.");
      if (target.team === voter.team) throw new ApiError(400, "Cannot vote for a teammate.");
    }

    await tx.playerVote.createMany({
      data: normalized.map((vote) => ({
        matchId,
        voterUserId: userId,
        targetUserId: vote.targetUserId,
        voteType: vote.voteType,
      })),
    });
    return tx.playerVote.findMany({ where: { matchId, voterUserId: userId } });
  });

  await attemptAutoApplyRatingForMatch(matchId);
  return submittedVotes;
}

async function getVotesForRating(tx: Tx, matchId: string, playerUserIds: string[], votingClosedAt: Date | null) {
  const votes = await tx.playerVote.findMany({ where: { matchId } });

  if (votingClosedAt) {
    return votes;
  }

  for (const userId of playerUserIds) {
    const userVotes = votes.filter((vote) => vote.voterUserId === userId);
    if (userVotes.length !== 2) throw new ApiError(400, "All 8 players must complete STRONG and WEAK votes.");
    if (!userVotes.some((vote) => vote.voteType === "STRONG")) throw new ApiError(400, "Missing STRONG vote.");
    if (!userVotes.some((vote) => vote.voteType === "WEAK")) throw new ApiError(400, "Missing WEAK vote.");
  }

  return votes;
}

function getCompleteVoterIds(
  playerUserIds: Iterable<string>,
  votes: Array<{ voterUserId: string; voteType: VoteType }>,
) {
  const completeVoterIds = new Set<string>();
  for (const userId of playerUserIds) {
    const userVotes = votes.filter((vote) => vote.voterUserId === userId);
    if (userVotes.some((vote) => vote.voteType === "STRONG") && userVotes.some((vote) => vote.voteType === "WEAK")) {
      completeVoterIds.add(userId);
    }
  }
  return completeVoterIds;
}

export async function closeVoting(adminUserId: string, matchId: string, reason: unknown) {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ApiError(400, "reason is required.");
  }

  return prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: { players: true, playerVotes: true },
    });

    if (!match) throw new ApiError(404, "Match not found.");
    if (match.status !== "VOTE_REPORTING") {
      throw new ApiError(400, "Only VOTE_REPORTING matches can close voting.");
    }
    if (match.votingClosedAt) {
      throw new ApiError(409, "Voting is already closed.");
    }

    const submittedUserIds = new Set(
      match.players
        .filter((player) => {
          const votes = match.playerVotes.filter((vote) => vote.voterUserId === player.userId);
          return votes.some((vote) => vote.voteType === "STRONG") && votes.some((vote) => vote.voteType === "WEAK");
        })
        .map((player) => player.userId),
    );
    const unvotedUserIds = match.players
      .map((player) => player.userId)
      .filter((userId) => !submittedUserIds.has(userId));
    const closedAt = new Date();
    const after = await tx.match.update({
      where: { id: matchId },
      data: { votingClosedAt: closedAt },
    });

    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "MATCH_VOTING_CLOSED",
        targetType: "Match",
        targetId: matchId,
        metadata: {
          unvotedUserIds,
          reason: reason.trim(),
          closedAt: closedAt.toISOString(),
        },
      },
    });

    return after;
  });
}

export async function cancelMatch(adminUserId: string, matchId: string, reason: unknown) {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new ApiError(400, "reason is required.");
  }

  return prisma.$transaction(async (tx) => {
    const before = await tx.match.findUnique({ where: { id: matchId } });
    if (!before) throw new ApiError(404, "Match not found.");
    if (before.status === "CONFIRMED") throw new ApiError(400, "CONFIRMED matches cannot be cancelled.");
    if (before.ratingAppliedAt) throw new ApiError(400, "Matches with applied rating cannot be cancelled.");

    const after = await tx.match.update({
      where: { id: matchId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    await tx.adminActionLog.create({
      data: {
        adminUserId,
        action: "MATCH_CANCELLED",
        targetType: "Match",
        targetId: matchId,
        metadata: {
          before: { status: before.status },
          after: { status: after.status },
          reason: reason.trim(),
          queueRestored: false,
        },
      },
    });
    return after;
  });
}

async function applyRatingOnce(matchId: string) {
  return prisma.$transaction(
    async (tx) => {
      const claimed = await tx.match.updateMany({
        where: { id: matchId, ratingAppliedAt: null, status: "VOTE_REPORTING" },
        data: { ratingAppliedAt: new Date() },
      });
      if (claimed.count !== 1) throw new ApiError(409, "Rating has already been applied or match is not ready.");

      const match = await tx.match.findUnique({
        where: { id: matchId },
        include: { players: true, ratingConfig: { include: { xpMultiplierTiers: true } } },
      });
      if (!match) throw new ApiError(404, "Match not found.");
      if (!match.winnerTeam) throw new ApiError(400, "winnerTeam is required.");
      validateMatchPlayers(match.players);

      const playerUserIds = match.players.map((player) => player.userId);
      const votes = await getVotesForRating(tx, matchId, playerUserIds, match.votingClosedAt);
      const completeVoterIds = getCompleteVoterIds(playerUserIds, votes);
      const allPlayersVoted = match.players.length === 8 && completeVoterIds.size === 8;
      if (!match.votingClosedAt && allPlayersVoted) {
        await tx.match.update({
          where: { id: matchId },
          data: { votingClosedAt: new Date() },
        });
      }
      const results = calculatePlayerRatingResults({
        players: match.players,
        votes,
        config: match.ratingConfig,
        xpTiers: match.ratingConfig.xpMultiplierTiers,
        winnerTeam: match.winnerTeam,
      });
      const participants = await tx.tournamentParticipant.findMany({
        where: {
          tournamentId: match.tournamentId,
          userId: { in: results.map((result) => result.userId) },
        },
      });
      const participantByUserId = new Map(participants.map((participant) => [participant.userId, participant]));

      for (const result of results) {
        if (result.finalDelta.lt(0)) throw new ApiError(400, "finalDelta cannot be negative.");
        const participant = participantByUserId.get(result.userId);
        if (!participant?.rating) throw new ApiError(400, "Participant rating is missing.");
        if (!new Prisma.Decimal(participant.rating).equals(result.ratingBefore)) {
          throw new ApiError(409, "Participant rating no longer matches MatchPlayer.ratingBefore.");
        }
        await tx.ratingHistory.create({
          data: {
            tournamentId: match.tournamentId,
            matchId,
            userId: result.userId,
            ratingConfigIdUsed: match.ratingConfigId,
            ratingConfigVersionUsed: match.ratingConfigVersion,
            ratingBefore: result.ratingBefore,
            strongVotesReceived: result.strongVotesReceived,
            weakVotesReceived: result.weakVotesReceived,
            strongVotePointsUsed: result.strongVotePointsUsed,
            weakVotePointsUsed: result.weakVotePointsUsed,
            winBonusUsed: result.winBonusUsed,
            losingStreakPenaltyUsed: result.losingStreakPenaltyUsed,
            votePoints: result.votePoints,
            baseDelta: result.baseDelta,
            areaXpUsed: result.areaXpUsed,
            xpTierMinUsed: result.xpTierMinUsed,
            xpTierMaxUsed: result.xpTierMaxUsed,
            xpMultiplierUsed: result.xpMultiplierUsed,
            finalDelta: result.finalDelta,
            ratingAfter: result.ratingAfter,
          },
        });
        await tx.tournamentParticipant.update({
          where: { tournamentId_userId: { tournamentId: match.tournamentId, userId: result.userId } },
          data: {
            rating: result.ratingAfter,
            matchesPlayed: { increment: 1 },
            wins: result.won ? { increment: 1 } : undefined,
            losses: result.won ? undefined : { increment: 1 },
            winningStreak: result.won ? { increment: 1 } : 0,
            losingStreak: result.won ? 0 : { increment: 1 },
          },
        });
        await tx.matchPlayer.update({
          where: { matchId_userId: { matchId, userId: result.userId } },
          data: { ratingAfter: result.ratingAfter },
        });
      }

      return tx.match.update({
        where: { id: matchId },
        data: { status: "CONFIRMED" },
      });
    },
    RATING_TRANSACTION_OPTIONS,
  );
}

export async function applyRating(matchId: string) {
  try {
    const match = await applyRatingOnce(matchId);
    await ensureTestDummiesWaitingForPhase(match.phaseId);
    return match;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new ApiError(409, "Rating application conflicted with another request.");
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2028") {
      throw new ApiError(503, "Rating application timed out. Please retry.");
    }
    throw error;
  }
}

function getAutoApplyErrorCode(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof ApiError) return `API_${error.status}`;
  if (error instanceof Error) return error.name;
  return "UNKNOWN";
}

export async function attemptAutoApplyRatingForMatch(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: { select: { userId: true } },
      playerVotes: { select: { voterUserId: true, voteType: true } },
    },
  });

  if (!match) return { applied: false as const, reason: "MATCH_NOT_FOUND" as const };

  const playerUserIds = new Set(match.players.map((player) => player.userId));
  const completeVoterIds = getCompleteVoterIds(playerUserIds, match.playerVotes);

  let context = {
    matchId,
    status: match.status,
    submittedVoterCount: completeVoterIds.size,
    votingClosedAt: match.votingClosedAt?.toISOString() ?? null,
    winnerTeam: match.winnerTeam,
    ratingAppliedAt: match.ratingAppliedAt?.toISOString() ?? null,
  };
  const allPlayersVoted = match.players.length === 8 && completeVoterIds.size === 8;
  const canApplyRating = allPlayersVoted || match.votingClosedAt !== null;

  if (match.status !== "VOTE_REPORTING") {
    return { applied: false as const, reason: "STATUS_NOT_READY" as const, ...context };
  }
  if (!match.winnerTeam) {
    return { applied: false as const, reason: "WINNER_NOT_READY" as const, ...context };
  }
  if (match.ratingAppliedAt) {
    return { applied: false as const, reason: "ALREADY_APPLIED" as const, ...context };
  }
  if (match.players.length !== 8) {
    return { applied: false as const, reason: "PLAYER_COUNT_NOT_READY" as const, ...context };
  }
  if (!canApplyRating) {
    return { applied: false as const, reason: "VOTES_INCOMPLETE" as const, ...context };
  }

  try {
    if (allPlayersVoted && !match.votingClosedAt) {
      const votingClosedAt = new Date();
      const closed = await prisma.match.updateMany({
        where: { id: matchId, status: "VOTE_REPORTING", ratingAppliedAt: null, votingClosedAt: null },
        data: { votingClosedAt },
      });
      if (closed.count === 1) {
        context = { ...context, votingClosedAt: votingClosedAt.toISOString() };
        console.info("AUTO_RATING_VOTING_CLOSED", context);
      }
    }
    console.info("AUTO_RATING_APPLY_STARTED", context);
    await applyRating(matchId);
    const appliedMatch = await prisma.match.findUnique({
      where: { id: matchId },
      select: { tournamentId: true, status: true, votingClosedAt: true, ratingAppliedAt: true },
    });
    const ratingHistoryCount = await prisma.ratingHistory.count({ where: { matchId } });
    const updatedParticipantCount = await prisma.tournamentParticipant.count({
      where: {
        tournamentId: appliedMatch?.tournamentId,
        userId: { in: [...playerUserIds] },
        matchesPlayed: { gt: 0 },
      },
    });
    console.info("AUTO_RATING_APPLY_SUCCEEDED", {
      ...context,
      status: appliedMatch?.status ?? context.status,
      votingClosedAt: appliedMatch?.votingClosedAt?.toISOString() ?? context.votingClosedAt,
      ratingAppliedAt: appliedMatch?.ratingAppliedAt?.toISOString() ?? context.ratingAppliedAt,
      ratingHistoryCount,
      updatedParticipantCount,
    });
    return { applied: true as const, ...context };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { applied: false as const, reason: "ALREADY_CLAIMED" as const, ...context };
    }
    console.error("AUTO_RATING_APPLY_FAILED", {
      ...context,
      errorCode: getAutoApplyErrorCode(error),
      error: error instanceof Error ? error.message : String(error),
    });
    return { applied: false as const, reason: "APPLY_FAILED" as const, ...context };
  }
}

async function submitAutomaticTestVotesIfAllowed(matchId: string) {
  try {
    await submitAutomaticTestVotes(matchId);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 400 || error.status === 403 || error.status === 404)) {
      return;
    }
    throw error;
  }
}

export async function getMatchAdminSummary(matchId: string) {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      players: { include: { user: { select: { id: true, name: true, discordUsername: true } } } },
      resultReports: true,
      playerVotes: true,
      ratingHistories: true,
    },
  });
  if (!match) throw new ApiError(404, "Match not found.");
  return match;
}

export { OPEN_MATCH_STATUSES };
