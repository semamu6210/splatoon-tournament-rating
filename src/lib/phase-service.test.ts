import { Prisma, TournamentPhaseStatus, UserRole } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";

import { autoAssignPhaseBlocks, createPhaseBlocks, moveParticipantToBlock } from "@/lib/block-service";
import { completePhase, confirmQualifierAdvancement, createPhase, finishTournament, startPhase, updatePhase } from "@/lib/phase-service";
import { joinQueue } from "@/lib/matchmaking/service";
import { assignCompetitionRanks, filterTournamentRankingsForViewer, getTournamentRankings } from "@/lib/ranking-service";
import { prisma } from "@/lib/prisma";
import { getTournamentOperationWarnings } from "@/lib/operations-monitor";
import { buildDefaultMultiplierPayload } from "@/lib/rating-config";
import {
  createRatingConfigVersion,
  createTournament,
  joinTournament,
  openRegistration,
  startTournament,
} from "@/lib/tournament-service";

const createdUserIds: string[] = [];
const createdTournamentIds: string[] = [];

async function createUser(role: UserRole) {
  const user = await prisma.user.create({
    data: { name: `phase5-${crypto.randomUUID()}`, role },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createActiveTournament(playerCount = 8) {
  const admin = await createUser(UserRole.ADMIN);
  const tournament = await createTournament(admin.id, {
    name: `phase5-${crypto.randomUUID()}`,
    startsAt: null,
    endsAt: null,
  });
  createdTournamentIds.push(tournament.id);

  await createRatingConfigVersion(admin.id, tournament.id, {
    initialRating: "1000",
    winBonus: "10",
    strongVotePoints: "10",
    weakVotePoints: "5",
    losingStreakPenalty: "0",
    xpTierStepSize: 100,
    multipliers: buildDefaultMultiplierPayload(100),
  });
  await openRegistration(admin.id, tournament.id);

  const players = [];
  for (let index = 0; index < playerCount; index += 1) {
    const player = await createUser(UserRole.PLAYER);
    players.push(player);
    await joinTournament(player.id, tournament.id, { areaXp: 2400 + index });
  }

  await startTournament(admin.id, tournament.id);
  return { admin, tournament, players };
}

async function createConfirmedMatchForUsers(tournamentId: string, phaseId: string, userIds: string[]) {
  const config = await prisma.tournamentRatingConfig.findFirstOrThrow({
    where: { tournamentId, isActive: true },
  });
  const match = await prisma.match.create({
    data: {
      tournamentId,
      phaseId,
      ratingConfigId: config.id,
      ratingConfigVersion: config.version,
      rule: "AREA",
      status: "CONFIRMED",
      winnerTeam: "A",
      ratingAppliedAt: new Date(),
    },
  });

  await prisma.matchPlayer.createMany({
    data: userIds.map((userId, index) => ({
      matchId: match.id,
      userId,
      team: index % 2 === 0 ? "A" : "B",
      ratingBefore: "1000",
      matchingRatingAtMatch: "1000",
      areaXpAtMatch: 2500,
      losingStreakAtMatch: 0,
      ratingAfter: "1000",
    })),
  });
}

afterEach(async () => {
  await prisma.adminActionLog.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.tournament.deleteMany({ where: { id: { in: createdTournamentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
  createdTournamentIds.length = 0;
});

describe("competition rankings", () => {
  it("assigns the same rank for equal ratings and skips the next rank", () => {
    const base = {
      id: "participant",
      tournamentId: "tournament",
      participantName: "participant",
      areaXp: 2500,
      ratingInitializedAt: new Date(),
      initialRatingConfigId: null,
      initialRatingConfigVersion: null,
      wins: 0,
      losses: 0,
      matchesPlayed: 0,
      winningStreak: 0,
      losingStreak: 0,
      blockName: null,
      advancedToMainEvent: false,
      finalRank: null,
      isActive: true,
      joinedAt: new Date("2026-08-22T00:00:00Z"),
      createdAt: new Date("2026-08-22T00:00:00Z"),
      updatedAt: new Date("2026-08-22T00:00:00Z"),
    };
    const rows = assignCompetitionRanks([
      { ...base, id: "a", userId: "a", rating: new Prisma.Decimal("1500"), user: { id: "a", name: "a", discordUsername: null } },
      { ...base, id: "b", userId: "b", rating: new Prisma.Decimal("1500"), user: { id: "b", name: "b", discordUsername: null } },
      { ...base, id: "c", userId: "c", rating: new Prisma.Decimal("1400"), user: { id: "c", name: "c", discordUsername: null } },
    ]);

    expect(rows.map((row) => row.rank)).toEqual([1, 1, 3]);
  });
});

describe("phase progression", () => {
  it("completes qualifier, advances tied cut-line players, and starts pending main event", async () => {
    const { admin, tournament, players } = await createActiveTournament(8);
    const qualifier = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 1,
        advancePlayerCount: 2,
        sortOrder: 1,
      },
    });
    const mainEvent = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "MAIN_EVENT",
        status: TournamentPhaseStatus.PENDING,
        requiredMatchesPerPlayer: 1,
        sortOrder: 2,
      },
    });
    const ratings = ["1500", "1400", "1400", "1300", "1200", "1100", "1000", "900"];
    for (let index = 0; index < players.length; index += 1) {
      await prisma.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[index].id } },
        data: { rating: ratings[index], blockName: index < 4 ? "A" : "B" },
      });
    }
    await createConfirmedMatchForUsers(tournament.id, qualifier.id, players.map((player) => player.id));

    await completePhase(admin.id, qualifier.id);
    const boundaryParticipant = await prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[1].id } },
    });
    const result = await confirmQualifierAdvancement(admin.id, qualifier.id, [boundaryParticipant.id]);
    const reloadedMainTargets = await prisma.tournamentPhaseParticipant.findMany({ where: { phaseId: mainEvent.id } });
    const advanced = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id, advancedToMainEvent: true },
      orderBy: { rating: "desc" },
    });

    expect(result.advancingIds).toHaveLength(2);
    expect(advanced.map((participant) => participant.userId)).toEqual(players.slice(0, 2).map((player) => player.id));
    expect(reloadedMainTargets).toHaveLength(2);
  });

  it("reports NEEDS_ADMIN_DECISION when an advancement boundary has equal rating", async () => {
    const { admin, tournament, players } = await createActiveTournament(8);
    const qualifier = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 1,
        advancePlayerCount: 2,
        sortOrder: 1,
      },
    });
    await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "MAIN_EVENT",
        status: TournamentPhaseStatus.PENDING,
        requiredMatchesPerPlayer: 1,
        sortOrder: 2,
      },
    });
    const ratings = ["1500", "1400", "1400", "1300", "1200", "1100", "1000", "900"];
    for (let index = 0; index < players.length; index += 1) {
      await prisma.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[index].id } },
        data: { rating: ratings[index] },
      });
    }
    await createConfirmedMatchForUsers(tournament.id, qualifier.id, players.map((player) => player.id));
    await completePhase(admin.id, qualifier.id);

    await expect(confirmQualifierAdvancement(admin.id, qualifier.id)).rejects.toThrow(
      "Admin selection count does not match requiredAdminSelections.",
    );
  });

  it("uses confirmed matches in the same phase for required count and queue limits", async () => {
    const { tournament, players } = await createActiveTournament(8);
    const qualifier = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
      },
    });
    const otherPhase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "MAIN_EVENT",
        status: TournamentPhaseStatus.PENDING,
        requiredMatchesPerPlayer: 1,
        sortOrder: 2,
      },
    });
    await createConfirmedMatchForUsers(tournament.id, otherPhase.id, players.map((player) => player.id));
    const cancelled = await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        phaseId: qualifier.id,
        ratingConfigId: (await prisma.tournamentRatingConfig.findFirstOrThrow({ where: { tournamentId: tournament.id } })).id,
        ratingConfigVersion: 1,
        rule: "AREA",
        status: "CANCELLED",
      },
    });
    await prisma.matchPlayer.createMany({
      data: players.map((player, index) => ({
        matchId: cancelled.id,
        userId: player.id,
        team: index % 2 === 0 ? "A" : "B",
        ratingBefore: "1000",
        matchingRatingAtMatch: "1000",
        areaXpAtMatch: 2500,
        losingStreakAtMatch: 0,
      })),
    });

    await joinQueue(players[0].id, qualifier.id);
    await prisma.queueEntry.deleteMany({ where: { phaseId: qualifier.id } });
    await createConfirmedMatchForUsers(tournament.id, qualifier.id, players.map((player) => player.id));

    await expect(joinQueue(players[0].id, qualifier.id)).rejects.toThrow("Required match count has already been reached.");
  });

  it("creates block rankings and prevents duplicate block membership inside the same phase", async () => {
    const { tournament, players } = await createActiveTournament(8);
    const qualifier = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.PENDING,
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
      },
    });
    const blocks = await createPhaseBlocks(qualifier.id, ["Block A", "Block B"]);
    await autoAssignPhaseBlocks(qualifier.id);
    const firstParticipant = await prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[0].id } },
    });

    await moveParticipantToBlock(qualifier.id, firstParticipant.id, blocks[1].id);
    const memberships = await prisma.tournamentBlockParticipant.findMany({
      where: { phaseId: qualifier.id, tournamentParticipantId: firstParticipant.id },
    });
    const rankings = await getTournamentRankings(tournament.id);

    expect(memberships).toHaveLength(1);
    expect(rankings.blocks).toHaveLength(2);
    expect(rankings.blocks.every((block) => block.rows.every((row) => row.rank >= 1))).toBe(true);
  });

  it("filters rankings by rankingVisibility for non-admin viewers", async () => {
    const { tournament, players } = await createActiveTournament(8);
    const qualifier = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.PENDING,
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
      },
    });
    const blocks = await createPhaseBlocks(qualifier.id, ["Block A", "Block B"]);
    await autoAssignPhaseBlocks(qualifier.id);

    await prisma.tournament.update({ where: { id: tournament.id }, data: { rankingVisibility: "OWN_BLOCK_ONLY" } });
    const ownOnly = await filterTournamentRankingsForViewer({
      tournamentId: tournament.id,
      rankings: await getTournamentRankings(tournament.id),
      viewerUserId: players[0].id,
      isAdmin: false,
    });
    expect(ownOnly.overall).toHaveLength(0);
    expect(ownOnly.blocks).toHaveLength(1);

    await prisma.tournament.update({ where: { id: tournament.id }, data: { rankingVisibility: "OVERALL_ONLY" } });
    const overallOnly = await filterTournamentRankingsForViewer({
      tournamentId: tournament.id,
      rankings: await getTournamentRankings(tournament.id),
      viewerUserId: players[0].id,
      isAdmin: false,
    });
    expect(overallOnly.overall).toHaveLength(8);
    expect(overallOnly.blocks).toHaveLength(0);

    await prisma.tournament.update({ where: { id: tournament.id }, data: { rankingVisibility: "OWN_AND_OTHER_BLOCKS" } });
    const blocksOnly = await filterTournamentRankingsForViewer({
      tournamentId: tournament.id,
      rankings: await getTournamentRankings(tournament.id),
      viewerUserId: players[0].id,
      isAdmin: false,
    });
    expect(blocksOnly.overall).toHaveLength(0);
    expect(blocksOnly.blocks).toHaveLength(blocks.length);

    await prisma.tournament.update({ where: { id: tournament.id }, data: { rankingVisibility: "ALL" } });
    const all = await filterTournamentRankingsForViewer({
      tournamentId: tournament.id,
      rankings: await getTournamentRankings(tournament.id),
      viewerUserId: players[0].id,
      isAdmin: false,
    });
    expect(all.overall).toHaveLength(8);
    expect(all.blocks).toHaveLength(blocks.length);
  });

  it("supports BLOCK advancement with per-block counts and admin tie selection", async () => {
    const { admin, tournament, players } = await createActiveTournament(8);
    const qualifier = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.PENDING,
        requiredMatchesPerPlayer: 1,
        advancePlayerCount: 4,
        advancementMode: "BLOCK",
        sortOrder: 1,
      },
    });
    const mainEvent = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "MAIN_EVENT",
        status: TournamentPhaseStatus.PENDING,
        requiredMatchesPerPlayer: 1,
        sortOrder: 2,
      },
    });
    const blocks = await createPhaseBlocks(qualifier.id, {
      blocks: [
        { name: "Block A", advancePlayerCount: 2 },
        { name: "Block B", advancePlayerCount: 2 },
      ],
    });
    const participantRows = [];
    for (let index = 0; index < players.length; index += 1) {
      const participant = await prisma.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[index].id } },
        data: { rating: ["1500", "1400", "1400", "1300", "1600", "1500", "1400", "1300"][index] },
      });
      participantRows.push(participant);
      await moveParticipantToBlock(qualifier.id, participant.id, index < 4 ? blocks[0].id : blocks[1].id);
    }
    await startPhase(admin.id, qualifier.id);
    await createConfirmedMatchForUsers(tournament.id, qualifier.id, players.map((player) => player.id));
    await completePhase(admin.id, qualifier.id);

    await expect(confirmQualifierAdvancement(admin.id, qualifier.id)).rejects.toThrow(
      "Admin selection count does not match requiredAdminSelections.",
    );
    const result = await confirmQualifierAdvancement(admin.id, qualifier.id, [participantRows[1].id]);
    const mainTargets = await prisma.tournamentPhaseParticipant.findMany({ where: { phaseId: mainEvent.id } });

    expect(result.advancingIds).toHaveLength(4);
    expect(mainTargets).toHaveLength(4);
  });

  it("allows phase creation and PENDING edits but rejects ACTIVE edits and ACTIVE block moves", async () => {
    const { admin, tournament, players } = await createActiveTournament(8);
    const created = await createPhase(admin.id, tournament.id, {
      phaseType: "QUALIFIER",
      requiredMatchesPerPlayer: 2,
      advancePlayerCount: 4,
      advancementMode: "OVERALL",
      sortOrder: 1,
    });
    const edited = await updatePhase(created.id, {
      requiredMatchesPerPlayer: 3,
      advancePlayerCount: 5,
      advancementMode: "BLOCK",
    });
    const blocks = await createPhaseBlocks(created.id, ["Block A", "Block B"]);
    const participant = await prisma.tournamentParticipant.findUniqueOrThrow({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[0].id } },
    });
    await moveParticipantToBlock(created.id, participant.id, blocks[0].id);
    await startPhase(admin.id, created.id);

    expect(edited.requiredMatchesPerPlayer).toBe(3);
    await expect(updatePhase(created.id, { requiredMatchesPerPlayer: 1 })).rejects.toThrow("Only PENDING phases can be edited.");
    await expect(moveParticipantToBlock(created.id, participant.id, blocks[1].id)).rejects.toThrow(
      "Blocks can be changed only while phase is PENDING.",
    );
  });

  it("finishes tournament and stores finalRank with tied ratings", async () => {
    const { admin, tournament, players } = await createActiveTournament(8);
    const mainEvent = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "MAIN_EVENT",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
      },
    });
    const ratings = ["1600", "1500", "1500", "1400", "1300", "1200", "1100", "1000"];
    for (let index = 0; index < players.length; index += 1) {
      await prisma.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[index].id } },
        data: { rating: ratings[index], advancedToMainEvent: true },
      });
    }
    await createConfirmedMatchForUsers(tournament.id, mainEvent.id, players.map((player) => player.id));

    await completePhase(admin.id, mainEvent.id);
    const finished = await finishTournament(admin.id, tournament.id);
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: tournament.id },
      orderBy: { rating: "desc" },
    });

    expect(finished.status).toBe("FINISHED");
    expect(participants.map((participant) => participant.finalRank)).toEqual([1, 2, 2, 4, 5, 6, 7, 8]);
    expect(participants.map((participant) => participant.rating?.toString())).toEqual(ratings);
  });

  it("rejects finishing before MAIN_EVENT is completed", async () => {
    const { admin, tournament } = await createActiveTournament(8);
    await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "MAIN_EVENT",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
      },
    });

    await expect(finishTournament(admin.id, tournament.id)).rejects.toThrow("MAIN_EVENT must be COMPLETED");
  });

  it("detects representative abnormal match states", async () => {
    const { tournament, players } = await createActiveTournament(8);
    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
      },
    });
    const config = await prisma.tournamentRatingConfig.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    const match = await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        phaseId: phase.id,
        ratingConfigId: config.id,
        ratingConfigVersion: config.version,
        rule: "AREA",
        status: "CONFIRMED",
      },
    });
    await prisma.matchPlayer.createMany({
      data: players.slice(0, 7).map((player, index) => ({
        matchId: match.id,
        userId: player.id,
        team: index < 4 ? "A" : "B",
        ratingBefore: "1000",
        matchingRatingAtMatch: "1000",
        areaXpAtMatch: 2500,
        losingStreakAtMatch: 0,
      })),
    });

    const warnings = await getTournamentOperationWarnings(tournament.id);

    expect(warnings.map((warning) => warning.type)).toContain("INVALID_PLAYER_COUNT");
    expect(warnings.map((warning) => warning.type)).toContain("INVALID_TEAM_SIZE");
    expect(warnings.map((warning) => warning.type)).toContain("MISSING_RATING_HISTORY");
  });
});
