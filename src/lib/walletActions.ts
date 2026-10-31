import { prisma, getOrCreateGuildConfig } from './db';

export async function getOrCreateWallet(guildId: string, userId: string) {
  const guildConfig = await getOrCreateGuildConfig(guildId);
  return prisma.wallet.upsert({
    where: { guildId_userId: { guildId, userId } },
    update: {},
    create: { guildId, userId, balance: guildConfig.economyStartingBalance },
  });
}

export async function addToBalance(guildId: string, userId: string, amount: number): Promise<number> {
  await getOrCreateWallet(guildId, userId);
  const updated = await prisma.wallet.update({
    where: { guildId_userId: { guildId, userId } },
    data: { balance: { increment: amount } },
  });
  return updated.balance;
}

/** True if a day (UTC) has passed since the wallet's last daily claim. */
export function canClaimDaily(lastDailyAt: Date | null): boolean {
  if (!lastDailyAt) return true;
  const now = new Date();
  return now.getUTCFullYear() !== lastDailyAt.getUTCFullYear() || now.getUTCMonth() !== lastDailyAt.getUTCMonth() || now.getUTCDate() !== lastDailyAt.getUTCDate();
}
