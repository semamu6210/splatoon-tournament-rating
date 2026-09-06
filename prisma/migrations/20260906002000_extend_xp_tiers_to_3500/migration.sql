UPDATE "TournamentXpMultiplierTier"
SET "maxXp" = 3099
WHERE "minXp" = 3000
  AND "maxXp" IS NULL
  AND "tournamentRatingConfigId" IN (
    SELECT "id" FROM "TournamentRatingConfig" WHERE "xpTierStepSize" = 100
  );

INSERT INTO "TournamentXpMultiplierTier" (
  "id",
  "tournamentRatingConfigId",
  "minXp",
  "maxXp",
  "multiplier",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  tier."tournamentRatingConfigId",
  generated."minXp",
  generated."maxXp",
  tier."multiplier",
  generated."sortOrder",
  NOW(),
  NOW()
FROM "TournamentXpMultiplierTier" tier
JOIN "TournamentRatingConfig" config ON config."id" = tier."tournamentRatingConfigId"
CROSS JOIN (VALUES
  (3100, 3199, 13),
  (3200, 3299, 14),
  (3300, 3399, 15),
  (3400, 3499, 16),
  (3500, NULL, 17)
) AS generated("minXp", "maxXp", "sortOrder")
WHERE config."xpTierStepSize" = 100
  AND tier."minXp" = 3000
  AND tier."maxXp" = 3099
ON CONFLICT ("tournamentRatingConfigId", "sortOrder") DO NOTHING;

UPDATE "TournamentXpMultiplierTier"
SET "maxXp" = 3049
WHERE "minXp" = 3000
  AND "maxXp" IS NULL
  AND "tournamentRatingConfigId" IN (
    SELECT "id" FROM "TournamentRatingConfig" WHERE "xpTierStepSize" = 50
  );

INSERT INTO "TournamentXpMultiplierTier" (
  "id",
  "tournamentRatingConfigId",
  "minXp",
  "maxXp",
  "multiplier",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  tier."tournamentRatingConfigId",
  generated."minXp",
  generated."maxXp",
  tier."multiplier",
  generated."sortOrder",
  NOW(),
  NOW()
FROM "TournamentXpMultiplierTier" tier
JOIN "TournamentRatingConfig" config ON config."id" = tier."tournamentRatingConfigId"
CROSS JOIN (VALUES
  (3050, 3099, 23),
  (3100, 3149, 24),
  (3150, 3199, 25),
  (3200, 3249, 26),
  (3250, 3299, 27),
  (3300, 3349, 28),
  (3350, 3399, 29),
  (3400, 3449, 30),
  (3450, 3499, 31),
  (3500, NULL, 32)
) AS generated("minXp", "maxXp", "sortOrder")
WHERE config."xpTierStepSize" = 50
  AND tier."minXp" = 3000
  AND tier."maxXp" = 3049
ON CONFLICT ("tournamentRatingConfigId", "sortOrder") DO NOTHING;
