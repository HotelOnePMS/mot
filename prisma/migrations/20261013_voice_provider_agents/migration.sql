-- Agents StayOS provisions at a voice provider (ElevenLabs), one per audience.
CREATE TABLE "voice_provider_agents" (
    "key" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "configHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_provider_agents_pkey" PRIMARY KEY ("key")
);
