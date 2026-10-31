-- Hand-trimmed from Prisma's generated table rebuild: two plain ADD COLUMNs
-- touch no existing rows, so upgrading can't lose settings even if it's
-- interrupted part-way.

-- AlterTable
ALTER TABLE "guild_configs" ADD COLUMN "disabledModules" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "guild_configs" ADD COLUMN "musicDjRoleId" TEXT;

-- CreateTable
CREATE TABLE "map_pools" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "guildId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "map_pools_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guild_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "map_pools_guildId_game_name_key" ON "map_pools"("guildId", "game", "name");
