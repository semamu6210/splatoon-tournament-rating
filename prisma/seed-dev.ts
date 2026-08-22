import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const isLocalDatabase =
  process.env.DATABASE_URL?.includes("localhost") ||
  process.env.DATABASE_URL?.includes("127.0.0.1");

if (!isLocalDatabase && process.env.SEED_DEV_CONFIRM !== "true") {
  throw new Error("Refusing to seed a non-local database. Set SEED_DEV_CONFIRM=true only for an isolated development database.");
}

const { prisma } = await import("../src/lib/prisma");
const { buildDefaultMultiplierPayload } = await import("../src/lib/rating-config");
const { createRatingConfigVersion, joinTournament, openRegistration, startTournament } = await import("../src/lib/tournament-service");
const { createPhase } = await import("../src/lib/phase-service");
const { autoAssignPhaseBlocks, createPhaseBlocks } = await import("../src/lib/block-service");

const tournamentName = "Phase8 Dev Tournament";
const adminEmail = "phase8-admin@example.test";

async function main() {
  const existing = await prisma.tournament.findFirst({ where: { name: tournamentName } });
  if (existing) {
    await prisma.tournament.delete({ where: { id: existing.id } });
  }

  await prisma.user.deleteMany({
    where: {
      OR: [{ email: adminEmail }, { email: { startsWith: "phase8-player-" } }],
    },
  });

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      name: "Phase8 Admin",
      discordUsername: "phase8-admin",
      role: "ADMIN",
    },
  });

  const players = await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      prisma.user.create({
        data: {
          email: `phase8-player-${String(index + 1).padStart(2, "0")}@example.test`,
          name: `Phase8 Player ${String(index + 1).padStart(2, "0")}`,
          discordUsername: `phase8-p${String(index + 1).padStart(2, "0")}`,
          role: "PLAYER",
        },
      }),
    ),
  );

  const tournament = await prisma.tournament.create({
    data: {
      name: tournamentName,
      createdByUserId: admin.id,
      status: "DRAFT",
      rankingVisibility: "ALL",
    },
  });

  await createRatingConfigVersion(admin.id, tournament.id, {
    initialRating: "1200",
    winBonus: "10",
    strongVotePoints: "8",
    weakVotePoints: "4",
    losingStreakPenalty: "25",
    xpTierStepSize: 100,
    multipliers: buildDefaultMultiplierPayload(100).map((tier) => ({
      ...tier,
      multiplier: tier.sortOrder % 3 === 0 ? "1.10" : tier.sortOrder % 3 === 1 ? "1.00" : "0.95",
    })),
  });

  await prisma.tournamentStage.createMany({
    data: ["ユノハナ大渓谷", "ゴンズイ地区", "マテガイ放水路", "ナンプラー遺跡"].map((name, index) => ({
      tournamentId: tournament.id,
      name,
      sortOrder: index + 1,
    })),
  });

  await openRegistration(admin.id, tournament.id);

  await Promise.all(
    players.map((player, index) =>
      joinTournament(player.id, tournament.id, {
        areaXp: 1800 + ((index * 73) % 900),
        participantName: player.discordUsername ?? player.name ?? `Player ${index + 1}`,
      }),
    ),
  );

  const qualifier = await createPhase(admin.id, tournament.id, {
    phaseType: "QUALIFIER",
    requiredMatchesPerPlayer: 5,
    advancePlayerCount: 16,
    advancementMode: "BLOCK",
    sortOrder: 1,
    rule: "AREA",
    stageSelectionMode: "RANDOM",
  });
  const mainEvent = await createPhase(admin.id, tournament.id, {
    phaseType: "MAIN_EVENT",
    requiredMatchesPerPlayer: 1,
    advancePlayerCount: null,
    advancementMode: "OVERALL",
    sortOrder: 2,
    rule: "YAGURA",
    stageSelectionMode: "RANDOM",
  });

  await createPhaseBlocks(
    qualifier.id,
    {
      blocks: ["Block A", "Block B", "Block C", "Block D"].map((name) => ({ name, advancePlayerCount: 4 })),
    },
    admin.id,
  );
  await autoAssignPhaseBlocks(qualifier.id, admin.id);
  await startTournament(admin.id, tournament.id);

  console.log(`Seeded ${tournamentName}`);
  console.log(`Admin: ${admin.email}`);
  console.log(`Players: ${players.length}`);
  console.log(`Qualifier phase: ${qualifier.id}`);
  console.log(`Main event phase: ${mainEvent.id}`);
}

await main();
await prisma.$disconnect();
