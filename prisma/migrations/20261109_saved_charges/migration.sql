-- Saved charges: extras a hotel adds to folios often (pet fee, late check-out) with their usual price, used when
-- adding a charge by hand and by the agent. Additive only (a new table), so deployments still on the previous code
-- keep working against the same database.

-- CreateTable
CREATE TABLE "saved_charges" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'STAY',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "saved_charges_propertyId_name_key" ON "saved_charges"("propertyId", "name");

-- AddForeignKey
ALTER TABLE "saved_charges" ADD CONSTRAINT "saved_charges_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
