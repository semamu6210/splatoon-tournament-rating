import { expect, request, test, type APIRequestContext } from "@playwright/test";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

type LoginUser = {
  id: string;
  email: string;
  role: "ADMIN" | "PLAYER" | "OWNER";
  context: APIRequestContext;
};

async function login(baseURL: string, email: string, name: string, role: LoginUser["role"]) {
  const context = await request.newContext({ baseURL });
  const response = await context.post("/api/test/login", { data: { email, name, role } });
  expect(response.ok()).toBeTruthy();
  const json = (await response.json()) as { user: { id: string; email: string; role: LoginUser["role"] } };
  return { ...json.user, context };
}

async function expectOk<T>(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
  const json = (await response.json().catch(() => null)) as T & { error?: string };
  expect(response.ok(), json?.error).toBeTruthy();
  return json;
}

async function cleanup() {
  const { prisma } = await import("../../src/lib/prisma");
  const users = await prisma.user.findMany({
    where: {
      OR: [{ email: "phase8-e2e-admin@example.test" }, { email: { startsWith: "phase8-e2e-player-" } }],
    },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  await prisma.tournament.deleteMany({
    where: {
      OR: [
        { name: { startsWith: "Phase8 E2E" } },
        userIds.length > 0 ? { createdByUserId: { in: userIds } } : { id: "__never__" },
      ],
    },
  });
  if (userIds.length > 0) {
    await prisma.adminActionLog.deleteMany({ where: { adminUserId: { in: userIds } } });
  }
  await prisma.user.deleteMany({
    where: {
      OR: [{ email: "phase8-e2e-admin@example.test" }, { email: { startsWith: "phase8-e2e-player-" } }],
    },
  });
}

function multiplierPayload() {
  const tiers: Array<{ minXp: number | null; maxXp: number | null; sortOrder: number }> = [
    { minXp: null, maxXp: 1999, sortOrder: 1 },
  ];
  let sortOrder = 2;
  for (let minXp = 2000; minXp < 3000; minXp += 100) {
    tiers.push({ minXp, maxXp: minXp + 99, sortOrder });
    sortOrder += 1;
  }
  tiers.push({ minXp: 3000, maxXp: null, sortOrder });
  return tiers.map((tier) => ({ ...tier, multiplier: "1.0" }));
}

test.beforeEach(async () => {
  await cleanup();
});

test.afterEach(async () => {
  await cleanup();
});

test("32-player tournament can run qualifier, advancement, main event, and finish", async ({ baseURL, page }) => {
  expect(baseURL).toBeTruthy();
  const url = baseURL!;
  const admin = await login(url, "phase8-e2e-admin@example.test", "Phase8 E2E Admin", "ADMIN");
  const players = await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      login(
        url,
        `phase8-e2e-player-${String(index + 1).padStart(2, "0")}@example.test`,
        `E2E Player ${String(index + 1).padStart(2, "0")}`,
        "PLAYER",
      ),
    ),
  );

  const deniedCreate = await players[0].context.post("/api/tournaments", { data: { name: "Forbidden" } });
  expect(deniedCreate.status()).toBe(403);

  const created = await expectOk<{ tournament: { id: string } }>(
    await admin.context.post("/api/tournaments", {
      data: { name: `Phase8 E2E ${Date.now()}`, rankingVisibility: "ALL" },
    }),
  );
  const tournamentId = created.tournament.id;

  await expectOk(await admin.context.post(`/api/tournaments/${tournamentId}/stages`, { data: { names: ["Stage A", "Stage B", "Stage C"] } }));
  await expectOk(
    await admin.context.post(`/api/tournaments/${tournamentId}/rating-config`, {
      data: {
        initialRating: "1200",
        winBonus: "10",
        strongVotePoints: "8",
        weakVotePoints: "4",
        losingStreakPenalty: "25",
        xpTierStepSize: 100,
        multipliers: multiplierPayload(),
      },
    }),
  );
  await expectOk(await admin.context.post(`/api/tournaments/${tournamentId}/open-registration`));

  for (const [index, player] of players.entries()) {
    await expectOk(await player.context.post(`/api/tournaments/${tournamentId}/join`, { data: { areaXp: 1800 + index * 20 } }));
  }

  const qualifier = await expectOk<{ phase: { id: string } }>(
    await admin.context.post(`/api/tournaments/${tournamentId}/phases`, {
      data: {
        phaseType: "QUALIFIER",
        requiredMatchesPerPlayer: 5,
        advancePlayerCount: 16,
        advancementMode: "BLOCK",
        sortOrder: 1,
        rule: "AREA",
        stageSelectionMode: "RANDOM",
      },
    }),
  );
  const mainEvent = await expectOk<{ phase: { id: string } }>(
    await admin.context.post(`/api/tournaments/${tournamentId}/phases`, {
      data: {
        phaseType: "MAIN_EVENT",
        requiredMatchesPerPlayer: 1,
        advancementMode: "OVERALL",
        sortOrder: 2,
        rule: "YAGURA",
        stageSelectionMode: "RANDOM",
      },
    }),
  );

  await expectOk(
    await admin.context.post(`/api/phases/${qualifier.phase.id}/blocks`, {
      data: { blocks: ["A", "B", "C", "D"].map((name) => ({ name, advancePlayerCount: 4 })) },
    }),
  );
  await expectOk(await admin.context.post(`/api/phases/${qualifier.phase.id}/blocks/auto-assign`));
  await expectOk(await admin.context.post(`/api/tournaments/${tournamentId}/start`));
  await expectOk(await admin.context.post(`/api/phases/${qualifier.phase.id}/start`));

  async function completeMatch(matchId: string) {
    await expectOk(await admin.context.post(`/api/matches/${matchId}/start`));
    await expectOk(await admin.context.post(`/api/matches/${matchId}/open-result-reporting`));

    const matchResponse = await admin.context.get(`/api/matches/${matchId}`);
    const match = (await expectOk<{
      match: {
        teamA: Array<{ userId: string }>;
        teamB: Array<{ userId: string }>;
      };
    }>(matchResponse)).match;
    const playerById = new Map(players.map((player) => [player.id, player]));
    const allMatchUsers = [...match.teamA, ...match.teamB].map((player) => player.userId);

    const reporters = [...match.teamA.slice(0, 3), ...match.teamB.slice(0, 3)].map((player) => player.userId);
    for (const userId of reporters) {
      await expectOk(await playerById.get(userId)!.context.post(`/api/matches/${matchId}/result-reports`, { data: { reportedWinnerTeam: "A" } }));
    }

    for (const userId of allMatchUsers) {
      const ownTeam = match.teamA.some((player) => player.userId === userId) ? match.teamA : match.teamB;
      const opponents = ownTeam === match.teamA ? match.teamB : match.teamA;
      await expectOk(
        await playerById.get(userId)!.context.post(`/api/matches/${matchId}/player-votes`, {
          data: {
            votes: [
              { targetUserId: opponents[0].userId, voteType: "STRONG" },
              { targetUserId: opponents[1].userId, voteType: "WEAK" },
            ],
          },
        }),
      );
    }

    await expectOk(await admin.context.post(`/api/matches/${matchId}/apply-rating`));
  }

  async function queueAndComplete(phaseId: string, group: LoginUser[]) {
    for (const player of group) {
      await expectOk(await player.context.post(`/api/phases/${phaseId}/queue/join`));
    }
    const statusResponse = await group[0].context.get(`/api/phases/${phaseId}/queue/status`);
    const status = (await expectOk<{ status: string; matchId?: string | null }>(statusResponse));
    const matchId = status.matchId;
    expect(matchId).toBeTruthy();
    await completeMatch(matchId!);
  }

  for (let round = 0; round < 5; round += 1) {
    for (let group = 0; group < 4; group += 1) {
      await queueAndComplete(qualifier.phase.id, players.slice(group * 8, group * 8 + 8));
    }
  }

  await expectOk(await admin.context.post(`/api/phases/${qualifier.phase.id}/complete`));
  const advancementPreview = await expectOk<{
    blocks?: Array<{
      boundaryTieRows: Array<{ tournamentParticipantId: string }>;
      requiredAdminSelections: number;
    }>;
    boundaryTieRows?: Array<{ tournamentParticipantId: string }>;
    requiredAdminSelections?: number;
  }>(await admin.context.get(`/api/phases/${qualifier.phase.id}/advancement`));
  const selectedTournamentParticipantIds = advancementPreview.blocks
    ? advancementPreview.blocks.flatMap((block) =>
        block.boundaryTieRows.slice(0, block.requiredAdminSelections).map((row) => row.tournamentParticipantId),
      )
    : (advancementPreview.boundaryTieRows ?? [])
        .slice(0, advancementPreview.requiredAdminSelections ?? 0)
        .map((row) => row.tournamentParticipantId);
  await expectOk(
    await admin.context.post(`/api/phases/${qualifier.phase.id}/advancement`, {
      data: { selectedTournamentParticipantIds },
    }),
  );
  await expectOk(await admin.context.post(`/api/phases/${mainEvent.phase.id}/start`));

  const participantsAfterAdvancement = await expectOk<{ participants: Array<{ userId: string; advancedToMainEvent: boolean }> }>(
    await admin.context.get(`/api/tournaments/${tournamentId}/participants`),
  );
  const finalists = participantsAfterAdvancement.participants
    .filter((participant) => participant.advancedToMainEvent)
    .map((participant) => players.find((player) => player.id === participant.userId)!)
    .filter(Boolean);
  expect(finalists).toHaveLength(16);
  await queueAndComplete(mainEvent.phase.id, finalists.slice(0, 8));
  await queueAndComplete(mainEvent.phase.id, finalists.slice(8, 16));

  await expectOk(await admin.context.post(`/api/phases/${mainEvent.phase.id}/complete`));
  await expectOk(await admin.context.post(`/api/tournaments/${tournamentId}/finish`));

  const finalResponse = await admin.context.get(`/api/tournaments/${tournamentId}/participants`);
  const finalParticipants = (await expectOk<{ participants: Array<{ finalRank: number | null }> }>(finalResponse)).participants;
  expect(finalParticipants.filter((participant) => participant.finalRank !== null)).toHaveLength(32);

  const actionLogs = await expectOk<{ logs: Array<{ action: string }> }>(await admin.context.get("/api/admin/action-logs"));
  expect(actionLogs.logs.map((log) => log.action)).toEqual(
    expect.arrayContaining([
      "RATING_CONFIG_CREATED",
      "TOURNAMENT_STARTED",
      "PHASE_STARTED",
      "PHASE_COMPLETED",
      "QUALIFIER_ADVANCEMENT_CONFIRMED",
      "TOURNAMENT_FINISHED",
      "PHASE_BLOCKS_CREATED",
      "PHASE_BLOCKS_AUTO_ASSIGNED",
    ]),
  );

  const playerLogs = await players[0].context.get("/api/admin/action-logs");
  expect(playerLogs.status()).toBe(403);
  const unrelatedMatch = await players[31].context.get(`/api/matches/not-a-real-match-id`);
  expect(unrelatedMatch.status()).toBe(404);

  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/tournaments/${tournamentId}/ranking`);
  await expect(page.getByRole("heading", { name: /ランキング/ })).toBeVisible();
  await page.goto(`/tournaments/${tournamentId}`);
  await expect(page.getByText(/Phase8 E2E/)).toBeVisible();

  await Promise.all([admin.context.dispose(), ...players.map((player) => player.context.dispose())]);
});
