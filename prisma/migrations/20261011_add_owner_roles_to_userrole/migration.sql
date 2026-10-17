-- Add OWNER, MANAGER, FRONT_DESK, HOUSEKEEPER to the UserRole enum.
-- Done via type recreation (not ALTER TYPE ... ADD VALUE) because the latter
-- cannot run inside the transaction that `prisma migrate deploy` uses.
-- The column DEFAULT must be dropped first: Postgres cannot auto-cast a
-- default expression during ALTER COLUMN ... TYPE.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

CREATE TYPE "UserRole_new" AS ENUM ('ADMIN', 'CUSTOMER', 'OWNER', 'MANAGER', 'FRONT_DESK', 'HOUSEKEEPER');

ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole_new" USING "role"::text::"UserRole_new";

ALTER TYPE "UserRole" RENAME TO "UserRole_old";
ALTER TYPE "UserRole_new" RENAME TO "UserRole";
DROP TYPE "UserRole_old";

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'CUSTOMER';
