import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
} from 'discord.js';
import { prisma } from '../lib/db';
import { logger } from '../lib/logger';
import { isModuleOn } from '../lib/modules';
import { parseStringList } from '../lib/jsonList';

export const VERIFY_BUTTON = 'verify';

export function buildVerifyPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('✅ Welcome!')
        .setDescription('Press **Verify** to get access to the rest of the server.')
        .setColor(0x57f287),
    ],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(VERIFY_BUTTON)
          .setLabel('Verify')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

/** guildMemberAdd (needs ENABLE_GUILD_MEMBERS): hand out the join roles. */
export async function giveJoinRoles(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  const cfg = await prisma.guildConfig.findUnique({ where: { id: member.guild.id } });
  if (!cfg || !isModuleOn(cfg, 'joinroles')) return;
  const roles = parseStringList(cfg.joinRoleIds).filter((id) => member.guild.roles.cache.has(id));
  if (!roles.length) return;
  await member.roles.add(roles, 'Join roles').catch((err) => {
    logger.warn(
      `Could not give join roles in guild ${member.guild.id}: ${(err as Error).message}`,
      'Move the bot role above the join roles in Server Settings → Roles.',
    );
  });
}

export async function verify(i: ButtonInteraction<'cached'>): Promise<void> {
  const cfg = await prisma.guildConfig.findUnique({ where: { id: i.guildId } });
  if (!cfg?.verifyRoleId || !isModuleOn(cfg, 'joinroles')) {
    await i.reply({
      content: "Verification isn't set up right now. Ask a staff member.",
      ephemeral: true,
    });
    return;
  }
  if (i.member.roles.cache.has(cfg.verifyRoleId)) {
    await i.reply({ content: "You're already verified.", ephemeral: true });
    return;
  }
  const ok = await i.member.roles.add(cfg.verifyRoleId, 'Pressed Verify').then(
    () => true,
    (err: Error) => {
      logger.warn(
        `Verify failed in guild ${i.guildId}: ${err.message}`,
        'Move the bot role above the verified role in Server Settings → Roles.',
      );
      return false;
    },
  );
  await i.reply({
    content: ok
      ? "✅ You're verified. Welcome!"
      : "I couldn't give you the role. Please tell a staff member.",
    ephemeral: true,
  });
}
