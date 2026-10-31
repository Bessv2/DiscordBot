import { Message, PermissionFlagsBits } from 'discord.js';
import { prisma } from '../lib/db';
import { memberHasPermission } from '../lib/permissions';
import { warnMember, kickMember, banMember } from '../lib/moderationActions';
import { getCasesForUser } from '../lib/caseManager';

// Legacy "!command" support, opt-in per the mission statement (slash
// commands are the primary UX; this exists for hosts/communities used to
// prefix bots). Deliberately a small subset — warn/kick/ban + case lookup —
// not full parity with every slash command. Requires
// ENABLE_MESSAGE_CONTENT=true (checked by the caller) since it needs to
// read raw message text.
export async function handlePrefixCommand(message: Message<true>): Promise<void> {
  const guildConfig = await prisma.guildConfig.findUnique({ where: { id: message.guild.id } });
  if (!guildConfig?.prefixCommandsOn) return;

  const prefix = guildConfig.prefix;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();
  if (!commandName) return;

  const targetUser = message.mentions.users.first();
  const reason = args.slice(1).join(' ') || null;

  switch (commandName) {
    case 'warn':
    case 'kick':
    case 'ban': {
      if (!targetUser) {
        await message.reply('Mention a user, e.g. `!warn @user spamming`.');
        return;
      }
      const allowed = await memberHasPermission(
        message.member!,
        'moderation',
        commandName === 'kick'
          ? PermissionFlagsBits.KickMembers
          : commandName === 'ban'
            ? PermissionFlagsBits.BanMembers
            : PermissionFlagsBits.ModerateMembers,
      );
      if (!allowed) {
        await message.reply("You don't have permission to do that.");
        return;
      }

      if (commandName === 'ban') {
        const result = await banMember(message.guild, message.member!, targetUser, message.author, reason, 0);
        await message.reply(result.message);
        return;
      }

      const targetMember = await message.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        await message.reply("That user isn't in this server.");
        return;
      }
      const result =
        commandName === 'kick'
          ? await kickMember(message.guild, message.member!, targetMember, message.author, reason)
          : await warnMember(message.guild, message.member!, targetMember, message.author, reason);
      await message.reply(result.message);
      return;
    }
    case 'cases': {
      const who = targetUser ?? message.author;
      const cases = await getCasesForUser(message.guild.id, who.id, 5);
      if (cases.length === 0) {
        await message.reply(`No cases found for ${who.tag}.`);
        return;
      }
      const lines = cases.map((c) => `#${c.caseNumber} · ${c.type} · ${c.reason ?? 'no reason'}`);
      await message.reply(`Recent cases for ${who.tag}:\n${lines.join('\n')}`);
      return;
    }
    default: {
      // Not a built-in command — check if it's a custom tag (e.g. "!welcome-faq").
      const tag = await prisma.tag.findUnique({ where: { guildId_name: { guildId: message.guild.id, name: commandName } } });
      if (tag) await message.channel.send(tag.content).catch(() => undefined);
      return;
    }
  }
}
