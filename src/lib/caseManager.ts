import { Case } from '@prisma/client';
import { prisma, getOrCreateGuildConfig } from './db';

export interface CreateCaseInput {
  guildId: string;
  type: 'warn' | 'kick' | 'ban' | 'timeout' | 'mute' | 'unmute' | 'unban';
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string | null;
  durationMs?: number | null;
}

/**
 * Case numbers are per-guild and sequential (case #1, #2, ...), which means
 * they can't just be the auto-increment primary key. We compute the next
 * number inside a transaction so two moderators acting at the same instant
 * never collide on a case number.
 */
export async function createCase(input: CreateCaseInput): Promise<Case> {
  await getOrCreateGuildConfig(input.guildId);

  return prisma.$transaction(async (tx) => {
    const last = await tx.case.findFirst({
      where: { guildId: input.guildId },
      orderBy: { caseNumber: 'desc' },
      select: { caseNumber: true },
    });
    const nextCaseNumber = (last?.caseNumber ?? 0) + 1;

    return tx.case.create({
      data: {
        guildId: input.guildId,
        caseNumber: nextCaseNumber,
        type: input.type,
        targetId: input.targetId,
        targetTag: input.targetTag,
        moderatorId: input.moderatorId,
        moderatorTag: input.moderatorTag,
        reason: input.reason,
        durationMs: input.durationMs ?? null,
      },
    });
  });
}

export async function getCasesForUser(
  guildId: string,
  userId: string,
  limit = 10,
): Promise<Case[]> {
  return prisma.case.findMany({
    where: { guildId, targetId: userId },
    orderBy: { caseNumber: 'desc' },
    take: limit,
  });
}

export async function getCaseByNumber(guildId: string, caseNumber: number): Promise<Case | null> {
  return prisma.case.findUnique({
    where: { guildId_caseNumber: { guildId, caseNumber } },
  });
}
