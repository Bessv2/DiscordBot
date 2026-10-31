import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { parseDiceNotation, rollDice } from '../../lib/dice';

export const rollCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('roll')
    .setDescription('Roll dice using standard notation.')
    .addStringOption((o) => o.setName('notation').setDescription('e.g. 2d20+5, d6, 4d6-2').setRequired(true)),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    const notation = interaction.options.getString('notation', true);
    const parsed = parseDiceNotation(notation);
    if (!parsed) {
      await interaction.reply({
        content: 'Could not parse that — try something like `2d20+5`, `d6`, or `4d6-2`.',
        ephemeral: true,
      });
      return;
    }

    const result = rollDice(parsed.count, parsed.sides, parsed.modifier);
    const modifierText = parsed.modifier ? (parsed.modifier > 0 ? ` +${parsed.modifier}` : ` ${parsed.modifier}`) : '';
    await interaction.reply(
      `🎲 \`${notation}\` → [${result.rolls.join(', ')}]${modifierText} = **${result.total}**`,
    );
  },
};
