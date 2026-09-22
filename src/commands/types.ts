import {
  ChatInputCommandInteraction,
  PermissionResolvable,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { CommandScope } from '../lib/permissions';

export type SlashCommandData =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder
  | SlashCommandSubcommandsOnlyBuilder;

export interface Command {
  data: SlashCommandData;
  /** Which configurable permission-gate scope this command belongs to. */
  scope: CommandScope;
  /**
   * Native Discord permission required when the guild hasn't configured
   * explicit roles for this command's scope. Null = open to everyone
   * (used by low-risk utility commands).
   */
  nativePermission: PermissionResolvable | null;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}
