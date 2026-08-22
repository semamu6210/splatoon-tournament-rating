import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaPgPool?: Pool;
};

function getRuntimeDatabaseUrl() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }

  return connectionString;
}

function getPrismaPgPool() {
  if (globalForPrisma.prismaPgPool) {
    return globalForPrisma.prismaPgPool;
  }

  const connectionString = getRuntimeDatabaseUrl();
  const defaultPoolMax = process.env.NODE_ENV === "production" ? 1 : process.env.NODE_ENV === "test" ? 2 : 10;
  const max = Number(process.env.DATABASE_POOL_MAX ?? defaultPoolMax);
  const pool = new Pool({
    connectionString,
    max: Number.isFinite(max) && max > 0 ? max : 1,
  });

  globalForPrisma.prismaPgPool = pool;
  return pool;
}

function createPrismaClient() {
  const adapter = new PrismaPg(getPrismaPgPool());

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = prisma;

export async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      message: "Connected",
    };
  } catch (error) {
    return {
      ok: false,
      message:
        process.env.NODE_ENV === "production"
          ? "Database connection failed."
          : error instanceof Error
            ? error.message
            : "Unknown database error",
    };
  }
}
