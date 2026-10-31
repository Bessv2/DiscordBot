-- CreateTable
CREATE TABLE "guild_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "modLogChannelId" TEXT,
    "setupCompleted" BOOLEAN NOT NULL DEFAULT false,
    "automodEnabled" BOOLEAN NOT NULL DEFAULT false,
    "spamMessageLimit" INTEGER NOT NULL DEFAULT 5,
    "spamIntervalMs" INTEGER NOT NULL DEFAULT 5000,
    "inviteFilterOn" BOOLEAN NOT NULL DEFAULT false,
    "wordFilterOn" BOOLEAN NOT NULL DEFAULT false,
    "bannedWords" TEXT NOT NULL DEFAULT '[]',
    "mentionSpamLimit" INTEGER NOT NULL DEFAULT 5,
    "logMessageContent" BOOLEAN NOT NULL DEFAULT false,
    "contentRetainDays" INTEGER NOT NULL DEFAULT 30,
    "prefixCommandsOn" BOOLEAN NOT NULL DEFAULT false,
    "prefix" TEXT NOT NULL DEFAULT '!',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "permission_roles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    CONSTRAINT "permission_roles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "cases" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "caseNumber" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetTag" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "moderatorTag" TEXT NOT NULL,
    "reason" TEXT,
    "durationMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cases_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "remindAt" DATETIME NOT NULL,
    "fired" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminders_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "polls" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "question" TEXT NOT NULL,
    "options" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "polls_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "permission_roles_guildId_roleId_scope_key" ON "permission_roles"("guildId", "roleId", "scope");

-- CreateIndex
CREATE INDEX "cases_guildId_targetId_idx" ON "cases"("guildId", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "cases_guildId_caseNumber_key" ON "cases"("guildId", "caseNumber");

-- CreateIndex
CREATE INDEX "reminders_fired_remindAt_idx" ON "reminders"("fired", "remindAt");
