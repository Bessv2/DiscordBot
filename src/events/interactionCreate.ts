import { Collection, Interaction } from 'discord.js';
import { Command } from '../commands/types';
import { memberHasPermission } from '../lib/permissions';
import { logger } from '../lib/logger';

export async function interactionCreate(interaction: Interaction): Promise<void> {
  if (!interaction.isChatInputCommand()) return;

  const client = interaction.client as typeof interaction.client & {
    commands: Collection<string, Command>;
  };
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  if (interaction.inCachedGuild()) {
    const allowed = await memberHasPermission(interaction.member, command.scope, command.nativePermission);
    if (!allowed) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    logger.error(`Command "${interaction.commandName}" threw: ${(err as Error).stack ?? err}`);
    const payload = { content: 'Something went wrong running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => undefined);
    } else {
      await interaction.reply(payload).catch(() => undefined);
    }
  }
}
