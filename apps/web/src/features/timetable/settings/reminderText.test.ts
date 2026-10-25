import { describe, expect, it } from 'vitest';
import { nextClassReminder } from '@utmmsc/shared';
import { course, meeting, toronto } from '../model/fixtures.testdata';
import { nextReminderText } from './reminderText';

const DATA = { terms: [], skips: [], courses: [course({ meetings: [meeting({ weekday: 1, startMin: 600 })] })] };
const SETTINGS = { classReminders: true, classLeadMin: 10 as const };

describe('nextReminderText', () => {
  it('names the day and time the reminder goes out', () => {
    const next = nextClassReminder(DATA, SETTINGS, true, toronto('2026-10-21', '12:00'));
    if (!next) throw new Error('no reminder');
    expect(nextReminderText(next, toronto('2026-10-21', '12:00'), 'zh')).toBe('下次提醒：周一 09:50 · MAT102');
    expect(nextReminderText(next, toronto('2026-10-21', '12:00'), 'en')).toBe('Next reminder: Mon 9:50 AM · MAT102');
  });

  it('says today, tomorrow or the date', () => {
    const today = nextClassReminder(DATA, SETTINGS, true, toronto('2026-10-19', '08:00'));
    const tomorrow = nextClassReminder(DATA, SETTINGS, true, toronto('2026-10-18', '08:00'));
    if (!today || !tomorrow) throw new Error('no reminder');
    expect(nextReminderText(today, toronto('2026-10-19', '08:00'), 'zh')).toBe('下次提醒：今天 09:50 · MAT102');
    expect(nextReminderText(tomorrow, toronto('2026-10-18', '08:00'), 'en')).toBe('Next reminder: Tomorrow 9:50 AM · MAT102');
    expect(nextReminderText(today, toronto('2026-10-10', '08:00'), 'zh')).toBe('下次提醒：10月19日 周一 09:50 · MAT102');
  });
});
