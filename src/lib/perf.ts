import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

type SlowQuery = {
  durationMs: number;
  model?: string;
  action?: string;
  query: string;
};

type PerfContext = {
  calculationMs: number;
  dbMs: number;
  name: string;
  queryCount: number;
  segments: Record<string, number>;
  slowQueries: SlowQuery[];
  startedAt: number;
};

const storage = new AsyncLocalStorage<PerfContext>();
const SLOW_QUERY_MS = Number(process.env.PERF_SLOW_QUERY_MS ?? 100);

function rounded(value: number) {
  return Math.round(value);
}

function scrubQuery(query: string) {
  return query.replace(/\s+/g, " ").trim().slice(0, 240);
}

export function prismaQueryLoggingEnabled() {
  return process.env.PERF_PRISMA_QUERIES !== "0";
}

export function recordPrismaQuery(event: { duration: number; query: string; params?: string; target?: string }) {
  const context = storage.getStore();
  if (context) {
    context.dbMs += event.duration;
    context.queryCount += 1;
    if (event.duration >= SLOW_QUERY_MS) {
      context.slowQueries.push({
        durationMs: rounded(event.duration),
        query: scrubQuery(event.query),
      });
    }
    return;
  }

  if (event.duration >= SLOW_QUERY_MS) {
    console.warn("PERF prisma-slow-query", {
      durationMs: rounded(event.duration),
      query: scrubQuery(event.query),
    });
  }
}

export async function withPerf<T>(name: string, fn: () => Promise<T>) {
  const context: PerfContext = {
    calculationMs: 0,
    dbMs: 0,
    name,
    queryCount: 0,
    segments: {},
    slowQueries: [],
    startedAt: performance.now(),
  };

  return storage.run(context, async () => {
    try {
      return await fn();
    } finally {
      const totalMs = performance.now() - context.startedAt;
      console.info(`PERF ${name}`, {
        totalMs: rounded(totalMs),
        dbMs: rounded(context.dbMs),
        calculationMs: rounded(context.calculationMs),
        queryCount: context.queryCount,
        slowQueries: context.slowQueries.slice(0, 10),
        segments: Object.fromEntries(Object.entries(context.segments).map(([key, value]) => [key, rounded(value)])),
      });
    }
  });
}

export async function perfSegment<T>(name: string, kind: "calculation" | "db" | "other", fn: () => Promise<T> | T) {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    const duration = performance.now() - startedAt;
    const context = storage.getStore();
    if (context) {
      context.segments[name] = (context.segments[name] ?? 0) + duration;
      if (kind === "calculation") context.calculationMs += duration;
      if (kind === "db" && context.queryCount === 0) context.dbMs += duration;
    }
  }
}
