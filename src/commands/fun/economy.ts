import { ChatInputCommandInteraction, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { Command } from '../types';
import { prisma } from '../../lib/db';
import { memberHasPermission } from '../../lib/permissions';
import { addToBalance, canClaimDaily, getOrCreateWallet } from '../../lib/walletActions';
import { calculatePayout, spinSlots } from '../../lib/economy';

export const economyCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('economy')
    .setDescription('A simple per-server currency: balance, daily claim, and slots.')
    .addSubcommand((sc) => sc.setName('balance').setDescription('Check a balance').addUserOption((o) => o.setName('user').setDescription('Defaults to yourself').setRequired(false)))
    .addSubcommand((sc) => sc.setName('daily').setDescription('Claim your daily coins'))
    .addSubcommand((sc) =>
      sc.setName('slots').setDescription('Gamble some coins').addIntegerOption((o) => o.setName('bet').setDescription('How much to bet').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('give')
        .setDescription('(Admin) Add coins to a member')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true)),
    )
    .addSubcommand((sc) =>
      sc
        .setName('take')
        .setDescription('(Admin) Remove coins from a member')
        .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
        .addIntegerOption((o) => o.setName('amount').setDescription('How much').setRequired(true)),
    )
    .setDMPermission(false),
  scope: 'utility',
  nativePermission: null,
  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guild.id;
    const guildConfig = await prisma.guildConfig.findUnique({ where: { id: guildId } });
    const sub = interaction.options.getSubcommand();

    if (!guildConfig?.economyEnabled && sub !== 'give' && sub !== 'take') {
      await interaction.reply({ content: 'The economy module is off in this server.', ephemeral: true });
      return;
    }

    if (sub === 'balance') {
      const targetUser = interaction.options.getUser('user') ?? interaction.user;
      const wallet = await getOrCreateWallet(guildId, targetUser.id);
      await interaction.reply({ content: `${targetUser.tag} has **${wallet.balance}** coins.` });
      return;
    }

    if (sub === 'daily') {
      const wallet = await getOrCreateWallet(guildId, interaction.user.id);
      if (!canClaimDaily(wallet.lastDailyAt)) {
        await interaction.reply({ content: "You've already claimed today — come back after 00:00 UTC.", ephemeral: true });
        return;
      }
      const amount = guildConfig!.economyDailyAmount;
      await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount }, lastDailyAt: new Date() } });
      await interaction.reply({ content: `Claimed your daily **${amount}** coins!` });
      return;
    }

    if (sub === 'slots') {
      const bet = interaction.options.getInteger('bet', true);
      if (bet <= 0) {
        await interaction.reply({ content: 'Bet has to be a positive number.', ephemeral: true });
        return;
      }
      const wallet = await getOrCreateWallet(guildId, interaction.user.id);
      if (wallet.balance < bet) {
        await interaction.reply({ content: `You only have **${wallet.balance}** coins.`, ephemeral: true });
        return;
      }

      const spin = spinSlots();
      const payout = calculatePayout(bet, spin.multiplier);
      const net = payout - bet;
      await prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: net } } });

      const resultLine = spin.reels.join(' | ');
      if (spin.multiplier > 0) {
        await interaction.reply(`🎰 ${resultLine}\nYou won **${payout}** coins! (net +${net})`);
      } else {
        await interaction.reply(`🎰 ${resultLine}\nNo match — lost **${bet}** coins.`);
      }
      return;
    }

    // give / take — admin only
    const isMod = await memberHasPermission(interaction.member, 'moderation', PermissionFlagsBits.ManageGuild);
    if (!isMod) {
      await interaction.reply({ content: "You don't have permission to do that.", ephemeral: true });
      return;
    }
    const targetUser = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);
    const newBalance = await addToBalance(guildId, targetUser.id, sub === 'give' ? amount : -amount);
    await interaction.reply({ content: `${targetUser.tag}'s balance is now **${newBalance}**.`, ephemeral: true });
  },
};
