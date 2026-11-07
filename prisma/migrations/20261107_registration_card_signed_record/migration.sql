-- 20261026_guided_check_in gained "signedRecord" after an earlier version of it had already been applied to some
-- databases (production among them). `prisma migrate deploy` skips a migration it has recorded, so those databases
-- never got the column and every read of a registration card failed. Add it where it's missing; a no-op elsewhere.
-- Cards signed before this have no record kept (empty), only their documentHash.
ALTER TABLE "registration_cards" ADD COLUMN IF NOT EXISTS "signedRecord" TEXT NOT NULL DEFAULT '';
ALTER TABLE "registration_cards" ALTER COLUMN "signedRecord" DROP DEFAULT;
