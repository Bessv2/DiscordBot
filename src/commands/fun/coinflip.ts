import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';

export const coinflipCommand: Command = {
  data: new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin.'),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    await interaction.reply(`🪙 **${result}**`);
  },
};
