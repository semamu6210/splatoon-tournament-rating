import { randomInt } from "node:crypto";

import { Prisma, type MatchPlayer, type PlayerVote, type Team } from "@prisma/client";

import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;

type VoteMatch = {
  id: string;
  tournamentId: string;
  status: string;
  players: MatchPlayer[];
  playerVotes: PlayerVote[];
  tournament: { isTestTournament: boolean };
};

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function chooseVoteTargets(opponents: Array<{ userId: string; team: Team }>) {
  if (opponents.length < 2) throw new ApiError(400, "At least two opponents are required for dummy votes.");
  const selected = shuffled(opponents).slice(0, 2);
  return [
    { targetUserId: selected[0].userId, voteType: "STRONG" as const },
    { targetUserId: selected[1].userId, voteType: "WEAK" as const },
  ];
}

export async function submitAutomaticTestVotesTx(
  tx: Tx,
  match: VoteMatch,
  options: { includeRealPlayersWhenAllDummy?: boolean } = {},
) {
  if (!match.tournament.isTestTournament) {
    throw new ApiError(403, "Test dummy operations are allowed only for test tournaments.");
  }
  if (match.status !== "VOTE_REPORTING") {
    throw new ApiError(400, "Match must be VOTE_REPORTING.");
  }

  const participants = await tx.tournamentParticipant.findMany({
    where: { tournamentId: match.tournamentId, userId: { in: match.players.map((player) => player.userId) } },
    select: { userId: true, isDummy: true },
  });
  const dummyUserIds = new Set(participants.filter((participant) => participant.isDummy).map((participant) => participant.userId));
  const allPlayersAreDummies = match.players.every((player) => dummyUserIds.has(player.userId));
  const includeAllPlayers = Boolean(options.includeRealPlayersWhenAllDummy && allPlayersAreDummies);
  const voters = match.players.filter((player) => includeAllPlayers || dummyUserIds.has(player.userId));

  let submitted = 0;
  let skipped = 0;
  for (const voter of voters) {
    const existingVotes = match.playerVotes.filter((vote) => vote.voterUserId === voter.userId);
    if (existingVotes.length > 0) {
      skipped += 1;
      continue;
    }
    const opponents = match.players.filter((player) => player.team !== voter.team);
    const votes = chooseVoteTargets(opponents);
    await tx.playerVote.createMany({
      data: votes.map((vote) => ({
        matchId: match.id,
        voterUserId: voter.userId,
        targetUserId: vote.targetUserId,
        voteType: vote.voteType,
      })),
    });
    submitted += 1;
  }

  return { submitted, skipped, allPlayersAreDummies };
}

export async function submitAutomaticTestVotes(matchId: string, options: { includeRealPlayersWhenAllDummy?: boolean } = {}) {
  return prisma.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: {
        tournament: { select: { isTestTournament: true } },
        players: { orderBy: [{ team: "asc" }, { userId: "asc" }] },
        playerVotes: true,
      },
    });
    if (!match) throw new ApiError(404, "Match not found.");
    return submitAutomaticTestVotesTx(tx, match, options);
  });
}
