CREATE TABLE "QueueStatusEvent" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "matchId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueStatusEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatchStatusEvent" (
    "matchId" TEXT NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "winnerTeam" "Team",
    "votingClosedAt" TIMESTAMP(3),
    "ratingAppliedAt" TIMESTAMP(3),
    "submittedVoterCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchStatusEvent_pkey" PRIMARY KEY ("matchId")
);

CREATE UNIQUE INDEX "QueueStatusEvent_queueEntryId_key" ON "QueueStatusEvent"("queueEntryId");
CREATE INDEX "QueueStatusEvent_queueEntryId_updatedAt_idx" ON "QueueStatusEvent"("queueEntryId", "updatedAt");
CREATE INDEX "MatchStatusEvent_updatedAt_idx" ON "MatchStatusEvent"("updatedAt");

ALTER TABLE "QueueStatusEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchStatusEvent" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "QueueStatusEvent_public_minimal_read" ON "QueueStatusEvent" FOR SELECT USING (true);
CREATE POLICY "MatchStatusEvent_public_minimal_read" ON "MatchStatusEvent" FOR SELECT USING (true);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "QueueStatusEvent";
    ALTER PUBLICATION supabase_realtime ADD TABLE "MatchStatusEvent";
  END IF;
END $$;
