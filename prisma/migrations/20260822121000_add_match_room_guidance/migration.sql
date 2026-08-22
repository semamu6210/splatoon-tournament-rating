-- Match room guidance for matched players.
ALTER TABLE "Match" ADD COLUMN "privateRoomCode" TEXT;
ALTER TABLE "Match" ADD COLUMN "roomHostUserId" TEXT;

CREATE INDEX "Match_privateRoomCode_idx" ON "Match"("privateRoomCode");
CREATE INDEX "Match_roomHostUserId_idx" ON "Match"("roomHostUserId");

ALTER TABLE "Match"
ADD CONSTRAINT "Match_roomHostUserId_fkey"
FOREIGN KEY ("roomHostUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

-- Active matches must not share the same private-room code.
CREATE UNIQUE INDEX "Match_active_privateRoomCode_key"
ON "Match"("privateRoomCode")
WHERE "privateRoomCode" IS NOT NULL
  AND "status" IN ('CREATED', 'PLAYING', 'RESULT_REPORTING', 'VOTE_REPORTING');
