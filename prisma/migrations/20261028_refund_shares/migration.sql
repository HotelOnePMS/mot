-- Which room type of a reservation booked together each refund was for, so a refund stays with that room type.
-- CreateTable
CREATE TABLE "refund_shares" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "refund_shares_bookingId_idx" ON "refund_shares"("bookingId");

-- CreateIndex
CREATE INDEX "refund_shares_paymentId_idx" ON "refund_shares"("paymentId");

-- AddForeignKey
ALTER TABLE "refund_shares" ADD CONSTRAINT "refund_shares_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_shares" ADD CONSTRAINT "refund_shares_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
