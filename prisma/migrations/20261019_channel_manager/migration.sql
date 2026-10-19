-- OTA channel manager (Expedia, Booking.com): connections, room mappings,
-- channel prices and restrictions, promotions, imported OTA reservations,
-- sync log, and the channel agent's conversations. Additive only; existing
-- bookings get source DIRECT.

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('DIRECT', 'EXPEDIA', 'BOOKING_COM');

-- CreateEnum
CREATE TYPE "OtaChannel" AS ENUM ('EXPEDIA', 'BOOKING_COM');

-- CreateEnum
CREATE TYPE "ChannelMode" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('DRAFT', 'CONNECTED', 'ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "PromotionType" AS ENUM ('BASIC', 'EARLY_BOOKER', 'LAST_MINUTE', 'MULTI_NIGHT');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelReservationStatus" AS ENUM ('BOOKED', 'MODIFIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncLogStatus" AS ENUM ('SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "ChannelAgentActionStatus" AS ENUM ('EXECUTED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'DIRECT';

-- CreateTable
CREATE TABLE "channel_connections" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "channel" "OtaChannel" NOT NULL,
    "mode" "ChannelMode" NOT NULL DEFAULT 'SANDBOX',
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'DRAFT',
    "otaPropertyId" TEXT,
    "otaPropertyName" TEXT,
    "username" TEXT,
    "passwordCipher" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "defaultMarkupPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "syncRates" BOOLEAN NOT NULL DEFAULT true,
    "syncAvailability" BOOLEAN NOT NULL DEFAULT true,
    "importReservations" BOOLEAN NOT NULL DEFAULT true,
    "syncWindowDays" INTEGER NOT NULL DEFAULT 365,
    "lastAriSyncAt" TIMESTAMP(3),
    "lastReservationPullAt" TIMESTAMP(3),
    "lastError" TEXT,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_room_mappings" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "otaRoomTypeId" TEXT NOT NULL,
    "otaRoomTypeName" TEXT,
    "otaRatePlanId" TEXT NOT NULL,
    "otaRatePlanName" TEXT,
    "markupPercent" DECIMAL(5,2),
    "inventoryAllocation" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_room_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_rate_overrides" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "roomTypeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "price" DECIMAL(10,2),
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "minStay" INTEGER,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_rate_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_promotions" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "type" "PromotionType" NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "stayStart" DATE NOT NULL,
    "stayEnd" DATE NOT NULL,
    "bookStart" DATE,
    "bookEnd" DATE,
    "minStay" INTEGER,
    "minDaysInAdvance" INTEGER,
    "maxDaysInAdvance" INTEGER,
    "roomTypeIds" TEXT[],
    "status" "PromotionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_reservations" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "bookingId" TEXT,
    "status" "ChannelReservationStatus" NOT NULL DEFAULT 'BOOKED',
    "guestName" TEXT,
    "totalAmount" DECIMAL(10,2),
    "currency" TEXT,
    "rawPayload" JSONB,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_sync_logs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" "SyncLogStatus" NOT NULL,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_agent_conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "messages" TEXT NOT NULL DEFAULT '[]',
    "pending" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_agent_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_agent_actions" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "status" "ChannelAgentActionStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_connections_propertyId_channel_key" ON "channel_connections"("propertyId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "channel_room_mappings_connectionId_roomTypeId_key" ON "channel_room_mappings"("connectionId", "roomTypeId");

-- CreateIndex
CREATE INDEX "channel_rate_overrides_date_idx" ON "channel_rate_overrides"("date");

-- CreateIndex
CREATE UNIQUE INDEX "channel_rate_overrides_connectionId_roomTypeId_date_key" ON "channel_rate_overrides"("connectionId", "roomTypeId", "date");

-- CreateIndex
CREATE INDEX "channel_promotions_connectionId_status_idx" ON "channel_promotions"("connectionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "channel_reservations_bookingId_key" ON "channel_reservations"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_reservations_connectionId_externalId_key" ON "channel_reservations"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "channel_sync_logs_connectionId_createdAt_idx" ON "channel_sync_logs"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "channel_agent_conversations_userId_updatedAt_idx" ON "channel_agent_conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "channel_agent_actions_conversationId_idx" ON "channel_agent_actions"("conversationId");

-- AddForeignKey
ALTER TABLE "channel_connections" ADD CONSTRAINT "channel_connections_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_room_mappings" ADD CONSTRAINT "channel_room_mappings_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_room_mappings" ADD CONSTRAINT "channel_room_mappings_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_rate_overrides" ADD CONSTRAINT "channel_rate_overrides_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_rate_overrides" ADD CONSTRAINT "channel_rate_overrides_roomTypeId_fkey" FOREIGN KEY ("roomTypeId") REFERENCES "room_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_promotions" ADD CONSTRAINT "channel_promotions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_reservations" ADD CONSTRAINT "channel_reservations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_reservations" ADD CONSTRAINT "channel_reservations_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_sync_logs" ADD CONSTRAINT "channel_sync_logs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "channel_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_agent_conversations" ADD CONSTRAINT "channel_agent_conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_agent_actions" ADD CONSTRAINT "channel_agent_actions_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "channel_agent_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

