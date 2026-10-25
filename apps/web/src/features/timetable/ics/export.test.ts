import { describe, expect, it, vi } from 'vitest';

const saved = vi.hoisted(() => ({ calls: [] as { blob: Blob; name: string; type: string | undefined }[] }));

vi.mock('../../../shared/native/native', () => ({
  saveFile: vi.fn(async (blob: Blob, name: string, type?: string) => {
    saved.calls.push({ blob, name, type });
    return 'saved';
  }),
}));

const { exportTimetable } = await import('./export');
const { fixture } = await import('./fixtures.testdata');
const { DEFAULT_TIMETABLE_SETTINGS } = await import('@utmmsc/shared');

describe('exportTimetable', () => {
  it('builds the calendar on the device and hands it to saveFile as text/calendar', async () => {
    const view = { ...fixture, loaded: true, rev: 1, remindersAllowed: true, settings: { ...DEFAULT_TIMETABLE_SETTINGS, assignmentOffsets: [] }, pendingIds: new Set<string>() };
    await expect(exportTimetable(view)).resolves.toBe('saved');
    expect(saved.calls).toHaveLength(1);
    const [call] = saved.calls;
    expect(call?.name).toBe('utmmsc-timetable.ics');
    expect(call?.type).toBe('text/calendar');
    expect(call?.blob.type).toBe('text/calendar');
    const text = await call!.blob.text();
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('UID:tm_AAAAAAAAAAAAAAAAAAAAA1@utmmsc.com');
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
