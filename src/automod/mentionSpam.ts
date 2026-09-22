// Discord's Message Content intent gates whether the `mentions` collection
// is reliably populated for messages the bot didn't author and wasn't
// mentioned in, so this is treated as content-dependent and only runs
// when ENABLE_MESSAGE_CONTENT=true, even though it doesn't read raw text.
export function isMentionSpam(mentionCount: number, limit: number): boolean {
  return mentionCount >= limit;
}
