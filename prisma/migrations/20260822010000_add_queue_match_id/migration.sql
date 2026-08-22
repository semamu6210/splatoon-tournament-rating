ALTER TABLE "QueueEntry" ADD COLUMN "matchId" TEXT;

CREATE INDEX "QueueEntry_matchId_idx" ON "QueueEntry"("matchId");

CREATE UNIQUE INDEX "QueueEntry_one_waiting_per_phase_user_idx"
ON "QueueEntry"("phaseId", "userId")
WHERE "status" = 'WAITING';

ALTER TABLE "QueueEntry"
ADD CONSTRAINT "QueueEntry_matchId_fkey"
FOREIGN KEY ("matchId") REFERENCES "Match"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
