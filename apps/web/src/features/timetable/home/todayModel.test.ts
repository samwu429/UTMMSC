import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMETABLE_SETTINGS, instantAt, type TimetableAssignment, type TimetableCourse, type TimetableSettings } from '@utmmsc/shared';
import { assignments as fixtureAssignments, courses, fall, skips } from '../ics/fixtures.testdata';
import {
  NOTIFICATION_SETTINGS_PATH,
  assignmentLink,
  assignmentRow,
  bellChip,
  canEnableHere,
  classLink,
  dayLabel,
  headerText,
  mainLine,
  nextReminderAt,
  reminderWhen,
  startsIn,
  type BellInput,
} from './todayModel';

/** Toronto wall time as an instant. */
/** 把多伦多时钟时间换成时刻。 */
function at(date: string, clock: string): number {
  const [hour = 0, minute = 0] = clock.split(':').map(Number);
  return instantAt(date, hour * 60 + minute);
}

const data = { loaded: true, terms: [fall], courses, skips };
const mat = courses[0]!;
const lecture = mat.meetings[0]!;

describe('title row', () => {
  it('shows the weekday and the term week', () => {
    expect(headerText([fall], '2026-10-26', 'zh')).toBe('周一 · 第9周');
    expect(headerText([fall], '2026-10-26', 'en')).toBe('Mon · Week 9');
    expect(headerText([fall], '2026-10-14', 'zh')).toBe('周三 · 阅读周');
    expect(headerText([fall], '2027-01-11', 'zh')).toBe('周一');
  });
});

describe('main line', () => {
  it('counts down to the next class with a pill', () => {
    const { main, later } = mainLine(data, at('2026-10-26', '09:25'), 'zh');
    expect(main).toEqual({ kind: 'next', label: '下一节', text: '10:00–10:50 · MAT102 · DV 2074', pill: '35 分钟后', link: `/timetable?date=2026-10-26&focus=${lecture.id}` });
    expect(later).toEqual([]);
    expect(mainLine(data, at('2026-10-26', '09:25'), 'en').main).toMatchObject({ label: 'Next', text: '10:00–10:50 AM · MAT102 · DV 2074', pill: 'in 35 min' });
  });

  it('shows the class in progress with minutes left and progress', () => {
    const { main } = mainLine(data, at('2026-10-26', '10:27'), 'zh');
    expect(main).toMatchObject({ kind: 'in_class', label: '正在上课 · 还剩 23 分钟', text: 'MAT102 · DV 2074' });
    expect(main.kind === 'in_class' && main.progress).toBeCloseTo(27 / 50, 5);
    expect(mainLine(data, at('2026-10-26', '10:27'), 'en').main).toMatchObject({ label: 'In class · 23 min left' });
  });

  it('says today is done and names the next class', () => {
    expect(mainLine(data, at('2026-10-26', '11:00'), 'zh').main).toEqual({
      kind: 'quiet',
      text: '今天的课都上完了 · 周三 14:00 MAT102',
      link: `/timetable?date=2026-10-28&focus=${mat.meetings[2]!.id}`,
    });
    expect(mainLine(data, at('2026-10-26', '11:00'), 'en').main).toMatchObject({ text: 'Done for today · Wed 2:00 PM MAT102' });
  });

  it('says there is no class today and when the next one is', () => {
    expect(mainLine(data, at('2026-10-27', '12:00'), 'zh').main).toMatchObject({ kind: 'quiet', text: '今天没有课 · 下一节 明天 14:00 MAT102' });
    expect(mainLine(data, at('2026-10-27', '12:00'), 'en').main).toMatchObject({ text: 'No classes today · Next: Tomorrow 2:00 PM MAT102' });
  });

  it('says reading week and holidays', () => {
    expect(mainLine(data, at('2026-10-14', '12:00'), 'zh').main).toMatchObject({ kind: 'quiet', text: '阅读周 · 不上课' });
    expect(mainLine(data, at('2026-11-06', '12:00'), 'zh').main).toMatchObject({ kind: 'quiet', text: '假日 · 不上课' });
    const labelled = { ...data, skips: [...skips, { onDate: '2026-11-02', meetingId: null, label: '补假' }] };
    expect(mainLine(labelled, at('2026-11-02', '08:00'), 'zh').main).toMatchObject({ text: '补假 · 不上课' });
    expect(mainLine(labelled, at('2026-11-02', '08:00'), 'en').main).toMatchObject({ text: '补假 · no classes' });
  });

  it('lists at most two more of today’s classes', () => {
    const busy: TimetableCourse = {
      ...mat,
      meetings: [
        lecture,
        { ...lecture, id: 'tm_MOREMOREMOREMOREMOREMO', startMin: 660, endMin: 710, location: null },
        { ...lecture, id: 'tm_LATELATELATELATELATEL', startMin: 780, endMin: 830, location: 'MN 1100' },
        { ...lecture, id: 'tm_LASTLASTLASTLASTLASTL', startMin: 900, endMin: 950, location: 'IB 120' },
      ],
    };
    const { main, later } = mainLine({ ...data, courses: [busy] }, at('2026-10-26', '09:00'), 'zh');
    expect(main).toMatchObject({ kind: 'next', pill: '1 小时后' });
    expect(later.map((line) => line.text)).toEqual(['11:00–11:50 · MAT102', '13:00–13:50 · MAT102 · MN 1100']);
  });

  it('waits for data, and knows an empty timetable', () => {
    expect(mainLine({ ...data, loaded: false }, at('2026-10-26', '09:25'), 'zh').main).toEqual({ kind: 'loading' });
    expect(mainLine({ ...data, courses: [] }, at('2026-10-26', '09:25'), 'zh').main).toEqual({ kind: 'empty' });
  });
});

