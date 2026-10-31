import { GuildMember } from 'discord.js';

/** Expands {user}, {server}, {membercount} in welcome/goodbye templates. */
export function renderTemplate(template: string, member: GuildMember): string {
  return template
    .replaceAll('{user}', `${member}`)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{membercount}', `${member.guild.memberCount}`);
}
