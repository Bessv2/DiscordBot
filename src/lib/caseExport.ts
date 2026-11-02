// Audit-log export: a server's case history as CSV (for a spreadsheet) or
// JSON (for other tools). Pure, so it's unit tested.

export interface ExportCase {
  caseNumber: number;
  type: string;
  targetId: string;
  targetTag: string;
  moderatorId: string;
  moderatorTag: string;
  reason: string | null;
  durationMs: number | null;
  createdAt: Date;
}

export const EXPORT_COLUMNS = [
  'case',
  'action',
  'member_id',
  'member',
  'moderator_id',
  'moderator',
  'reason',
  'duration_minutes',
  'created_at_utc',
] as const;

/**
 * One CSV cell. Quotes when needed, and defuses cells that a spreadsheet
 * would run as a formula (=, +, -, @ at the start): a member's name or a
 * reason is member-controlled text, and "=HYPERLINK(...)" in a name must
 * not turn into a live formula when a moderator opens the export.
 */
export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(c: ExportCase): unknown[] {
  return [
    c.caseNumber,
    c.type,
    c.targetId,
    c.targetTag,
    c.moderatorId,
    c.moderatorTag,
    c.reason ?? '',
    c.durationMs != null ? Math.round(c.durationMs / 60_000) : '',
    c.createdAt.toISOString(),
  ];
}

/** CSV with a header row and CRLF line endings (what spreadsheets expect). Starts with a BOM so Excel reads UTF-8 names correctly. */
export function casesToCsv(cases: ExportCase[]): string {
  return `﻿${[EXPORT_COLUMNS.join(','), ...cases.map((c) => row(c).map(csvCell).join(','))].join('\r\n')}\r\n`;
}

export function casesToJson(guildId: string, cases: ExportCase[], now = new Date()): string {
  return JSON.stringify(
    {
      guildId,
      exportedAt: now.toISOString(),
      count: cases.length,
      cases: cases.map((c) => ({
        case: c.caseNumber,
        action: c.type,
        memberId: c.targetId,
        member: c.targetTag,
        moderatorId: c.moderatorId,
        moderator: c.moderatorTag,
        reason: c.reason,
        durationMinutes: c.durationMs != null ? Math.round(c.durationMs / 60_000) : null,
        createdAt: c.createdAt.toISOString(),
      })),
    },
    null,
    2,
  );
}

export function exportFileName(
  guildName: string,
  format: 'csv' | 'json',
  now = new Date(),
): string {
  const safe =
    guildName
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase() || 'server';
  return `cases-${safe}-${now.toISOString().slice(0, 10)}.${format}`;
}
