import { TournamentPhaseStatus, UserRole } from "@prisma/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { getMatchViewForUser } from "@/lib/match-view-service";
import { joinQueue, runMatchmaking } from "@/lib/matchmaking/service";
import { prisma } from "@/lib/prisma";
import { buildDefaultMultiplierPayload } from "@/lib/rating-config";
import { setMatchStage } from "@/lib/stage-service";
import { createRatingConfigVersion, createTournament, joinTournament, openRegistration, startTournament, updateTournament } from "@/lib/tournament-service";

const createdUserIds: string[] = [];
const createdTournamentIds: string[] = [];

async function createUser(role: UserRole) {
  const user = await prisma.user.create({
    data: { name: `stage-${crypto.randomUUID()}`, role },
  });
  createdUserIds.push(user.id);
  return user;
}

function ratingConfig() {
  return {
    initialRating: "1000",
    winBonus: "10",
    strongVotePoints: "10",
    weakVotePoints: "5",
    losingStreakPenalty: "0",
    xpTierStepSize: 100,
    multipliers: buildDefaultMultiplierPayload(100),
  };
}

async function createStartedTournament(playerCount = 8) {
  const admin = await createUser(UserRole.ADMIN);
  const tournament = await createTournament(admin.id, {
    name: `stage-${crypto.randomUUID()}`,
    startsAt: null,
    endsAt: null,
    stageNames: ["ユノハナ大渓谷", "ゴンズイ地区"],
  });
  createdTournamentIds.push(tournament.id);
  await createRatingConfigVersion(admin.id, tournament.id, ratingConfig());
  await openRegistration(admin.id, tournament.id);
  const players = [];
  for (let index = 0; index < playerCount; index += 1) {
    const player = await createUser(UserRole.PLAYER);
    players.push(player);
    await joinTournament(player.id, tournament.id, { areaXp: 2200 + index, participantName: `Player ${index}` });
  }
  if (playerCount > 0) {
    await startTournament(admin.id, tournament.id);
  }
  return { admin, tournament, players };
}