describe('labels', () => {
  it('names days and waits', () => {
    expect(dayLabel('2026-10-27', '2026-10-26', 'zh')).toBe('明天');
    expect(dayLabel('2026-10-29', '2026-10-26', 'en')).toBe('Thu');
    expect(dayLabel('2026-11-03', '2026-10-26', 'zh')).toBe('11月3日 周二');
    expect(dayLabel('2026-11-03', '2026-10-26', 'en')).toBe('Tue, Nov 3');
    expect(startsIn(35, 'zh')).toBe('35 分钟后');
    expect(startsIn(60, 'zh')).toBe('1 小时后');
    expect(startsIn(125, 'zh')).toBe('2 小时 5 分钟后');
    expect(startsIn(125, 'en')).toBe('in 2 h 5 min');
  });

  it('links to the week view and the assignments tab', () => {
    expect(classLink({ date: '2026-10-26', meeting: lecture })).toBe(`/timetable?date=2026-10-26&focus=${lecture.id}`);
    expect(assignmentLink('ta_AAAAAAAAAAAAAAAAAAAAA1')).toBe('/timetable/due?focus=ta_AAAAAAAAAAAAAAAAAAAAA1');
  });
});

describe('assignment row', () => {
  it('shows the open assignment due first with its course', () => {
    const row = assignmentRow(fixtureAssignments, courses, at('2026-10-26', '09:25'), 'zh');
    expect(row).toMatchObject({
      overdue: 0,
      soon: 0,
      overdueText: null,
      soonText: null,
      first: { id: fixtureAssignments[0]!.id, title: 'PS3', meta: 'MAT102 · 周五 23:59', relative: '还剩 4 天', overdue: false },
    });
    expect(row?.first.course?.id).toBe(mat.id);
  });

  it('counts overdue and due-within-48-hours items', () => {
    const extra: TimetableAssignment[] = [
      { ...fixtureAssignments[0]!, id: 'ta_LATELATELATELATELATEL', title: 'Lab 2', courseId: null, dueAt: new Date(at('2026-10-25', '23:59')).toISOString() },
      { ...fixtureAssignments[0]!, id: 'ta_SOONSOONSOONSOONSOONS', title: 'Quiz', dueAt: new Date(at('2026-10-27', '17:00')).toISOString() },
      { ...fixtureAssignments[0]!, id: 'ta_SOONERSOONERSOONERSOO', title: 'Reading', dueAt: new Date(at('2026-10-28', '09:00')).toISOString() },
    ];
    const row = assignmentRow([...fixtureAssignments, ...extra], courses, at('2026-10-26', '09:25'), 'zh');
    expect(row).toMatchObject({ overdue: 1, soon: 2, overdueText: '1 项已逾期', soonText: '2 项 48 小时内截止' });
    expect(row?.first).toMatchObject({ title: 'Lab 2', meta: '昨天 23:59', overdue: true });
    expect(assignmentRow([...fixtureAssignments, ...extra], courses, at('2026-10-26', '09:25'), 'en')).toMatchObject({ overdueText: '1 overdue', soonText: '2 due within 48 h' });
  });

  it('is absent when everything is done', () => {
    expect(assignmentRow([fixtureAssignments[1]!], courses, at('2026-10-26', '09:25'), 'zh')).toBeNull();
    expect(assignmentRow([], courses, at('2026-10-26', '09:25'), 'zh')).toBeNull();
  });
});

