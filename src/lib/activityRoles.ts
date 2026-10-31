/** Case-insensitive substring match — "Minecraft" matches a pattern of "minecraft". Pure, unit tested. */
export function matchesActivityPattern(activityName: string, pattern: string): boolean {
  return activityName.toLowerCase().includes(pattern.toLowerCase());
}

export function rolesToAssign(activityNames: string[], mappings: { pattern: string; roleId: string }[]): Set<string> {
  const matched = new Set<string>();
  for (const { pattern, roleId } of mappings) {
    if (activityNames.some((name) => matchesActivityPattern(name, pattern))) {
      matched.add(roleId);
    }
  }
  return matched;
}
