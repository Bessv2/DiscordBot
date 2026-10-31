import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { getSteamProfile } from '../../lib/steam';
import { getLolProfile } from '../../lib/riot';
import { config } from '../../config';

const PLATFORM_CHOICES = [
  { name: 'NA', value: 'na1' },
  { name: 'EUW', value: 'euw1' },
  { name: 'EUNE', value: 'eun1' },
  { name: 'KR', value: 'kr' },
  { name: 'BR', value: 'br1' },
  { name: 'JP', value: 'jp1' },
];

export const gamestatsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('gamestats')
    .setDescription('Look up a player profile on Steam or League of Legends.')
    .addSubcommand((sc) =>
      sc
        .setName('steam')
        .setDescription('Look up a Steam profile')
        .addStringOption((o) => o.setName('username').setDescription('Steam vanity URL name or SteamID64').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('lol')
        .setDescription('Look up a League of Legends profile')
        .addStringOption((o) => o.setName('riot_id').setDescription('e.g. Faker#KR1').setRequired(true))
        .addStringOption((o) =>
          o.setName('region').setDescription('Which region server').setRequired(true).addChoices(...PLATFORM_CHOICES),
        ),
    ),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'steam') {
      if (!config.STEAM_API_KEY) {
        await interaction.reply({ content: 'Steam lookups are not configured on this bot — the host needs to set STEAM_API_KEY.', ephemeral: true });
        return;
      }
      await interaction.deferReply();
      const profile = await getSteamProfile(interaction.options.getString('username', true));
      if (!profile) {
        await interaction.editReply('Could not find that Steam profile.');
        return;
      }
      const embed = new EmbedBuilder()
        .setColor(0x1b2838)
        .setTitle(profile.personaName)
        .setURL(profile.profileUrl)
        .setThumbnail(profile.avatarUrl)
        .addFields(
          { name: 'Status', value: profile.statusText, inline: true },
          { name: 'Playing', value: profile.currentGame ?? 'Nothing right now', inline: true },
        );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (!config.RIOT_API_KEY) {
      await interaction.reply({ content: 'League of Legends lookups are not configured on this bot — the host needs to set RIOT_API_KEY.', ephemeral: true });
      return;
    }
    await interaction.deferReply();
    const riotId = interaction.options.getString('riot_id', true);
    const region = interaction.options.getString('region', true);
    const profile = await getLolProfile(riotId, region);
    if (!profile) {
      await interaction.editReply('Could not find that Riot ID on that region.');
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(0xc89b3c)
      .setTitle(riotId)
      .addFields(
        { name: 'Summoner level', value: `${profile.summonerLevel}`, inline: true },
        {
          name: 'Ranked Solo/Duo',
          value: profile.soloQueue
            ? `${profile.soloQueue.tier} ${profile.soloQueue.rank} (${profile.soloQueue.leaguePoints} LP) — ${profile.soloQueue.wins}W/${profile.soloQueue.losses}L`
            : 'Unranked',
        },
      );
    await interaction.editReply({ embeds: [embed] });
  },
};
