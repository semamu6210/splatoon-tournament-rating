import type { MatchStatus, Prisma, QueueStatus, Team } from "@prisma/client";

type Tx = Prisma.TransactionClient;

type QueueStatusEventInput = {
  matchId?: string | null;
  phaseId: string;
  queueEntryId: string;
  status: QueueStatus | "NOT_QUEUED";
};

export async function touchQueueStatusEventTx(tx: Tx, input: QueueStatusEventInput) {
  await tx.queueStatusEvent.upsert({
    where: { queueEntryId: input.queueEntryId },
    update: {
      status: input.status,
      matchId: input.matchId ?? null,
      version: { increment: 1 },
    },
    create: {
      phaseId: input.phaseId,
      queueEntryId: input.queueEntryId,
      status: input.status,
      matchId: input.matchId ?? null,
    },
  });
}

export async function touchQueueStatusEventsTx(tx: Tx, inputs: QueueStatusEventInput[]) {
  for (const input of inputs) {
    await touchQueueStatusEventTx(tx, input);
  }
}

function completeVoterCount(votes: Array<{ voterUserId: string; voteType: string }>) {
  const voteTypesByUserId = new Map<string, Set<string>>();
  for (const vote of votes) {
    const voteTypes = voteTypesByUserId.get(vote.voterUserId) ?? new Set<string>();
    voteTypes.add(vote.voteType);
    voteTypesByUserId.set(vote.voterUserId, voteTypes);
  }
  return [...voteTypesByUserId.values()].filter((voteTypes) => voteTypes.has("STRONG") && voteTypes.has("WEAK")).length;
}

export async function touchMatchStatusEventTx(
  tx: Tx,
  matchId: string,
  matchSnapshot?: {
    ratingAppliedAt: Date | null;
    status: MatchStatus;
    votingClosedAt: Date | null;
    winnerTeam: Team | null;
  },
) {
  const match =
    matchSnapshot ??
    (await tx.match.findUnique({
      where: { id: matchId },
      select: { status: true, winnerTeam: true, votingClosedAt: true, ratingAppliedAt: true },
    }));
  if (!match) return;

  const votes = await tx.playerVote.findMany({
    where: { matchId },
    select: { voterUserId: true, voteType: true },
  });

  await tx.matchStatusEvent.upsert({
    where: { matchId },
    update: {
      status: match.status,
      winnerTeam: match.winnerTeam,
      votingClosedAt: match.votingClosedAt,
      ratingAppliedAt: match.ratingAppliedAt,
      submittedVoterCount: completeVoterCount(votes),
      version: { increment: 1 },
    },
    create: {
      matchId,
      status: match.status,
      winnerTeam: match.winnerTeam,
      votingClosedAt: match.votingClosedAt,
      ratingAppliedAt: match.ratingAppliedAt,
      submittedVoterCount: completeVoterCount(votes),
    },
  });
}
