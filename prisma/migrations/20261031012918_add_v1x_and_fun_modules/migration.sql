-- CreateTable
CREATE TABLE "mutes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mutes_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channel_automod_overrides" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "exemptSpam" BOOLEAN NOT NULL DEFAULT false,
    "exemptInvite" BOOLEAN NOT NULL DEFAULT false,
    "exemptWordFilter" BOOLEAN NOT NULL DEFAULT false,
    "exemptMentionSpam" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "channel_automod_overrides_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "appeals" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "caseId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" DATETIME,
    "resolvedBy" TEXT,
    CONSTRAINT "appeals_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "appeals_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cases" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tags" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tags_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_xp" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME,
    CONSTRAINT "user_xp_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "level_role_rewards" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "level_role_rewards_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "starboard_posts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "originalMessageId" TEXT NOT NULL,
    "originalChannelId" TEXT NOT NULL,
    "starboardMessageId" TEXT NOT NULL,
    "starCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "starboard_posts_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "birthdays" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    CONSTRAINT "birthdays_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "quotedUserTag" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "quotes_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "reaction_roles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "reaction_roles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lastDailyAt" DATETIME,
    CONSTRAINT "wallets_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "trivia_questions" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "choices" TEXT NOT NULL,
    "correctIndex" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "trivia_questions_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stream_notifications" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "channelName" TEXT NOT NULL,
    "lastAnnouncedId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stream_notifications_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "lfg_posts" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "game" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "maxSize" INTEGER NOT NULL,
    "memberIds" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "lfg_posts_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "participants" TEXT NOT NULL,
    "bracket" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tournaments_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "voice_activity_roles" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "gameNamePattern" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "voice_activity_roles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_guild_configs" (
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
    "antiRaidEnabled" BOOLEAN NOT NULL DEFAULT false,
    "raidJoinThreshold" INTEGER NOT NULL DEFAULT 10,
    "raidIntervalMs" INTEGER NOT NULL DEFAULT 60000,
    "raidAutoLockdown" BOOLEAN NOT NULL DEFAULT false,
    "lockdownActive" BOOLEAN NOT NULL DEFAULT false,
    "muteRoleId" TEXT,
    "appealChannelId" TEXT,
    "xpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "xpMinPerMsg" INTEGER NOT NULL DEFAULT 15,
    "xpMaxPerMsg" INTEGER NOT NULL DEFAULT 25,
    "xpCooldownSec" INTEGER NOT NULL DEFAULT 60,
    "starboardChannelId" TEXT,
    "starboardEmoji" TEXT NOT NULL DEFAULT '⭐',
    "starboardThreshold" INTEGER NOT NULL DEFAULT 5,
    "welcomeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeChannelId" TEXT,
    "welcomeMessage" TEXT NOT NULL DEFAULT 'Welcome {user} to {server}! We''re now {membercount} members strong.',
    "goodbyeChannelId" TEXT,
    "goodbyeMessage" TEXT NOT NULL DEFAULT '{user} has left {server}.',
    "birthdayChannelId" TEXT,
    "birthdayRoleId" TEXT,
    "economyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "economyDailyAmount" INTEGER NOT NULL DEFAULT 100,
    "economyStartingBalance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_guild_configs" ("automodEnabled", "bannedWords", "contentRetainDays", "createdAt", "id", "inviteFilterOn", "logMessageContent", "mentionSpamLimit", "modLogChannelId", "prefix", "prefixCommandsOn", "setupCompleted", "spamIntervalMs", "spamMessageLimit", "updatedAt", "wordFilterOn") SELECT "automodEnabled", "bannedWords", "contentRetainDays", "createdAt", "id", "inviteFilterOn", "logMessageContent", "mentionSpamLimit", "modLogChannelId", "prefix", "prefixCommandsOn", "setupCompleted", "spamIntervalMs", "spamMessageLimit", "updatedAt", "wordFilterOn" FROM "guild_configs";
DROP TABLE "guild_configs";
ALTER TABLE "new_guild_configs" RENAME TO "guild_configs";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "mutes_active_expiresAt_idx" ON "mutes"("active", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "channel_automod_overrides_guildId_channelId_key" ON "channel_automod_overrides"("guildId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "tags_guildId_name_key" ON "tags"("guildId", "name");

-- CreateIndex
CREATE INDEX "user_xp_guildId_xp_idx" ON "user_xp"("guildId", "xp");

-- CreateIndex
CREATE UNIQUE INDEX "user_xp_guildId_userId_key" ON "user_xp"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "level_role_rewards_guildId_level_key" ON "level_role_rewards"("guildId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "starboard_posts_guildId_originalMessageId_key" ON "starboard_posts"("guildId", "originalMessageId");

-- CreateIndex
CREATE INDEX "birthdays_guildId_month_day_idx" ON "birthdays"("guildId", "month", "day");

-- CreateIndex
CREATE UNIQUE INDEX "birthdays_guildId_userId_key" ON "birthdays"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "reaction_roles_guildId_messageId_emoji_key" ON "reaction_roles"("guildId", "messageId", "emoji");

-- CreateIndex
CREATE INDEX "wallets_guildId_balance_idx" ON "wallets"("guildId", "balance");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_guildId_userId_key" ON "wallets"("guildId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "stream_notifications_guildId_platform_channelName_key" ON "stream_notifications"("guildId", "platform", "channelName");

-- CreateIndex
CREATE UNIQUE INDEX "voice_activity_roles_guildId_gameNamePattern_key" ON "voice_activity_roles"("guildId", "gameNamePattern");
