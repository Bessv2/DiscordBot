import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Guild rows are created lazily on first use rather than requiring a
// bootstrap step — a guild the bot just joined works immediately with
// defaults, and /setup only needs to update the row, not create it.
export async function getOrCreateGuildConfig(guildId: string) {
  return prisma.guildConfig.upsert({
    where: { id: guildId },
    update: {},
    create: { id: guildId },
  });
}