afterEach(async () => {
  await prisma.adminActionLog.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.tournament.deleteMany({ where: { id: { in: createdTournamentIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  createdUserIds.length = 0;
  createdTournamentIds.length = 0;
});

describe("tournament stage selection", () => {
  it("backfills stagePoolEnabled for tournaments that already have stages", () => {
    const sql = readFileSync("prisma/migrations/20260822113000_backfill_stage_pool_enabled/migration.sql", "utf8");
    expect(sql).toContain('SET "stagePoolEnabled" = true');
    expect(sql).toContain('FROM "TournamentStage"');
    expect(sql).toContain('WHERE "s"."tournamentId" = "t"."id"');
  });

  it("stores selected stages when creating a tournament", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createTournament(admin.id, {
      name: `stage-${crypto.randomUUID()}`,
      startsAt: null,
      endsAt: null,
      stageNames: ["ユノハナ大渓谷", "ゴンズイ地区", "ヤガラ市場"],
    });
    createdTournamentIds.push(tournament.id);

    const stages = await prisma.tournamentStage.findMany({ where: { tournamentId: tournament.id, isActive: true } });
    expect(stages.map((stage) => stage.name).sort()).toEqual(["ゴンズイ地区", "ヤガラ市場", "ユノハナ大渓谷"].sort());
    expect(tournament.stagePoolEnabled).toBe(true);
  });

  it("adds and removes active stages when editing a tournament", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createTournament(admin.id, {
      name: `stage-${crypto.randomUUID()}`,
      startsAt: null,
      endsAt: null,
      stagePoolEnabled: true,
      stageNames: ["ユノハナ大渓谷", "ゴンズイ地区"],
    });
    createdTournamentIds.push(tournament.id);

    await updateTournament(admin.id, tournament.id, {
      name: tournament.name,
      startsAt: null,
      endsAt: null,
      stagePoolEnabled: true,
      stageNames: ["ゴンズイ地区", "ヤガラ市場"],
    });

    const activeStages = await prisma.tournamentStage.findMany({ where: { tournamentId: tournament.id, isActive: true }, orderBy: { sortOrder: "asc" } });
    const inactiveStage = await prisma.tournamentStage.findFirstOrThrow({ where: { tournamentId: tournament.id, name: "ユノハナ大渓谷" } });
    expect(activeStages.map((stage) => stage.name)).toEqual(["ゴンズイ地区", "ヤガラ市場"]);
    expect(inactiveStage.isActive).toBe(false);
  });

  it("can disable stage pool without deleting existing stage records", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createTournament(admin.id, {
      name: `stage-${crypto.randomUUID()}`,
      startsAt: null,
      endsAt: null,
      stagePoolEnabled: true,
      stageNames: ["ユノハナ大渓谷", "ゴンズイ地区"],
    });
    createdTournamentIds.push(tournament.id);

    const updated = await updateTournament(admin.id, tournament.id, {
      name: tournament.name,
      startsAt: null,
      endsAt: null,
      stagePoolEnabled: false,
    });

    const stages = await prisma.tournamentStage.findMany({ where: { tournamentId: tournament.id } });
    expect(updated.stagePoolEnabled).toBe(false);
    expect(stages).toHaveLength(2);
  });

  it("rejects removing a stage used as a phase default", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createTournament(admin.id, {
      name: `stage-${crypto.randomUUID()}`,
      startsAt: null,
      endsAt: null,
      stagePoolEnabled: true,
      stageNames: ["ユノハナ大渓谷", "ゴンズイ地区"],
    });
    createdTournamentIds.push(tournament.id);
    const stage = await prisma.tournamentStage.findFirstOrThrow({ where: { tournamentId: tournament.id, name: "ユノハナ大渓谷" } });
    await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: "PENDING",
        requiredMatchesPerPlayer: 1,
        sortOrder: 1,
        stageSelectionMode: "ADMIN",
        defaultStageId: stage.id,
      },
    });

    await expect(
      updateTournament(admin.id, tournament.id, {
        name: tournament.name,
        startsAt: null,
        endsAt: null,
        stagePoolEnabled: true,
        stageNames: ["ゴンズイ地区"],
      }),
    ).rejects.toThrow("既定ステージとして使用中のステージは無効化できません。");
  });

  it("rejects removing a stage used by a created match", async () => {
    const admin = await createUser(UserRole.ADMIN);
    const tournament = await createTournament(admin.id, {
      name: `stage-${crypto.randomUUID()}`,
      startsAt: null,
      endsAt: null,
      stagePoolEnabled: true,
      stageNames: ["ユノハナ大渓谷", "ゴンズイ地区"],
    });
    createdTournamentIds.push(tournament.id);
    await createRatingConfigVersion(admin.id, tournament.id, ratingConfig());
    const config = await prisma.tournamentRatingConfig.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    const stage = await prisma.tournamentStage.findFirstOrThrow({ where: { tournamentId: tournament.id, name: "ユノハナ大渓谷" } });
    const phase = await prisma.tournamentPhase.create({
      data: { tournamentId: tournament.id, phaseType: "QUALIFIER", status: "PENDING", requiredMatchesPerPlayer: 1, sortOrder: 1 },
    });
    await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        phaseId: phase.id,
        ratingConfigId: config.id,
        ratingConfigVersion: config.version,
        stageId: stage.id,
        stageName: stage.name,
      },
    });

    await expect(
      updateTournament(admin.id, tournament.id, {
        name: tournament.name,
        startsAt: null,
        endsAt: null,
        stagePoolEnabled: true,
        stageNames: ["ゴンズイ地区"],
      }),
    ).rejects.toThrow("未開始の試合で使用中のステージは無効化できません。");
  });

  it("rejects setting a match stage from another tournament", async () => {
    const { admin, tournament } = await createStartedTournament(0);
    const other = await createTournament(admin.id, {
      name: `other-${crypto.randomUUID()}`,
      startsAt: null,
      endsAt: null,
      stageNames: ["ヤガラ市場"],
    });
    createdTournamentIds.push(other.id);
    const config = await prisma.tournamentRatingConfig.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    const phase = await prisma.tournamentPhase.create({
      data: { tournamentId: tournament.id, phaseType: "QUALIFIER", status: "ACTIVE", requiredMatchesPerPlayer: 1, sortOrder: 1 },
    });
    const match = await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        phaseId: phase.id,
        ratingConfigId: config.id,
        ratingConfigVersion: config.version,
      },
    });
    const otherStage = await prisma.tournamentStage.findFirstOrThrow({ where: { tournamentId: other.id } });

    await expect(setMatchStage(admin.id, match.id, otherStage.id)).rejects.toThrow("この大会で使用できないステージです。");
  });

  it("rejects setting an inactive match stage", async () => {
    const { admin, tournament } = await createStartedTournament(0);
    const config = await prisma.tournamentRatingConfig.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    const phase = await prisma.tournamentPhase.create({
      data: { tournamentId: tournament.id, phaseType: "QUALIFIER", status: "ACTIVE", requiredMatchesPerPlayer: 1, sortOrder: 1 },
    });
    const stage = await prisma.tournamentStage.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    await prisma.tournamentStage.update({ where: { id: stage.id }, data: { isActive: false } });
    const match = await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        phaseId: phase.id,
        ratingConfigId: config.id,
        ratingConfigVersion: config.version,
      },
    });

    await expect(setMatchStage(admin.id, match.id, stage.id)).rejects.toThrow("この大会で使用できないステージです。");
  });

  it("selects a random match stage only from the tournament stage pool", async () => {
    const { tournament, players } = await createStartedTournament(8);
    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 10,
        sortOrder: 1,
        stageSelectionMode: "RANDOM",
      },
    });

    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }
    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    if (!result.matched) return;

    const match = await prisma.match.findUniqueOrThrow({ where: { id: result.matchId } });
    expect(["ユノハナ大渓谷", "ゴンズイ地区"]).toContain(match.stageName);
  });

  it("returns private room details and stage image only to players or admins", async () => {
    const { admin, tournament, players } = await createStartedTournament(8);
    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 10,
        sortOrder: 1,
        stageSelectionMode: "ADMIN",
        defaultStageId: (await prisma.tournamentStage.findFirstOrThrow({ where: { tournamentId: tournament.id, name: "ユノハナ大渓谷" } })).id,
      },
    });

    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }
    const result = await runMatchmaking(phase.id);
    expect(result.matched).toBe(true);
    if (!result.matched) return;

    const match = await prisma.match.findUniqueOrThrow({ where: { id: result.matchId }, include: { players: true } });
    const hostId = match.roomHostUserId;
    expect(hostId).toBeTruthy();
    const host = players.find((player) => player.id === hostId)!;
    const nonHost = players.find((player) => player.id !== hostId)!;
    const outsider = await createUser(UserRole.PLAYER);

    const hostView = await getMatchViewForUser(match.id, host);
    expect(hostView.match.privateRoomCode).toMatch(/^[A-Z]{3}$/);
    expect(hostView.match.isRoomHost).toBe(true);
    expect(hostView.match.roomHost?.id).toBe(host.id);
    expect(hostView.match.stageImage).toBe("/stages/yunohana.webp");
    expect(hostView.match.stage?.imagePath).toBe("/stages/yunohana.webp");

    const playerView = await getMatchViewForUser(match.id, nonHost);
    expect(playerView.match.privateRoomCode).toBe(hostView.match.privateRoomCode);
    expect(playerView.match.isRoomHost).toBe(false);
    expect(playerView.match.teamA).toHaveLength(4);
    expect(playerView.match.teamB).toHaveLength(4);
    expect(playerView.match.myTeam).toMatch(/A|B/);

    const adminView = await getMatchViewForUser(match.id, admin);
    expect(adminView.match.privateRoomCode).toBe(hostView.match.privateRoomCode);
    expect(adminView.match.admin).toBeTruthy();

    await expect(getMatchViewForUser(match.id, outsider)).rejects.toThrow("You cannot view this match.");
  });

  it("rejects an inactive ADMIN default stage during matchmaking", async () => {
    const { tournament, players } = await createStartedTournament(8);
    const stage = await prisma.tournamentStage.findFirstOrThrow({ where: { tournamentId: tournament.id } });
    const phase = await prisma.tournamentPhase.create({
      data: {
        tournamentId: tournament.id,
        phaseType: "QUALIFIER",
        status: TournamentPhaseStatus.ACTIVE,
        requiredMatchesPerPlayer: 10,
        sortOrder: 1,
        stageSelectionMode: "ADMIN",
        defaultStageId: stage.id,
      },
    });
    await prisma.tournamentStage.update({ where: { id: stage.id }, data: { isActive: false } });

    for (const player of players) {
      await joinQueue(player.id, phase.id);
    }

    await expect(runMatchmaking(phase.id)).rejects.toThrow("この大会で使用できないステージです。");
  });
});
