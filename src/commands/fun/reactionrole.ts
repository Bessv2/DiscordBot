import { ChannelType, ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma, getOrCreateGuildConfig } from '../../lib/db';

const CUSTOM_EMOJI_PATTERN = /^<a?:\w+:(\d+)>$/;

/** Accepts either a unicode emoji or a custom emoji's <:name:id> form and returns the key reaction events use. */
function resolveEmojiKey(input: string): string {
  const match = input.match(CUSTOM_EMOJI_PATTERN);
  return match ? match[1]! : input;
}

export const reactionroleCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Let members self-assign a role by reacting to a message.')
    .addSubcommand((sc) =>
      sc
        .setName('create')
        .setDescription('Attach a role to an emoji on an existing message')
        .addStringOption((o) => o.setName('message_id').setDescription('ID of the message to react to').setRequired(true))
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Channel that message is in').addChannelTypes(ChannelType.GuildText).setRequired(true),
        )
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji to react with').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('remove')
        .setDescription('Remove a reaction-role mapping')
        .addStringOption((o) => o.setName('message_id').setDescription('ID of the message').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji to remove').setRequired(true)),
    )
    .addSubcommand((sc) => sc.setName('list').setDescription('List all reaction-role mappings'))
    .setDMPermission(false),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageRoles,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = await prisma.reactionRole.findMany({ where: { guildId } });
      if (rows.length === 0) {
        await interaction.reply({ content: 'No reaction-role mappings yet.', ephemeral: true });
        return;
      }
      const lines = rows.map((r) => `${r.emoji} → <@&${r.roleId}> on message \`${r.messageId}\``);
      await interaction.reply({ content: lines.join('\n'), ephemeral: true });
      return;
    }

    if (sub === 'create') {
      const messageId = interaction.options.getString('message_id', true);
      const channel = interaction.options.getChannel('channel', true);
      const emojiInput = interaction.options.getString('emoji', true);
      const role = interaction.options.getRole('role', true);
      const emoji = resolveEmojiKey(emojiInput);

      const fetchedChannel = await interaction.guild.channels.fetch(channel.id).catch(() => null);
      if (!fetchedChannel?.isTextBased()) {
        await interaction.reply({ content: "That channel isn't text-based.", ephemeral: true });
        return;
      }
      const message = await fetchedChannel.messages.fetch(messageId).catch(() => null);
      if (!message) {
        await interaction.reply({ content: "Could not find that message — check the ID and channel.", ephemeral: true });
        return;
      }

      await message.react(emojiInput).catch(async () => {
        await interaction.reply({ content: "Could not react with that emoji — check it's valid and I can use it.", ephemeral: true });
      });

      await getOrCreateGuildConfig(guildId);
      await prisma.reactionRole.upsert({
        where: { guildId_messageId_emoji: { guildId, messageId, emoji } },
        create: { guildId, messageId, channelId: channel.id, emoji, roleId: role.id },
        update: { roleId: role.id },
      });

      await interaction.reply({ content: `Reacting ${emojiInput} on that message now grants <@&${role.id}>.`, ephemeral: true });
      return;
    }

    if (sub === 'remove') {
      const messageId = interaction.options.getString('message_id', true);
      const emoji = resolveEmojiKey(interaction.options.getString('emoji', true));
      await prisma.reactionRole.deleteMany({ where: { guildId, messageId, emoji } });
      await interaction.reply({ content: 'Removed that mapping.', ephemeral: true });
    }
  },
};
