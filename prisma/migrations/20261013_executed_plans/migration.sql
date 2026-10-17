-- Single-use signed agent plans: the nonce is claimed before any step runs,
-- so concurrent confirms (double-click, two server instances) execute once.
CREATE TABLE "executed_plans" (
    "nonce" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "executed_plans_pkey" PRIMARY KEY ("nonce")
);
