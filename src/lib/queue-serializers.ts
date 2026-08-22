import type { QueueEntry } from "@prisma/client";

export function serializeQueueEntry(entry: QueueEntry) {
  return {
    ...entry,
    joinedAt: entry.joinedAt.toISOString(),
    matchedAt: entry.matchedAt?.toISOString() ?? null,
  };
}
