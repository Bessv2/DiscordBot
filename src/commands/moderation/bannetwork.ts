import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { createNetwork, joinNetwork, leaveNetwork, NetworkMode } from '../../features/banNetwork';

const MODES = [
  { name: 'Alert our mods, with a "Ban here too" button (recommended)', value: 'alert' },
  { name: 'Ban here automatically too', value: 'ban' },
];

export const bannetworkCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('bannetwork')
    .setDescription('Share bans with other servers you trust that use this same bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Start a network and get a join code for the other servers.')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('e.g. "Our gaming community"')
            .setMaxLength(60)
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('join')
        .setDescription("Join a network with the code from its creator's /bannetwork create.")
        .addStringOption((o) =>
          o.setName('code').setDescription('The join code').setMaxLength(100).setRequired(true),
        )
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('What happens here when someone is banned elsewhere')
            .addChoices(...MODES),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('mode')
        .setDescription('Change what happens here when someone is banned in another member server.')
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Alert or ban')
            .setRequired(true)
            .addChoices(...MODES),
        ),
    )
    .addSubcommand((s) =>
      s.setName('status').setDescription('Which network this server is in, and with whom.'),
    )
    .addSubcommand((s) => s.setName('leave').setDescription('Stop sharing bans.')),
  scope: 'admin',
  nativePermission: PermissionFlagsBits.ManageGuild,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'create') {
      const r = await createNetwork(guildId, interaction.options.getString('name', true));
      if (!r.ok) return void interaction.reply({ content: `⚠️ ${r.error}`, ephemeral: true });
      return void interaction.reply({
        content:
          `🔗 Network created. Give this join code **only** to admins of servers you trust (it's shown just this once):\n\`${r.code}\`\n` +
          'They run `/bannetwork join code:...` in their server. Bans here are then shared with them, and theirs with you. Members can only join if the same bot is in their server.',
        ephemeral: true,
      });
    }

    if (sub === 'join') {
      const mode = (interaction.options.getString('mode') ?? 'alert') as NetworkMode;
      const r = await joinNetwork(guildId, interaction.options.getString('code', true), mode);
      if (!r.ok) return void interaction.reply({ content: `⚠️ ${r.error}`, ephemeral: true });
      return void interaction.reply({
        content: `✅ Joined **${r.name}**. When someone is banned in another member server, ${mode === 'ban' ? 'the bot bans them here too' : 'your mod-log gets an alert with a "Ban here too" button'}. Change it with \`/bannetwork mode\`.`,
        ephemeral: true,
      });
    }

    const membership = await prisma.banNetworkMember.findUnique({
      where: { guildId },
      include: { network: { include: { members: true } } },
    });
    if (!membership)
      return void interaction.reply({
        content:
          "This server isn't in a ban network. Start one with `/bannetwork create`, or join one with `/bannetwork join`.",
        ephemeral: true,
      });

    if (sub === 'mode') {
      const mode = interaction.options.getString('mode', true) as NetworkMode;
      await prisma.banNetworkMember.update({ where: { guildId }, data: { mode } });
      return void interaction.reply({
        content: `Saved: ${mode === 'ban' ? 'bans from the network are applied here automatically' : 'bans from the network show up as alerts in your mod-log'}.`,
        ephemeral: true,
      });
    }

    if (sub === 'leave') {
      const name = await leaveNetwork(guildId);
      return void interaction.reply({
        content: `Left **${name}**. Bans are no longer shared.`,
        ephemeral: true,
      });
    }

    const names = membership.network.members.map((m) => {
      const g = interaction.client.guilds.cache.get(m.guildId);
      return `• ${g?.name ?? `a server the bot has left (${m.guildId})`}${m.guildId === guildId ? ' (this server)' : ''}: ${m.mode === 'ban' ? 'auto-ban' : 'alerts'}`;
    });
    const embed = new EmbedBuilder()
      .setTitle(`🔗 ${membership.network.name}`)
      .setColor(0xe67e22)
      .setDescription(
        `${names.join('\n')}\n\nBans made with this network's own shared bans aren't passed on again, so they can't loop.`.slice(
          0,
          4000,
        ),
      );
    return void interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
