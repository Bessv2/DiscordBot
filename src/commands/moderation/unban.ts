import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { createCase } from '../../lib/caseManager';
import { postModLog } from '../../lib/modlog';

export const unbanCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Lift a ban. Paste the user ID if they are not in any server with you.')
    .addUserOption((o) =>
      o.setName('user').setDescription('The banned user (or their ID)').setRequired(true),
    )
    .addStringOption((o) => o.setName('reason').setDescription('Why the ban is being lifted'))
    .setDMPermission(false),
  scope: 'moderation',
  nativePermission: PermissionFlagsBits.BanMembers,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason');
    // force: ask Discord, not the cache, which can still hold a ban that was just lifted.
    const ban = await interaction.guild.bans
      .fetch({ user: user.id, force: true })
      .catch(() => null);
    if (!ban) {
      await interaction.reply({ content: `${user.tag} isn't banned here.`, ephemeral: true });
      return;
    }
    const ok = await interaction.guild.members
      .unban(user.id, reason ?? `Unbanned by ${interaction.user.tag}`)
      .then(
        () => true,
        () => false,
      );
    if (!ok) {
      await interaction.reply({
        content: "I couldn't lift that ban. I need the **Ban Members** permission.",
        ephemeral: true,
      });
      return;
    }
    const record = await createCase({
      guildId: interaction.guild.id,
      type: 'unban',
      targetId: user.id,
      targetTag: user.tag,
      moderatorId: interaction.user.id,
      moderatorTag: interaction.user.tag,
      reason,
    });
    await postModLog(interaction.guild, {
      type: 'unban',
      caseNumber: record.caseNumber,
      target: user,
      moderator: interaction.user,
      reason,
    });
    await interaction.reply(`Unbanned ${user.tag} (case #${record.caseNumber}).`);
  },
};
