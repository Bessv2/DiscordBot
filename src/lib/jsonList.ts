/**
 * Reads a JSON string-array column (disabledModules, serverLogEvents,
 * joinRoleIds...). A hand-edited or corrupt value counts as an empty list
 * rather than crashing whatever reads it.
 */
export function parseStringList(json: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
