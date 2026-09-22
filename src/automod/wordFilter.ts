// Requires message content — only runs when ENABLE_MESSAGE_CONTENT=true.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-boundary match so "class" doesn't trip a filter on "ass". */
export function findBannedWord(content: string, bannedWords: string[]): string | null {
  const lower = content.toLowerCase();
  for (const raw of bannedWords) {
    const word = raw.toLowerCase().trim();
    if (!word) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'i');
    if (pattern.test(lower)) return raw;
  }
  return null;
}
