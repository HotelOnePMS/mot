-- Do Not Rent: each hotel's own list of guests not to rent to again, matched on email or phone.
CREATE TABLE "do_not_rent" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "email" TEXT,
    "phoneKey" TEXT,
    "phone" TEXT,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "do_not_rent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "do_not_rent_propertyId_email_idx" ON "do_not_rent"("propertyId", "email");
CREATE INDEX "do_not_rent_propertyId_phoneKey_idx" ON "do_not_rent"("propertyId", "phoneKey");

ALTER TABLE "do_not_rent" ADD CONSTRAINT "do_not_rent_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "do_not_rent" ADD CONSTRAINT "do_not_rent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
