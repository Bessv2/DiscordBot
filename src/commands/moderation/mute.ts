import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { muteMember } from '../../lib/muteActions';
import { parseDuration } from '../../lib/duration';

export const muteCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a member with a role, optionally longer than the 28-day cap on /timeout.')
    .addUserOption((o) => o.setName('user').setDescription('The member to mute').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('duration')
        .setDescription('e.g. 10m, 1h, 7d — leave blank to mute indefinitely until /unmute')
        .setRequired(false),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Why are you muting them?').setRequired(false))
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.ModerateMembers,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const targetUser = interaction.options.getUser('user', true);
    const durationInput = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason');

    let durationMs: number | null = null;
    if (durationInput) {
      durationMs = parseDuration(durationInput);
      if (durationMs === null) {
        await interaction.reply({
          content: 'Could not parse that duration (max 365d). Try something like `10m`, `1h`, or `7d`.',
          ephemeral: true,
        });
        return;
      }
    }

    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!targetMember) {
      await interaction.reply({ content: "That user isn't in this server.", ephemeral: true });
      return;
    }

    await interaction.deferReply();
    const result = await muteMember(interaction.guild, interaction.member, targetMember, interaction.user, reason, durationMs);
    await interaction.editReply({ content: result.message });
  },
};
