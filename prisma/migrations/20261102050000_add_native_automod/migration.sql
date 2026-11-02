-- Hand-trimmed from Prisma's table rebuild to plain ADD COLUMNs (see PROJECT.md §8).
ALTER TABLE "guild_configs" ADD COLUMN "nativeAutomod" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "guild_configs" ADD COLUMN "nativeAutomodState" TEXT NOT NULL DEFAULT '{}';
