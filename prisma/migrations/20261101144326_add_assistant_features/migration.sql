-- CreateTable
CREATE TABLE "content_log_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "content_log_messages_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topic" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "closedById" TEXT,
    CONSTRAINT "tickets_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "giveaways" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "prize" TEXT NOT NULL,
    "winnerCount" INTEGER NOT NULL,
    "hostId" TEXT NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "ended" BOOLEAN NOT NULL DEFAULT false,
    "winnerIds" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "giveaways_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "giveaway_entries" (
    "giveawayId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,

    PRIMARY KEY ("giveawayId", "userId"),
    CONSTRAINT "giveaway_entries_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "giveaways" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suggestions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "staffNote" TEXT,
    "decidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "suggestions_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "suggestion_votes" (
    "suggestionId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "up" BOOLEAN NOT NULL,

    PRIMARY KEY ("suggestionId", "userId"),
    CONSTRAINT "suggestion_votes_suggestionId_fkey" FOREIGN KEY ("suggestionId") REFERENCES "suggestions" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "auto_responders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'contains',
    "response" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auto_responders_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "temp_voice_channels" (
    "channelId" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "temp_voice_channels_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "scheduled_messages" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "color" INTEGER,
    "nextRunAt" DATETIME NOT NULL,
    "repeat" TEXT NOT NULL DEFAULT 'none',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scheduled_messages_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable (hand-trimmed from Prisma's table rebuild: ADD COLUMN touches no existing rows)
ALTER TABLE "guild_configs" ADD COLUMN "serverLogChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "serverLogEvents" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "guild_configs" ADD COLUMN "ticketStaffRoleId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "ticketLogChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "suggestionChannelId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "joinRoleIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "guild_configs" ADD COLUMN "verifyRoleId" TEXT;
ALTER TABLE "guild_configs" ADD COLUMN "tempVoiceHubId" TEXT;

-- CreateIndex
CREATE INDEX "content_log_messages_expiresAt_idx" ON "content_log_messages"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_threadId_key" ON "tickets"("threadId");

-- CreateIndex
CREATE INDEX "tickets_guildId_userId_status_idx" ON "tickets"("guildId", "userId", "status");

-- CreateIndex
CREATE INDEX "giveaways_ended_endsAt_idx" ON "giveaways"("ended", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "auto_responders_guildId_trigger_key" ON "auto_responders"("guildId", "trigger");

-- CreateIndex
CREATE INDEX "scheduled_messages_nextRunAt_idx" ON "scheduled_messages"("nextRunAt");
