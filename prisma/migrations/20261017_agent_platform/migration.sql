-- Agent platform: reusable agent skills, API keys for trusted integrations,
-- and voice sessions that belong to no hotel (the global concierge).

-- AlterTable
ALTER TABLE "voice_sessions" ADD COLUMN     "scope" TEXT NOT NULL DEFAULT 'HOTEL',
ALTER COLUMN "propertyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "key" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parameters" JSONB,
    "body" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "uses" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_api_keys" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdById" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_skills_propertyId_status_idx" ON "agent_skills"("propertyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_skills_propertyId_key_key" ON "agent_skills"("propertyId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "agent_api_keys_keyHash_key" ON "agent_api_keys"("keyHash");

-- AddForeignKey
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
