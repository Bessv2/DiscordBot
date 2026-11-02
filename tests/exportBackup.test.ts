import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { casesToCsv, casesToJson, csvCell, exportFileName } from '../src/lib/caseExport';
import { backupName, backupsToPrune, sqliteFile } from '../src/lib/backup';

const c = {
  caseNumber: 1,
  type: 'ban',
  targetId: '42',
  targetTag: '=HYPERLINK("http://evil")',
  moderatorId: '7',
  moderatorTag: 'mod, "the" boss',
  reason: 'line1\nline2',
  durationMs: 3_600_000,
  createdAt: new Date('2026-11-02T10:00:00Z'),
};

describe('case export', () => {
  it('quotes CSV cells and defuses spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(null)).toBe('');
  });

  it('writes a header and one row per case', () => {
    const csv = casesToCsv([c]);
    const lines = csv.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toBe(
      'case,action,member_id,member,moderator_id,moderator,reason,duration_minutes,created_at_utc',
    );
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"mod, ""the"" boss"');
    expect(csv).toContain(',60,2026-11-02T10:00:00.000Z');
  });

  it('JSON keeps the raw values', () => {
    const j = JSON.parse(casesToJson('g1', [c], new Date('2026-11-02T00:00:00Z')));
    expect(j).toMatchObject({ guildId: 'g1', count: 1 });
    expect(j.cases[0]).toMatchObject({
      case: 1,
      member: '=HYPERLINK("http://evil")',
      durationMinutes: 60,
      reason: 'line1\nline2',
    });
  });

  it('makes safe file names', () => {
    expect(exportFileName('My Cool Server!! 🎮', 'csv', new Date('2026-11-02T00:00:00Z'))).toBe(
      'cases-my-cool-server-2026-11-02.csv',
    );
    expect(exportFileName('🎮🎮', 'json', new Date('2026-11-02T00:00:00Z'))).toBe(
      'cases-server-2026-11-02.json',
    );
  });
});

describe('backups', () => {
  it('finds the SQLite file the same way Prisma does', () => {
    expect(sqliteFile('file:../data/bot.db')).toBe(path.resolve(__dirname, '..', 'data', 'bot.db'));
    expect(sqliteFile('postgresql://x')).toBeNull();
  });
  it('names backups by time and keeps the newest', () => {
    expect(backupName(new Date('2026-11-02T04:05:06Z'))).toBe('bot-20261102-040506.db');
    const files = [
      'bot-20261101-000000.db',
      'bot-20261103-000000.db',
      'notes.txt',
      'bot-20261102-000000.db',
    ];
    expect(backupsToPrune(files, 2)).toEqual(['bot-20261101-000000.db']);
    expect(backupsToPrune(files, 5)).toEqual([]);
    expect(backupsToPrune(files, 0)).toEqual([]);
  });
});
