-- Front desk payments: security deposits, card readers (Stripe Terminal), cards typed in at the desk,
-- OTA virtual cards and cash. Additive: existing online payments keep their values.
CREATE TYPE "SecurityDepositMode" AS ENUM ('NONE', 'HOLD', 'CHARGE');

ALTER TABLE "properties"
  ADD COLUMN "securityDepositMode" "SecurityDepositMode" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "securityDepositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN "stripeTerminalLocationId" TEXT;

-- Cash has no PaymentIntent; a desk card payment gets one when its Stripe page is completed.
ALTER TABLE "payments" ALTER COLUMN "stripePaymentIntentId" DROP NOT NULL;
ALTER TABLE "payments"
  ADD COLUMN "method" TEXT NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "amountAuthorized" DECIMAL(10,2),
  ADD COLUMN "captureBefore" TIMESTAMP(3),
  ADD COLUMN "terminalReaderId" TEXT,
  ADD COLUMN "cashTendered" DECIMAL(10,2),
  ADD COLUMN "settledAt" TIMESTAMP(3),
  ADD COLUMN "recordedById" TEXT,
  ADD COLUMN "note" TEXT;
CREATE INDEX "payments_stripeCheckoutSessionId_idx" ON "payments"("stripeCheckoutSessionId");

ALTER TABLE "channel_reservations" ADD COLUMN "paymentCard" JSONB;