describe('bell chip', () => {
  const on: TimetableSettings = { ...DEFAULT_TIMETABLE_SETTINGS, assignmentOffsets: [], classReminders: true, classLeadMin: 10 };
  const now = at('2026-10-26', '09:25');
  const base: BellInput = { remindersAllowed: true, settings: on, nextSendAtMs: nextReminderAt(data, on, true, now), capability: 'native', device: 'on', serverReady: null, nowMs: now };

  it('shows the lead and the next reminder', () => {
    expect(bellChip(base, 'zh')).toEqual({ kind: 'on', text: '上课提醒 · 提前 10 分钟 · 下次 09:50' });
    expect(bellChip(base, 'en')).toEqual({ kind: 'on', text: 'Class reminders · 10 min before · next 9:50 AM' });
    const later = at('2026-10-26', '11:00');
    expect(bellChip({ ...base, nowMs: later, nextSendAtMs: nextReminderAt(data, on, true, later) }, 'zh')).toEqual({ kind: 'on', text: '上课提醒 · 提前 10 分钟 · 下次 周三 13:50' });
    expect(bellChip({ ...base, nextSendAtMs: null }, 'zh')).toEqual({ kind: 'on', text: '上课提醒 · 提前 10 分钟' });
  });

  it('offers to turn reminders on, and to turn this device on', () => {
    expect(bellChip({ ...base, settings: { ...on, classReminders: false } }, 'zh')).toEqual({ kind: 'off', text: '开启上课提醒' });
    expect(bellChip({ ...base, device: 'off' }, 'zh').kind).toBe('enable_device');
    expect(bellChip({ ...base, capability: 'webpush', device: 'off', serverReady: true }, 'zh').kind).toBe('enable_device');
    // A browser whose server cannot send Web Push yet is not offered a permission that leads nowhere.
    // 服务器还不能发送 Web Push 时，不让浏览器授予一个毫无用处的权限。
    expect(bellChip({ ...base, capability: 'webpush', device: 'off', serverReady: false }, 'zh').kind).toBe('on');
  });

  it('sends the master switch, iPhone tabs and blocked devices to Settings', () => {
    expect(bellChip({ ...base, remindersAllowed: false }, 'zh')).toEqual({ kind: 'master_off', text: '已在设置中关闭课表提醒', link: NOTIFICATION_SETTINGS_PATH });
    expect(bellChip({ ...base, capability: 'ios-install' }, 'en')).toEqual({ kind: 'ios_install', text: 'Add to Home Screen to get class reminders', link: NOTIFICATION_SETTINGS_PATH });
    expect(bellChip({ ...base, device: 'denied' }, 'zh').kind).toBe('device_blocked');
    expect(NOTIFICATION_SETTINGS_PATH).toBe('/settings?tab=settings&screen=notifications');
  });

  it('knows when a tap can turn this device on', () => {
    expect(canEnableHere('native', 'off', null)).toBe(true);
    expect(canEnableHere('webpush', 'off', true)).toBe(true);
    expect(canEnableHere('webpush', 'off', null)).toBe(false);
    expect(canEnableHere('native', 'on', null)).toBe(false);
    expect(canEnableHere('unsupported', 'off', null)).toBe(false);
    expect(canEnableHere(null, 'checking', null)).toBe(false);
  });

  it('names the reminder time by day', () => {
    expect(reminderWhen(at('2026-10-26', '09:50'), now, 'zh')).toBe('09:50');
    expect(reminderWhen(at('2026-10-27', '09:50'), now, 'zh')).toBe('明天 09:50');
    expect(reminderWhen(at('2026-10-29', '12:50'), now, 'en')).toBe('Thu 12:50 PM');
  });

  it('has no next reminder while reminders are off or not allowed', () => {
    expect(nextReminderAt(data, { classReminders: false, classLeadMin: 10 }, true, now)).toBeNull();
    expect(nextReminderAt(data, on, false, now)).toBeNull();
    expect(nextReminderAt(data, on, true, now)).toBe(at('2026-10-26', '09:50'));
  });
});
