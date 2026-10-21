-- Guided check-in: the guest's photo ID (clear summary, sealed details and photo) and the signed registration card.
-- CreateTable
CREATE TABLE "guest_identifications" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "idType" TEXT NOT NULL,
    "idCountry" TEXT,
    "idRegion" TEXT,
    "idLast4" TEXT NOT NULL,
    "expiresOn" DATE,
    "nameOnId" TEXT NOT NULL,
    "nameMatched" BOOLEAN NOT NULL,
    "adult" BOOLEAN,
    "confirmedById" TEXT NOT NULL,
    "detailsCipher" TEXT,
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_identifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_identification_photos" (
    "guestIdentificationId" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "cipher" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_identification_photos_pkey" PRIMARY KEY ("guestIdentificationId")
);

-- CreateTable
CREATE TABLE "registration_cards" (
    "bookingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "signatureMethod" TEXT NOT NULL,
    "signatureImage" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "witnessedById" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_cards_pkey" PRIMARY KEY ("bookingId")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_identifications_bookingId_key" ON "guest_identifications"("bookingId");

-- CreateIndex
CREATE INDEX "guest_identifications_propertyId_createdAt_idx" ON "guest_identifications"("propertyId", "createdAt");

-- CreateIndex
CREATE INDEX "registration_cards_propertyId_signedAt_idx" ON "registration_cards"("propertyId", "signedAt");

-- AddForeignKey
ALTER TABLE "guest_identifications" ADD CONSTRAINT "guest_identifications_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_identifications" ADD CONSTRAINT "guest_identifications_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_identification_photos" ADD CONSTRAINT "guest_identification_photos_guestIdentificationId_fkey" FOREIGN KEY ("guestIdentificationId") REFERENCES "guest_identifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_cards" ADD CONSTRAINT "registration_cards_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_cards" ADD CONSTRAINT "registration_cards_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Check-out now needs a zero balance, and the balance counts money paid at the desk. Reservations marked paid at
-- the desk before desk payments were recorded have no payment behind them, so their balance would read as the full
-- total. Record that payment once ("paid another way"). Lines of a reservation whose one payment sits on its lead
-- line are left alone.
INSERT INTO "payments" ("id", "bookingId", "propertyId", "kind", "method", "status", "amount", "currency", "note", "paidAt", "createdAt", "updatedAt")
SELECT 'pb' || substr(md5(b."id" || 'desk-paid'), 1, 23), b."id", b."propertyId", 'PAYMENT', 'OTHER', 'SUCCEEDED', b."totalPrice", lower(b."currency"),
       'Marked as paid when booked, before desk payments were recorded', b."createdAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "bookings" b
WHERE b."paymentStatus" = 'PAID'
  AND b."status" NOT IN ('CANCELLED', 'NO_SHOW')
  AND NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."bookingId" = b."id" AND p."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'))
  AND NOT EXISTS (
    SELECT 1 FROM "payments" p JOIN "bookings" l ON l."id" = p."bookingId"
    WHERE b."groupCode" IS NOT NULL AND l."code" = b."groupCode" AND p."status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED')
  );
