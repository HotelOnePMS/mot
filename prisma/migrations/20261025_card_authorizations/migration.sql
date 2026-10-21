-- Third-party payment: the cardholder's signed authorization (details, ID, signature) for someone else's stay.
-- CreateTable
CREATE TABLE "card_authorizations" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cardholderName" TEXT NOT NULL,
    "cardholderEmail" TEXT,
    "guestNames" TEXT[],
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "coversIncidentals" BOOLEAN NOT NULL DEFAULT false,
    "incidentalsLimit" DECIMAL(10,2),
    "paymentId" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "requestedById" TEXT NOT NULL,
    "emailedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "signerName" TEXT,
    "signerEmail" TEXT,
    "signerPhone" TEXT,
    "billingAddress" JSONB,
    "signerCardBrand" TEXT,
    "signerCardLast4" TEXT,
    "idType" TEXT,
    "idCountry" TEXT,
    "idLast4" TEXT,
    "signatureMethod" TEXT,
    "signatureImage" TEXT,
    "textVersion" TEXT,
    "text" TEXT,
    "textHash" TEXT,
    "documentHash" TEXT,
    "checks" JSONB,
    "signedAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "reviewNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "idPhotoPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_authorization_id_photos" (
    "authorizationId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "cipher" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_authorization_id_photos_pkey" PRIMARY KEY ("authorizationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "card_authorizations_tokenHash_key" ON "card_authorizations"("tokenHash");

-- CreateIndex
CREATE INDEX "card_authorizations_bookingId_idx" ON "card_authorizations"("bookingId");

-- CreateIndex
CREATE INDEX "card_authorizations_propertyId_createdAt_idx" ON "card_authorizations"("propertyId", "createdAt");

-- AddForeignKey
ALTER TABLE "card_authorizations" ADD CONSTRAINT "card_authorizations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_authorizations" ADD CONSTRAINT "card_authorizations_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_authorization_id_photos" ADD CONSTRAINT "card_authorization_id_photos_authorizationId_fkey" FOREIGN KEY ("authorizationId") REFERENCES "card_authorizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

