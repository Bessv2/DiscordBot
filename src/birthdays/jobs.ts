import { Client } from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { config } from '../config';
import { isModuleOn } from '../lib/modules';

// Guards against re-announcing the same person's birthday on every slow
// tick within the same day. Keyed by date so it naturally "resets" each
// day without needing an explicit cleanup — entries from prior days just
// sit unused in memory, which is fine at the scale a self-hosted guild
// list actually reaches.
const announcedToday = new Set<string>();

export async function checkBirthdays(client: Client<true>): Promise<void> {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const dateKey = `${now.getUTCFullYear()}-${month}-${day}`;

  const guildConfigs = await prisma.guildConfig.findMany({ where: { birthdayChannelId: { not: null } } });

  for (const guildConfig of guildConfigs) {
    if (!isModuleOn(guildConfig, 'birthdays')) continue;
    const guild = await client.guilds.fetch(guildConfig.id).catch(() => null);
    if (!guild) continue;

    const todays = await prisma.birthday.findMany({ where: { guildId: guildConfig.id, month, day } });

    for (const birthday of todays) {
      const key = `${guildConfig.id}:${birthday.userId}:${dateKey}`;
      if (announcedToday.has(key)) continue;
      announcedToday.add(key);

      const channel = await guild.channels.fetch(guildConfig.birthdayChannelId!).catch(() => null);
      if (channel?.isSendable()) {
        await channel.send(`🎂 Happy birthday, <@${birthday.userId}>!`).catch((err) => {
          logger.warn(`Could not post birthday announcement in guild ${guildConfig.id}: ${(err as Error).message}`);
        });
      }

      if (guildConfig.birthdayRoleId) {
        const member = await guild.members.fetch(birthday.userId).catch(() => null);
        await member?.roles.add(guildConfig.birthdayRoleId).catch(() => undefined);
      }
    }

    // Stripping the role from people whose birthday has passed needs an
    // accurate role member list, which needs the GuildMembers intent to be
    // reliably cached — without it we'd risk missing members and leaving
    // the role on indefinitely. Assigning the role on the day still works
    // either way; only this cleanup step is gated.
    if (guildConfig.birthdayRoleId && config.ENABLE_GUILD_MEMBERS) {
      const role = await guild.roles.fetch(guildConfig.birthdayRoleId).catch(() => null);
      if (role) {
        const todaysUserIds = new Set(todays.map((b) => b.userId));
        for (const member of role.members.values()) {
          if (!todaysUserIds.has(member.id)) {
            await member.roles.remove(role).catch(() => undefined);
          }
        }
      }
    }
  }
}
