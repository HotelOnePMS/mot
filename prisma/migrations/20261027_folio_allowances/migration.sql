-- Allowances lower what a stay costs (a manager, with a reason); a guest can be checked out owing money with a
-- manager's reason. Both feed the balance that check-out needs at zero.
-- CreateTable
CREATE TABLE "folio_allowances" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,

    CONSTRAINT "folio_allowances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_overrides" (
    "bookingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_overrides_pkey" PRIMARY KEY ("bookingId")
);

-- CreateIndex
CREATE INDEX "folio_allowances_bookingId_idx" ON "folio_allowances"("bookingId");

-- CreateIndex
CREATE INDEX "folio_allowances_propertyId_createdAt_idx" ON "folio_allowances"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "checkout_overrides_propertyId_createdAt_idx" ON "checkout_overrides"("propertyId", "createdAt");

-- AddForeignKey
ALTER TABLE "folio_allowances" ADD CONSTRAINT "folio_allowances_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_allowances" ADD CONSTRAINT "folio_allowances_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_overrides" ADD CONSTRAINT "checkout_overrides_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_overrides" ADD CONSTRAINT "checkout_overrides_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

