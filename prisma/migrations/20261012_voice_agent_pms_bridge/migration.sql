-- CreateEnum
CREATE TYPE "SetupPath" AS ENUM ('FULL', 'BRIDGE', 'VOICE');

-- CreateEnum
CREATE TYPE "PmsConnectionMode" AS ENUM ('DESKTOP', 'CLOUD');

-- CreateEnum
CREATE TYPE "PmsConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'PAUSED');

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "setupPath" "SetupPath" NOT NULL DEFAULT 'FULL';

-- CreateTable
CREATE TABLE "voice_agent_configs" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "voice" TEXT NOT NULL DEFAULT 'marin',
    "greeting" TEXT,
    "instructions" TEXT,
    "faqs" JSONB NOT NULL DEFAULT '[]',
    "handoffPhone" TEXT,
    "guestWidget" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_sessions" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "userId" TEXT,
    "audience" TEXT NOT NULL,
    "liveSessionId" TEXT,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_requests" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "message" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'VOICE',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pms_connections" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "system" TEXT NOT NULL,
    "mode" "PmsConnectionMode" NOT NULL,
    "status" "PmsConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "loginUrl" TEXT,
    "credentialsCipher" TEXT,
    "pairingCode" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "deviceTokenHash" TEXT,
    "deviceName" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pms_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bridge_tasks" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "result" JSONB,
    "error" TEXT,
    "requestedById" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "bridge_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_agent_configs_propertyId_key" ON "voice_agent_configs"("propertyId");

-- CreateIndex
CREATE INDEX "voice_sessions_propertyId_startedAt_idx" ON "voice_sessions"("propertyId", "startedAt");

-- CreateIndex
CREATE INDEX "guest_requests_propertyId_status_createdAt_idx" ON "guest_requests"("propertyId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pms_connections_propertyId_key" ON "pms_connections"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "pms_connections_pairingCode_key" ON "pms_connections"("pairingCode");

-- CreateIndex
CREATE UNIQUE INDEX "pms_connections_deviceTokenHash_key" ON "pms_connections"("deviceTokenHash");

-- CreateIndex
CREATE INDEX "bridge_tasks_connectionId_status_createdAt_idx" ON "bridge_tasks"("connectionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "bridge_tasks_propertyId_createdAt_idx" ON "bridge_tasks"("propertyId", "createdAt");

-- AddForeignKey
ALTER TABLE "voice_agent_configs" ADD CONSTRAINT "voice_agent_configs_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_requests" ADD CONSTRAINT "guest_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pms_connections" ADD CONSTRAINT "pms_connections_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_tasks" ADD CONSTRAINT "bridge_tasks_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bridge_tasks" ADD CONSTRAINT "bridge_tasks_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "pms_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

