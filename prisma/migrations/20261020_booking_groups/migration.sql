-- Bookings that mix room types: one reservation per type, linked by the lead reservation's code.
ALTER TABLE "bookings" ADD COLUMN "groupCode" TEXT;
CREATE INDEX "bookings_groupCode_idx" ON "bookings"("groupCode");
