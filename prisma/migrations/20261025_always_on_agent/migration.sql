-- The always-on staff agent: WhatsApp links, per-hotel agent permissions, and alerts sent.

-- A linked WhatsApp number per staff member, and that chat's state.
CREATE TABLE "staff_whatsapp_links" (
    "userId" TEXT NOT NULL,
    "number" TEXT,
    "linkedAt" TIMESTAMP(3),
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeSessionVersion" INTEGER,
    "codeAuthMethod" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "authMethod" TEXT NOT NULL DEFAULT 'password',
    "propertyId" TEXT,
    "memory" JSONB,
    "recent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pendingPlan" TEXT,
    "choices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastInboundAt" TIMESTAMP(3),
    "alertsOff" BOOLEAN NOT NULL DEFAULT false,
    "lastAlert" TEXT,
    "alertUnseen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_whatsapp_links_pkey" PRIMARY KEY ("userId")
);
CREATE UNIQUE INDEX "staff_whatsapp_links_number_key" ON "staff_whatsapp_links"("number");
CREATE UNIQUE INDEX "staff_whatsapp_links_codeHash_key" ON "staff_whatsapp_links"("codeHash");
ALTER TABLE "staff_whatsapp_links" ADD CONSTRAINT "staff_whatsapp_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- WhatsApp message ids already handled (webhooks can arrive twice).
CREATE TABLE "whatsapp_inbound_messages" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "whatsapp_inbound_messages_createdAt_idx" ON "whatsapp_inbound_messages"("createdAt");

-- What each role may do through the agent at a hotel, and which alerts it gets.
CREATE TABLE "agent_policies" (
    "propertyId" TEXT NOT NULL,
    "roles" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_policies_pkey" PRIMARY KEY ("propertyId")
);
ALTER TABLE "agent_policies" ADD CONSTRAINT "agent_policies_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alerts the always-on agent sent, so each goes out once.
CREATE TABLE "agent_notices" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sentTo" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_notices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_notices_propertyId_key_key" ON "agent_notices"("propertyId", "key");
CREATE INDEX "agent_notices_createdAt_idx" ON "agent_notices"("createdAt");
