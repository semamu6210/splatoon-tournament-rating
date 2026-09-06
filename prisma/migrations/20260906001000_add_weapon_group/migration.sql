CREATE TYPE "WeaponGroup" AS ENUM ('BACK', 'MID', 'FRONT');

ALTER TABLE "TournamentParticipant"
ADD COLUMN "weaponGroup" "WeaponGroup" NOT NULL DEFAULT 'MID';

ALTER TABLE "MatchPlayer"
ADD COLUMN "weaponGroupAtMatch" "WeaponGroup" NOT NULL DEFAULT 'MID';
