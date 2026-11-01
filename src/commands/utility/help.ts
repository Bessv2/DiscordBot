import {
  ApplicationCommandOptionType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { MODULES, ModuleGroup, isModuleOn, moduleForCommand } from '../../lib/modules';

// Built from the module registry and the registered commands, so it can
// never drift from what the bot actually does. Switched-off modules are left
// out, so members only see what works on this server.

const CORE: { group: ModuleGroup; title: string; commands: string[] }[] = [
  {
    group: 'Moderation',
    title: '🛡️ Moderation',
    commands: [
      'warn',
      'timeout',
      'mute',
      'unmute',
      'kick',
      'ban',
      'unban',
      'cases',
      'purge',
      'slowmode',
      'lock',
      'unlock',
      'role',
      'lockdown',
    ],
  },
  { group: 'Moderation', title: '⚙️ Setup', commands: ['setup', 'config', 'xp', 'welcome'] },
  {
    group: 'Community',
    title: 'ℹ️ Info',
    commands: ['help', 'userinfo', 'serverinfo', 'rank', 'leaderboard', 'economy'],
  },
];

export const helpCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('See what this bot can do here, or details for one command.')
    .addStringOption((o) =>
      o.setName('command').setDescription('A command name, e.g. ticket').setMaxLength(32),
    ),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    const { commands } = await import('../index');
    const byName = new Map(commands.map((c) => [c.data.name, c]));
    const wanted = interaction.options
      .getString('command')
      ?.replace(/^\//, '')
      .trim()
      .toLowerCase();

    if (wanted) {
      const cmd = byName.get(wanted);
      if (!cmd) {
        await interaction.reply({
          content: `There's no \`/${wanted}\` command. Try \`/help\` for the full list.`,
          ephemeral: true,
        });
        return;
      }
      const json = cmd.data.toJSON();
      const subs = (json.options ?? []).filter(
        (o) => o.type === ApplicationCommandOptionType.Subcommand,
      );
      const embed = new EmbedBuilder()
        .setTitle(`/${json.name}`)
        .setDescription(json.description)
        .setColor(0x5865f2);
      if (subs.length)
        embed.addFields({
          name: 'Subcommands',
          value: subs
            .map((s) => `\`/${json.name} ${s.name}\` — ${s.description}`)
            .join('\n')
            .slice(0, 1024),
        });
      const mod = moduleForCommand(json.name);
      if (mod) embed.setFooter({ text: `Part of: ${mod.name}` });
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }

    const cfg = interaction.guildId
      ? await prisma.guildConfig.findUnique({ where: { id: interaction.guildId } })
      : null;
    const list = (names: string[]) =>
      names
        .filter((n) => byName.has(n))
        .map((n) => `\`/${n}\``)
        .join(' ');
    const embed = new EmbedBuilder()
      .setTitle('What I can do here')
      .setColor(0x5865f2)
      .setDescription(
        'Type `/` to see every command, or `/help command:<name>` for details on one.',
      );
    for (const c of CORE) embed.addFields({ name: c.title, value: list(c.commands) });
    for (const group of ['Community', 'Games & fun'] as ModuleGroup[]) {
      const lines = MODULES.filter(
        (m) => m.group === group && m.commands.length && (!cfg || isModuleOn(cfg, m.id)),
      ).map((m) => `${m.emoji} **${m.name}** ${list(m.commands)}`);
      // Split across fields so a long group never hits the 1024-character field limit.
      let chunk = '';
      let first = true;
      for (const line of lines) {
        if (chunk && chunk.length + line.length + 1 > 1024) {
          embed.addFields({ name: first ? group : '​', value: chunk });
          first = false;
          chunk = '';
        }
        chunk = chunk ? `${chunk}\n${line}` : line;
      }
      if (chunk) embed.addFields({ name: first ? group : '​', value: chunk });
    }
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
