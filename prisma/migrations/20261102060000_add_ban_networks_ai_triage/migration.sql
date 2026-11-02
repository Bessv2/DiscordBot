-- CreateTable
CREATE TABLE "ban_networks" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "joinCodeHash" TEXT NOT NULL,
    "ownerGuildId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ban_network_members" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "networkId" INTEGER NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'alert',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ban_network_members_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "ban_networks" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ban_network_members_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Hand-trimmed from Prisma's table rebuild to plain ADD COLUMNs (see PROJECT.md §8).
ALTER TABLE "guild_configs" ADD COLUMN "aiTriageEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "guild_configs" ADD COLUMN "aiTriageChannelId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ban_networks_joinCodeHash_key" ON "ban_networks"("joinCodeHash");

-- CreateIndex
CREATE INDEX "ban_network_members_networkId_idx" ON "ban_network_members"("networkId");

