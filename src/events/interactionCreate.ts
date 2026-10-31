import { Collection, Interaction, PermissionFlagsBits } from 'discord.js';
import { Command } from '../commands/types';
import { memberHasPermission } from '../lib/permissions';
import { logger } from '../lib/logger';
import { buildAppealModal, submitAppeal, resolveAppeal } from '../lib/appealActions';

export async function interactionCreate(interaction: Interaction): Promise<void> {
  if (interaction.isButton() && interaction.customId.startsWith('appeal_')) {
    await handleAppealButton(interaction).catch((err) => {
      logger.error(`Appeal button handler threw: ${(err as Error).message}`);
    });
    return;
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('appeal_submit:')) {
    await handleAppealModalSubmit(interaction).catch((err) => {
      logger.error(`Appeal modal handler threw: ${(err as Error).message}`);
    });
    return;
  }

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

async function handleAppealButton(interaction: import('discord.js').ButtonInteraction): Promise<void> {
  const [action, idStr] = interaction.customId.split(':');
  const id = Number(idStr);

  if (action === 'appeal_open') {
    await interaction.showModal(buildAppealModal(id));
    return;
  }

  // appeal_accept / appeal_deny — only staff in the guild the appeal belongs to should act.
  if (!interaction.inCachedGuild()) {
    await interaction.reply({ content: 'This can only be resolved from within the server.', ephemeral: true });
    return;
  }
  const allowed = await memberHasPermission(interaction.member, 'moderation', PermissionFlagsBits.ModerateMembers);
  if (!allowed) {
    await interaction.reply({ content: "You don't have permission to resolve appeals.", ephemeral: true });
    return;
  }

  const decision = action === 'appeal_accept' ? 'accepted' : 'denied';
  const result = await resolveAppeal(interaction.client, id, decision, interaction.user);
  await interaction.update({ content: `Resolved: ${result.reply}`, embeds: interaction.message.embeds, components: [] });
}

async function handleAppealModalSubmit(interaction: import('discord.js').ModalSubmitInteraction): Promise<void> {
  const [, idStr] = interaction.customId.split(':');
  const caseId = Number(idStr);
  const message = interaction.fields.getTextInputValue('appeal_message');

  const result = await submitAppeal(interaction.client, caseId, interaction.user, message);
  await interaction.reply({ content: result.reply, ephemeral: true });
}
