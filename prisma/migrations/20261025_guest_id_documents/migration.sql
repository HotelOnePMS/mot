-- Guest ID photos taken at check-in (encrypted), and each hotel's rules for them.
ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "requireGuestId" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "guestIdRetentionDays" INTEGER NOT NULL DEFAULT 30;

CREATE TYPE "GuestIdType" AS ENUM ('DRIVERS_LICENSE', 'PASSPORT', 'NATIONAL_ID', 'OTHER');
CREATE TYPE "GuestIdSide" AS ENUM ('FRONT', 'BACK');

CREATE TABLE "guest_id_documents" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" "GuestIdType" NOT NULL DEFAULT 'DRIVERS_LICENSE',
    "side" "GuestIdSide" NOT NULL DEFAULT 'FRONT',
    "nameOnId" TEXT,
    "numberLast4" TEXT,
    "expiresOn" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "encrypted" BYTEA NOT NULL,
    "capturedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_id_documents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "guest_id_documents_bookingId_idx" ON "guest_id_documents"("bookingId");
CREATE INDEX "guest_id_documents_propertyId_createdAt_idx" ON "guest_id_documents"("propertyId", "createdAt");

ALTER TABLE "guest_id_documents" ADD CONSTRAINT "guest_id_documents_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "guest_id_documents" ADD CONSTRAINT "guest_id_documents_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
