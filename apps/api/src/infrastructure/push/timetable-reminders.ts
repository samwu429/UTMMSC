import {
  REMINDER_EXPIRY_MARGIN_MS,
  classSlots,
  isoWeekday,
  occursOn,
  skipKey,
  torontoDateOf,
  torontoMinuteOf,
  type NotificationPrefs,
  type PushPayload,
  type TimetableLocale,
} from '@utmmsc/shared';
import {
  assignmentReminderPayload,
  classReminderPayload,
  type AssignmentReminderItem,
  type ClassReminderItem,
} from '../../domain/notifications/timetable-payloads';
import type { Env } from '../../env';
import { isMissingSchemaError } from '../d1/channels';
import { listTimetableOptOut } from '../d1/notification-prefs';
import {
  claimClassReminders,
  claimDueReminders,
  finishReminders,
  loadReminderDetails,
  pruneReminders,
  scanClassReminders,
  type ClaimedReminder,
  type ReminderDetails,
  type ScannedClass,
} from '../d1/timetable-reminders';
import { sendToMembersReport, type MemberPushOutcome } from './send';

/**
 * The minute cron's timetable job (timetable-final.md section 6.2). One run: put back abandoned rows, cancel the
 * expiring ones and claim the due ones; scan for classes starting within each lead and claim them into the ledger;
 * check the claimed rows against what the member has now; send one class push and one assignment push per member;
 * record each outcome. Any edit, skip or switch therefore takes effect at the next minute, and nothing is planned
 * ahead for classes.
 * 每分钟定时任务中的课表工作（timetable-final.md 第 6.2 节）。一次运行：放回被放弃的行、取消即将失效的行并领取到期的行；扫描在各提前时间内
 * 开始的课并领取到提醒记录中；按成员当前的数据检查已领取的行；每位成员发送一条上课推送和一条作业推送；记录每个结果。
 * 因此任何修改、停课或开关变化在下一分钟生效，上课提醒也无需提前安排。
 */

const MINUTE_MS = 60_000;
/** The UTC minute of each hour at which finished rows older than 14 days are deleted. */
/** 每小时在这个 UTC 分钟删除超过 14 天的已结束行。 */
export const RETENTION_UTC_MINUTE = 7;
/** A run this far behind is worth a log line even when it sent nothing. */
/** 运行落后这么多时，即使什么也没发送也值得记一行日志。 */
const SLOW_RUN_MS = 20_000;

export interface TimetableRunOptions {
  /** The current time; tests fix it. */
  /** 当前时间；测试中固定它。 */
  clock?: () => number;
}

/** Counts for one run; the log line shows them and never a course name. */
/** 一次运行的计数；日志只显示这些数字，从不包含课程名称。 */
export interface TimetableRunSummary {
  /** Due rows claimed from the ledger (assignments, and class rows put back for a retry). */
  /** 从记录中领取的到期行（作业提醒，以及放回重试的上课提醒）。 */
  claimed: number;
  /** Class occurrences the scan found and this run claimed. */
  /** 扫描找到并由本次运行领取的上课次数。 */
  scanned: number;
  sent: number;
  retry: number;
  failed: number;
  skipped: number;
  cancelled: number;
  /** Rows a run that died left in sending, put back or failed by this run. */
  /** 中断的运行留在发送中、由本次运行放回或记为失败的行。 */
  abandoned: number;
  /** Due rows cancelled before sending because they would expire within a minute. */
  /** 因一分钟内就要失效而在发送前取消的到期行。 */
  expired: number;
  pruned: number;
}

