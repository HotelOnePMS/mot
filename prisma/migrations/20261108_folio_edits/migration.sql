-- Editing the folio: the owner can change every line, and give that to other staff roles at their hotel.
-- Additive only (a new table and a nullable column), so deployments still on the previous code keep working
-- against the same database.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "folioRoomLabel" TEXT;

-- CreateTable
CREATE TABLE "role_permission_grants" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "permission" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_grants_propertyId_role_permission_key" ON "role_permission_grants"("propertyId", "role", "permission");

-- AddForeignKey
ALTER TABLE "role_permission_grants" ADD CONSTRAINT "role_permission_grants_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
