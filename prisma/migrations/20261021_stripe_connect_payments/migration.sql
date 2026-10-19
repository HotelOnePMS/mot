-- CreateEnum
CREATE TYPE "PaymentPolicy" AS ENUM ('PAY_AT_PROPERTY', 'DEPOSIT', 'FULL_PREPAYMENT');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "depositNights" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "paymentPolicy" "PaymentPolicy" NOT NULL DEFAULT 'PAY_AT_PROPERTY',
ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "paymentDue" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "stripeCheckoutSessionId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'FULL',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "amountRefunded" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "applicationFee" DECIMAL(10,2),
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "cardholderName" TEXT,
    "billingEmail" TEXT,
    "billingCountry" TEXT,
    "cardCountry" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "threeDSecure" TEXT,
    "riskLevel" TEXT,
    "riskScore" INTEGER,
    "failureMessage" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "bookingId" TEXT,
    "propertyId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "reason" TEXT,
    "status" TEXT NOT NULL,
    "evidenceDueBy" TIMESTAMP(3),
    "evidenceSummary" JSONB,
    "evidenceSubmittedAt" TIMESTAMP(3),
    "evidenceSubmittedById" TEXT,
    "ownerNotifiedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_policy_acceptances" (
    "bookingId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "booking_policy_acceptances_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "booking_checklists" (
    "bookingId" TEXT NOT NULL,
    "idMatchedAt" TIMESTAMP(3),
    "idMatchedById" TEXT,
    "cardShownAt" TIMESTAMP(3),
    "cardShownById" TEXT,
    "registrationSignedAt" TIMESTAMP(3),
    "registrationSignedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_checklists_pkey" PRIMARY KEY ("bookingId")
);

-- CreateTable
CREATE TABLE "stripe_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "account" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "stripe_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripePaymentIntentId_key" ON "payments"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripeChargeId_key" ON "payments"("stripeChargeId");

-- CreateIndex
CREATE INDEX "payments_bookingId_idx" ON "payments"("bookingId");

-- CreateIndex
CREATE INDEX "payments_propertyId_createdAt_idx" ON "payments"("propertyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_stripeDisputeId_key" ON "disputes"("stripeDisputeId");

-- CreateIndex
CREATE INDEX "disputes_propertyId_createdAt_idx" ON "disputes"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "disputes_bookingId_idx" ON "disputes"("bookingId");

-- CreateIndex
CREATE INDEX "stripe_events_processedAt_startedAt_idx" ON "stripe_events"("processedAt", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "properties_stripeAccountId_key" ON "properties"("stripeAccountId");

-- CreateIndex
CREATE INDEX "bookings_status_paymentStatus_expiresAt_idx" ON "bookings"("status", "paymentStatus", "expiresAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_policy_acceptances" ADD CONSTRAINT "booking_policy_acceptances_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_checklists" ADD CONSTRAINT "booking_checklists_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

