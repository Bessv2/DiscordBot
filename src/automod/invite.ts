// Requires message content — only runs when ENABLE_MESSAGE_CONTENT=true.
const INVITE_REGEX = /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;

export function containsInviteLink(content: string): boolean {
  return INVITE_REGEX.test(content);
}