function emptySummary(): TimetableRunSummary {
  return { claimed: 0, scanned: 0, sent: 0, retry: 0, failed: 0, skipped: 0, cancelled: 0, abandoned: 0, expired: 0, pruned: 0 };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface MemberClasses {
  locale: TimetableLocale;
  items: Map<string, { reminderIds: number[]; item: ClassReminderItem }>;
}

interface MemberAssignments {
  locale: TimetableLocale;
  items: Map<string, { reminderIds: number[]; item: AssignmentReminderItem }>;
}

/** What a run will send, per member, the rows it has decided to cancel, and the rows it could not check. */
/** 本次运行将要发送的内容（按成员）、决定取消的行，以及无法检查的行。 */
interface RunPlan {
  classes: Map<string, MemberClasses>;
  assignments: Map<string, MemberAssignments>;
  cancelled: number[];
  /** Claimed rows whose check failed; they go back to pending for the next minute while attempts and time remain. */
  /** 检查失败的已领取行；在仍有次数和时间时回到 pending，留待下一分钟。 */
  retry: number[];
}

function addClass(plan: RunPlan, memberId: string, locale: TimetableLocale, reminderId: number, item: ClassReminderItem): void {
  const member = plan.classes.get(memberId) ?? { locale, items: new Map() };
  const key = `${item.meetingId}@${item.startMs}`;
  const entry = member.items.get(key) ?? { reminderIds: [], item };
  entry.reminderIds.push(reminderId);
  member.items.set(key, entry);
  plan.classes.set(memberId, member);
}

/** Several due offsets of one assignment (after a missed run) become one line of one push. */
/** 同一作业的几个到期提醒（错过运行之后）合并为一条推送中的一行。 */
function addAssignment(plan: RunPlan, memberId: string, locale: TimetableLocale, reminderId: number, item: AssignmentReminderItem): void {
  const member = plan.assignments.get(memberId) ?? { locale, items: new Map() };
  const entry = member.items.get(item.assignmentId) ?? { reminderIds: [], item };
  entry.reminderIds.push(reminderId);
  member.items.set(item.assignmentId, entry);
  plan.assignments.set(memberId, member);
}

/** The scan's classes claimed by this run, as push items. Only rows the claim returned are sent. */
/** 本次运行领取的扫描结果，转换为推送条目。只发送领取时返回的行。 */
async function claimScannedClasses(env: Env, runMs: number, plan: RunPlan): Promise<number> {
  const slots = classSlots(runMs);
  if (slots.length === 0) return 0;
  const found = await scanClassReminders(env.DB, slots);
  if (found.length === 0) return 0;
  const claimed = await claimClassReminders(
    env.DB,
    found.map((row) => ({ memberId: row.memberId, meetingId: row.meetingId, occursAt: row.occursAt, lead: row.lead })),
    runMs,
  );
  const byKey = new Map<string, ScannedClass>(found.map((row) => [`${row.meetingId}@${row.occursAt}`, row]));
  let count = 0;
  for (const row of claimed) {
    const scanned = byKey.get(`${row.meetingId}@${row.occursAt}`);
    if (!scanned) continue;
    count += 1;
    addClass(plan, scanned.memberId, scanned.locale, row.id, {
      meetingId: scanned.meetingId,
      code: scanned.code,
      kind: scanned.kind,
      location: scanned.location,
      startMin: scanned.startMin,
      endMin: scanned.endMin,
      onDate: scanned.onDate,
      startMs: Date.parse(scanned.occursAt),
    });
  }
  return count;
}

/**
 * Whether a claimed assignment row still holds: the assignment exists, is not done, still has this due time and
 * still asks for this offset.
 * 已领取的作业提醒是否仍然有效：作业存在、未完成、截止时间未变，且仍包含这个提醒时间。
 */
function assignmentStillDue(row: ClaimedReminder, details: ReminderDetails): AssignmentReminderItem | null {
  const assignment = row.assignmentId ? details.assignments.get(row.assignmentId) : undefined;
  if (!assignment || assignment.memberId !== row.memberId || assignment.done) return null;
  const dueMs = Date.parse(assignment.dueAt);
  if (Number.isNaN(dueMs) || dueMs !== Date.parse(row.occursAt)) return null;
  if (!assignment.remindOffsets.some((offset) => offset === row.offsetKey)) return null;
  return { assignmentId: assignment.id, title: assignment.title, courseCode: assignment.courseCode, dueMs };
}

/**
 * Whether a class row put back for a retry still holds: class reminders and the course switch are on, the meeting
 * still starts at the claimed instant, and the class still takes place that day under occursOn.
 * 放回重试的上课提醒是否仍然有效：上课提醒和这门课的开关都开启，上课时间仍在领取时的时刻开始，并且按 occursOn 这节课当天仍然会上。
 */
function classStillDue(row: ClaimedReminder, details: ReminderDetails): ClassReminderItem | null {
  const meeting = details.meetings.get(row.id);
  if (!meeting || !meeting.remind || meeting.term === undefined) return null;
  if (!details.settings.get(row.memberId)?.classReminders) return null;
  const startMs = Date.parse(row.occursAt);
  if (Number.isNaN(startMs)) return null;
  const onDate = torontoDateOf(startMs);
  if (isoWeekday(onDate) !== meeting.weekday || torontoMinuteOf(startMs) !== meeting.startMin) return null;
  const skips = new Set(meeting.skipped ? [skipKey(onDate, meeting.meetingId)] : []);
  if (!occursOn({ id: meeting.meetingId, weekday: meeting.weekday, weekRule: meeting.weekRule, weekList: meeting.weekList }, meeting.term, skips, onDate)) return null;
  return {
    meetingId: meeting.meetingId,
    code: meeting.code,
    kind: meeting.kind,
    location: meeting.location,
    startMin: meeting.startMin,
    endMin: meeting.endMin,
    onDate,
    startMs,
  };
}

/** Checks the rows claimed from the ledger and adds those that still hold to the plan; the rest are cancelled. */
/** 检查从记录中领取的行，把仍然有效的加入计划，其余的取消。 */
async function planClaimedRows(env: Env, due: readonly ClaimedReminder[], plan: RunPlan): Promise<void> {
  if (due.length === 0) return;
  const memberIds = [...new Set(due.map((row) => row.memberId))];
  const classRows = due
    .filter((row) => row.kind === 'class' && row.meetingId)
    .map((row) => ({ id: row.id, meetingId: row.meetingId as string, memberId: row.memberId, onDate: torontoDateOf(Date.parse(row.occursAt)) }));
  const assignmentIds = due.filter((row) => row.kind === 'assignment' && row.assignmentId).map((row) => row.assignmentId as string);
  const details = await loadReminderDetails(env.DB, { assignmentIds, classRows, memberIds });
  // 课表提醒 is read on its own, like 好友动态互动, so the device join never depends on the column.
  // 「课表提醒」像「好友动态互动」一样单独读取，设备联表查询因此从不依赖这一列。
  const optedOut = await listTimetableOptOut(env.DB, memberIds);
  for (const row of due) {
    const locale = details.settings.get(row.memberId)?.locale ?? 'zh';
    if (optedOut.has(row.memberId)) {
      plan.cancelled.push(row.id);
    } else if (row.kind === 'assignment') {
      const item = assignmentStillDue(row, details);
      if (item) addAssignment(plan, row.memberId, locale, row.id, item);
      else plan.cancelled.push(row.id);
    } else {
      const item = classStillDue(row, details);
      if (item) addClass(plan, row.memberId, locale, row.id, item);
      else plan.cancelled.push(row.id);
    }
  }
}

/**
 * Drops items that would arrive within a minute of the class start or the deadline, which only a run far behind
 * its schedule can hold. A class notice is therefore never sent once its class is about to start.
 * 去掉距开课或截止不到一分钟的条目；只有严重落后于计划的运行才会遇到。上课通知因此从不会在快要开课时才发出。
 */
function dropExpiring<T extends { reminderIds: number[] }>(items: Map<string, T>, expiresMs: (entry: T) => number, nowMs: number, cancelled: number[]): void {
  for (const [key, entry] of items) {
    if (expiresMs(entry) > nowMs + REMINDER_EXPIRY_MARGIN_MS) continue;
    cancelled.push(...entry.reminderIds);
    items.delete(key);
  }
}

interface Outcomes {
  sent: number[];
  skipped: number[];
  failed: number[];
  cancelled: number[];
  retry: number[];
}

function record(outcomes: Outcomes, outcome: MemberPushOutcome | undefined, ids: readonly number[]): void {
  if (outcome === 'sent') outcomes.sent.push(...ids);
  else if (outcome === 'none') outcomes.skipped.push(...ids);
  else if (outcome === 'failed') outcomes.failed.push(...ids);
  else outcomes.retry.push(...ids);
}

/**
 * One pass: one push per member, always through the relay. A pass that fails as a whole leaves every row of it for
 * a retry.
 * 一轮发送：每位成员一条推送，始终经由中继。整轮失败时，其中每一行都留待重试。
 */
async function sendPass(
  env: Env,
  members: Map<string, { reminderIds: number[] }[]>,
  payloadFor: (memberId: string, prefs: NotificationPrefs) => PushPayload | null,
  outcomes: Outcomes,
): Promise<void> {
  if (members.size === 0) return;
  let report = new Map<string, MemberPushOutcome>();
  try {
    report = await sendToMembersReport(env, [...members.keys()], payloadFor, { relay: 'always' });
  } catch (err) {
    console.error('timetable: push pass failed', errorText(err));
  }
  for (const [memberId, entries] of members) record(outcomes, report.get(memberId), entries.flatMap((entry) => entry.reminderIds));
}

async function sendPlan(env: Env, plan: RunPlan, nowMs: number): Promise<Outcomes> {
  const outcomes: Outcomes = { sent: [], skipped: [], failed: [], cancelled: plan.cancelled, retry: plan.retry };
  const baseUrl = env.APP_BASE_URL;
  for (const member of plan.classes.values()) dropExpiring(member.items, (entry) => entry.item.startMs, nowMs, outcomes.cancelled);
  for (const member of plan.assignments.values()) dropExpiring(member.items, (entry) => entry.item.dueMs, nowMs, outcomes.cancelled);

  const classes = new Map([...plan.classes].filter(([, member]) => member.items.size > 0));
  await sendPass(
    env,
    new Map([...classes].map(([memberId, member]) => [memberId, [...member.items.values()]])),
    (memberId, prefs) => {
      const member = classes.get(memberId);
      if (!member) return null;
      const items = [...member.items.values()].map((entry) => entry.item);
      return classReminderPayload({ classes: items, locale: member.locale, preview: prefs.preview, nowMs, baseUrl });
    },
    outcomes,
  );

  const assignments = new Map([...plan.assignments].filter(([, member]) => member.items.size > 0));
  await sendPass(
    env,
    new Map([...assignments].map(([memberId, member]) => [memberId, [...member.items.values()]])),
    (memberId, prefs) => {
      const member = assignments.get(memberId);
      if (!member) return null;
      const items = [...member.items.values()].map((entry) => entry.item);
      return assignmentReminderPayload({ assignments: items, locale: member.locale, preview: prefs.preview, nowMs, baseUrl });
    },
    outcomes,
  );
  return outcomes;
}

/**
 * Records the outcomes, trying once more when the first write fails: rows left in sending would be put back and
 * pushed a second time after REMINDER_STUCK_AFTER_MS. The batch is one transaction and touches only rows still in
 * sending, so a second try after a write that did land changes nothing.
 * 记录结果；第一次写入失败时再试一次：仍处于发送中的行会在 REMINDER_STUCK_AFTER_MS 之后被放回并再推送一次。
 * 该批次是一个事务，且只更新仍在发送中的行，因此即使第一次写入其实已经生效，再试一次也不会改变任何内容。
 */
async function recordOutcomes(env: Env, outcomes: Outcomes, runMs: number, sentAtMs: number): Promise<void> {
  try {
    await finishReminders(env.DB, outcomes, runMs, sentAtMs);
  } catch (err) {
    if (isMissingSchemaError(err)) throw err;
    console.error('timetable: recording outcomes failed, trying again', errorText(err));
    await finishReminders(env.DB, outcomes, runMs, sentAtMs);
  }
}

/**
 * One run of the timetable job for the cron time `scheduled`. A run that starts more than a minute late works from
 * the current minute instead, so it never claims a class about to start. Before migration 0017 it does nothing and
 * logs nothing; otherwise it logs one line of counts and lag when it did anything. Never throws.
 * 针对定时时间 `scheduled` 的一次课表工作。晚了超过一分钟才开始的运行改按当前分钟计算，因此不会领取快要开始的课。
 * 迁移 0017 之前什么也不做，也不记日志；否则在有所处理时记一行计数和延迟。从不抛出异常。
 */
export async function runTimetableReminders(env: Env, scheduled: Date, options: TimetableRunOptions = {}): Promise<TimetableRunSummary> {
  const clock = options.clock ?? Date.now;
  const runMs = Math.max(scheduled.getTime(), Math.floor(clock() / MINUTE_MS) * MINUTE_MS);
  const summary = emptySummary();
  try {
    const claim = await claimDueReminders(env.DB, runMs);
    const due = claim.rows;
    summary.claimed = due.length;
    summary.abandoned = claim.abandoned;
    summary.expired = claim.expired;
    const plan: RunPlan = { classes: new Map(), assignments: new Map(), cancelled: [], retry: [] };
    try {
      summary.scanned = await claimScannedClasses(env, runMs, plan);
    } catch (err) {
      // The claimed rows still go out; a class claimed before the failure is put back after REMINDER_STUCK_AFTER_MS.
      // 已领取的行照常发送；失败之前已领取的课会在 REMINDER_STUCK_AFTER_MS 之后被放回。
      if (isMissingSchemaError(err)) throw err;
      console.error('timetable: class scan failed', errorText(err));
    }
    try {
      await planClaimedRows(env, due, plan);
    } catch (err) {
      // planClaimedRows reads everything before it adds a row to the plan, so the scanned classes still go out
      // alone and the rows that could not be checked are tried again next minute.
      // planClaimedRows 在把任何一行加入计划之前就读完了全部数据，因此扫描到的课照常单独发送，无法检查的行在下一分钟再试。
      if (isMissingSchemaError(err)) throw err;
      console.error('timetable: checking claimed rows failed', errorText(err));
      plan.retry.push(...due.map((row) => row.id));
    }
    const outcomes = await sendPlan(env, plan, Math.max(runMs, clock()));
    await recordOutcomes(env, outcomes, runMs, Math.max(runMs, clock()));
    summary.sent = outcomes.sent.length;
    summary.retry = outcomes.retry.length;
    summary.failed = outcomes.failed.length;
    summary.skipped = outcomes.skipped.length;
    summary.cancelled = outcomes.cancelled.length;
    if (new Date(runMs).getUTCMinutes() === RETENTION_UTC_MINUTE) summary.pruned = await pruneReminders(env.DB, runMs);
  } catch (err) {
    if (isMissingSchemaError(err)) return summary;
    console.error('timetable: reminder run failed', errorText(err));
    return summary;
  }
  const lag = clock() - scheduled.getTime();
  const busy = summary.claimed + summary.scanned + summary.abandoned + summary.expired + summary.pruned > 0;
  if (busy || lag >= SLOW_RUN_MS) {
    console.log(
      `timetable: reminders claimed=${summary.claimed} scanned=${summary.scanned} sent=${summary.sent} retry=${summary.retry} failed=${summary.failed} skipped=${summary.skipped} cancelled=${summary.cancelled} abandoned=${summary.abandoned} expired=${summary.expired} pruned=${summary.pruned} lag=${lag}ms`,
    );
  }
  return summary;
}
