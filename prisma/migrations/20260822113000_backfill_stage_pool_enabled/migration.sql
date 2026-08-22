-- Backfill existing tournaments that already have at least one stage.
UPDATE "Tournament" AS "t"
SET "stagePoolEnabled" = true
WHERE EXISTS (
  SELECT 1
  FROM "TournamentStage" AS "s"
  WHERE "s"."tournamentId" = "t"."id"
);
