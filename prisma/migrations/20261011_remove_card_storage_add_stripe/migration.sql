-- Remove raw card data storage (PCI compliance).
-- Card numbers and CVVs must never be stored; online payments go through Stripe.
ALTER TABLE "bookings" DROP COLUMN IF EXISTS "cardNumber",
                       DROP COLUMN IF EXISTS "cardCvv",
                       DROP COLUMN IF EXISTS "cardExpMonth",
                       DROP COLUMN IF EXISTS "cardExpYear";

-- Stripe payment tracking + payment status
ALTER TABLE "bookings" ADD COLUMN     "paymentStatus" TEXT DEFAULT 'UNPAID',
                       ADD COLUMN     "stripeCheckoutSessionId" TEXT,
                       ADD COLUMN     "stripePaymentIntentId" TEXT;
