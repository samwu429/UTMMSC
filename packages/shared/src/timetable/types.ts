/**
 * Personal timetable (自定义课表): the contract between the app and the /home/timetable routes. Every time of day
 * is Toronto wall-clock time in minutes after midnight; every date is a Toronto date (YYYY-MM-DD); dueAt and
 * other instants are ISO strings in UTC.
 * 个人课表（自定义课表）：App 与 /home/timetable 接口之间的约定。所有时刻都是多伦多本地时间，以午夜起算的分钟数表示；
 * 所有日期都是多伦多日期（YYYY-MM-DD）；dueAt 等时间点为 UTC 的 ISO 字符串。
 */

/** Classes are kept between 09:00 and 21:00, on 5-minute steps, at least 10 minutes long. */
/** 上课时间限定在 09:00 到 21:00 之间，按 5 分钟设置，每次至少 10 分钟。 */
export const TIMETABLE_DAY_START_MIN = 540; // 09:00
export const TIMETABLE_DAY_END_MIN = 1260; // 21:00
export const TIMETABLE_STEP_MIN = 5;
export const TIMETABLE_MEETING_MIN_MIN = 10;
export const TIMETABLE_LAST_START_MIN = 1250; // 20:50

/** How long before class a class reminder goes out, in minutes. Class reminders are off until turned on. */
/** 上课提醒提前的分钟数。上课提醒在开启之前为关闭。 */
export const CLASS_LEADS = [5, 10, 15, 20, 30] as const;
export type ClassLead = (typeof CLASS_LEADS)[number];
export const DEFAULT_CLASS_LEAD: ClassLead = 10;

/** The scan never claims a class starting within 2 minutes; such a reminder would arrive too late to help. */
/** 扫描从不领取 2 分钟内就要开始的课；这样的提醒到达时已经来不及。 */
export const CLASS_SCAN_MIN_NOTICE_MS = 2 * 60_000;
/** A retry is dropped within 1 minute of expires_at (the class start or the due time). */
/** 距 expires_at（上课开始或截止时间）不到 1 分钟时，不再重试。 */
export const REMINDER_EXPIRY_MARGIN_MS = 60_000;

/**
 * Assignment reminder offsets, longest first. 30m, 1h and 3h are exact durations; 1d, 2d and 1w keep the
 * Toronto wall time of the deadline on an earlier date; morning is morningOf the deadline.
 * 作业提醒时间，从长到短。30m、1h、3h 是精确时长；1d、2d、1w 在更早的日期保持截止时间的多伦多本地时刻；morning 为截止时间的 morningOf。
 */
export const ASSIGNMENT_OFFSETS = ['1w', '2d', '1d', 'morning', '3h', '1h', '30m'] as const;
export type AssignmentOffset = (typeof ASSIGNMENT_OFFSETS)[number];
export const DEFAULT_ASSIGNMENT_OFFSETS: readonly AssignmentOffset[] = ['1d', '1h'];
export const ASSIGNMENT_OFFSETS_MAX = 3;

export const MEETING_KINDS = ['lec', 'tut', 'pra', 'lab', 'sem', 'other'] as const;
export type MeetingKind = (typeof MEETING_KINDS)[number];

/** all: every week. odd and even: term weeks 1, 3, 5... or 2, 4, 6... list: the weeks in weekList. */
/** all：每周。odd 与 even：学期第 1、3、5……周或第 2、4、6……周。list：weekList 中的周次。 */
export const WEEK_RULES = ['all', 'odd', 'even', 'list'] as const;
export type WeekRule = (typeof WEEK_RULES)[number];

export const COURSE_COLORS = ['purple', 'gold', 'blue', 'green', 'red', 'teal', 'orange', 'pink', 'indigo', 'lime', 'brown', 'slate'] as const;
export type CourseColor = (typeof COURSE_COLORS)[number];

/** Counts per member and text lengths in characters (code points). */
/** 每位成员的数量上限，以及按字符（码点）计算的文字长度上限。 */
export const TIMETABLE_LIMITS = {
  terms: 6,
  courses: 30,
  meetingsPerCourse: 10,
  openAssignments: 300,
  assignments: 1000,
  skips: 200,
  termWeeks: 40,
  code: 20,
  title: 80,
  section: 12,
  location: 60,
  notes: 1000,
  assignmentTitle: 120,
  label: 30,
  termName: 30,
} as const;

/** Ids the client chooses: tt_ term, tc_ course, tm_ meeting, ta_ assignment, then 22 base64url characters (128 bits). */
/** 由客户端生成的 id：tt_ 学期、tc_ 课程、tm_ 上课时间、ta_ 作业，后接 22 个 base64url 字符（128 位）。 */
export const TIMETABLE_ID = /^(tt|tc|tm|ta)_[A-Za-z0-9_-]{22}$/;
export type TimetableIdPrefix = 'tt' | 'tc' | 'tm' | 'ta';

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type TimetableLocale = 'zh' | 'en';

export interface TimetableMeeting {
  id: string;
  kind: MeetingKind;
  section: string | null;
  /** 1 is Monday, 7 is Sunday. */
  /** 1 为周一，7 为周日。 */
  weekday: Weekday;
  startMin: number;
  endMin: number;
  location: string | null;
  weekRule: WeekRule;
  /** Term weeks for weekRule 'list', ascending; null for every other rule. */
  /** weekRule 为 'list' 时的学期周次，升序；其他规则为 null。 */
  weekList: number[] | null;
}

export interface TimetableCourse {
  id: string;
  /** Null: the course repeats every week with no end. */
  /** 为 null：课程每周重复，没有结束日期。 */
  termId: string | null;
  code: string;
  title: string | null;
  color: CourseColor;
  notes: string | null;
  /** 这门课上课提醒. */
  /** 这门课上课提醒。 */
  remind: boolean;
  meetings: TimetableMeeting[];
  updatedAt: string;
}

export interface TimetableTerm {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  /** Term weeks with no classes, such as reading week, ascending. Week 1 is the Monday-to-Sunday week holding startsOn. */
  /** 不上课的学期周次（例如阅读周），升序。第 1 周是包含 startsOn 的周一到周日。 */
  skipWeeks: number[];
  updatedAt: string;
}

/** A date with no class: meetingId null for a holiday (every class that day), or one meeting (本次不上). */
/** 没有课的日期：meetingId 为 null 表示假日（当天所有课），否则只停这一次课（本次不上）。 */
export interface TimetableSkip {
  onDate: string;
  meetingId: string | null;
  label: string | null;
}

export interface TimetableAssignment {
  id: string;
  courseId: string | null;
  title: string;
  notes: string | null;
  /** A UTC instant on a whole minute, as toISOString writes it. */
  /** 整分钟的 UTC 时间，格式与 toISOString 一致。 */
  dueAt: string;
  remindOffsets: AssignmentOffset[];
  doneAt: string | null;
  updatedAt: string;
}

export interface TimetableSettings {
  classReminders: boolean;
  classLeadMin: ClassLead;
  /** Copied onto each new assignment; an empty list means no reminders. */
  /** 新建作业时复制到作业上；空列表表示不提醒。 */
  assignmentOffsets: AssignmentOffset[];
  showWeekend: 'always' | 'auto';
  /** The language of this member's timetable pushes. */
  /** 该成员课表推送使用的语言。 */
  locale: TimetableLocale;
}

/** What a member without a settings row has. */
/** 没有设置记录的成员使用的默认值。 */
export const DEFAULT_TIMETABLE_SETTINGS: Readonly<TimetableSettings> = Object.freeze({
  classReminders: false,
  classLeadMin: DEFAULT_CLASS_LEAD,
  assignmentOffsets: [...DEFAULT_ASSIGNMENT_OFFSETS],
  showWeekend: 'always',
  locale: 'zh',
});

/** remindersAllowed is 设置 → 通知 → 课表提醒; it is also in the unchanged answer, since that switch does not bump rev. */
/** remindersAllowed 即「设置 → 通知 → 课表提醒」；它也出现在未变化的应答中，因为这个开关不会让 rev 增加。 */
export interface TimetableResponse {
  rev: number;
  remindersAllowed: boolean;
  settings: TimetableSettings;
  terms: TimetableTerm[];
  courses: TimetableCourse[];
  skips: TimetableSkip[];
  assignments: TimetableAssignment[];
}

/** GET /home/timetable?rev=N when N is still the member's rev. */
/** GET /home/timetable?rev=N 且 N 仍是成员当前 rev 时的应答。 */
export interface TimetableUnchanged {
  rev: number;
  unchanged: true;
  remindersAllowed: boolean;
}

export type SaveCourseBody = Omit<TimetableCourse, 'updatedAt'>;
export type SaveTermBody = Omit<TimetableTerm, 'updatedAt'>;

/** done omitted keeps the stored done state. */
/** 省略 done 时保留已存的完成状态。 */
export interface SaveAssignmentBody {
  id: string;
  courseId: string | null;
  title: string;
  notes: string | null;
  dueAt: string;
  remindOffsets: AssignmentOffset[];
  done?: boolean;
}

export interface SetAssignmentDoneBody {
  done: boolean;
}

export interface SetSkipBody {
  onDate: string;
  meetingId: string | null;
  skipped: boolean;
  label?: string | null;
}

export type UpdateTimetableSettingsBody = Partial<TimetableSettings>;

export interface ImportTimetableBody {
  terms: SaveTermBody[];
  courses: SaveCourseBody[];
  assignments: SaveAssignmentBody[];
  skips: Omit<SetSkipBody, 'skipped'>[];
}

/** Every write answers with the member's new rev and the saved item. */
/** 每次写入都返回成员新的 rev 和保存后的条目。 */
export interface TimetableWriteResponse<T = null> {
  rev: number;
  item: T;
}

/** POST /courses. */
export type SaveCourseResponse = TimetableWriteResponse<TimetableCourse>;
/** POST /terms. */
export type SaveTermResponse = TimetableWriteResponse<TimetableTerm>;
/** POST /assignments and PATCH /assignments/:id. */
/** POST /assignments 与 PATCH /assignments/:id。 */
export type SaveAssignmentResponse = TimetableWriteResponse<TimetableAssignment>;
/** POST /skips: the skip as stored, or null after it was removed. */
/** POST /skips：保存后的停课记录；删除后为 null。 */
export type SetSkipResponse = TimetableWriteResponse<TimetableSkip | null>;
/** PATCH /settings. */
export type UpdateTimetableSettingsResponse = TimetableWriteResponse<TimetableSettings>;
/** DELETE /courses/:id, /terms/:id, /assignments/:id and POST /clear. */
/** DELETE /courses/:id、/terms/:id、/assignments/:id 与 POST /clear。 */
export type DeleteTimetableItemResponse = TimetableWriteResponse<null>;

/** How many rows of each kind POST /import wrote; the app fetches the timetable again afterwards. */
/** POST /import 写入的各类条目数量；之后 App 会重新获取课表。 */
export interface ImportTimetableCounts {
  terms: number;
  courses: number;
  assignments: number;
  skips: number;
}
export type ImportTimetableResponse = TimetableWriteResponse<ImportTimetableCounts>;

/**
 * Every refusal of a timetable write, with the Chinese text the API sends. The web app adds the English for
 * each text in shared/api/errors/timetable.ts. Codes are 400 unless noted.
 * 课表写入的所有拒绝及接口返回的中文提示。网页端在 shared/api/errors/timetable.ts 中为每句中文补上英文。除注明外均为 400。
 */
export const TIMETABLE_MESSAGES = {
  /** A body or field of the wrong type. */
  /** 请求体或字段的类型不对。 */
  invalid_body: '请求格式错误',
  invalid_id: '编号格式不对',
  invalid_course_code: '请填写课程代码（最多 20 个字符）',
  invalid_color: '课程颜色不对',
  invalid_meeting_kind: '上课类型不对',
  invalid_meeting_time: '上课时间需在 09:00–21:00 之间，按 5 分钟设置',
  meeting_too_short: '每次课至少 10 分钟',
  too_many_meetings: '每门课最多 10 个上课时间',
  too_many_courses: '最多 30 门课程',
  invalid_weeks: '单双周和自定义周次需要先设置学期',
  invalid_week_list: '自定义周次需在第 1–40 周之间，且不能重复',
  invalid_term: '学期日期不对，最长 40 周',
  invalid_term_name: '请填写学期名称',
  too_many_terms: '最多 6 个学期',
  /** 404. */
  term_not_found: '学期不存在',
  /** 404. */
  course_not_found: '课程不存在',
  invalid_assignment_title: '请填写作业名称',
  invalid_due_time: '截止时间格式不对',
  invalid_offset: '提醒时间不对',
  too_many_offsets: '每项作业最多 3 个提醒',
  too_many_assignments: '未完成的作业最多 300 项',
  /** A new assignment past TIMETABLE_LIMITS.assignments, counting the open ones and those done in the last 30 days. */
  /** 新作业超出 TIMETABLE_LIMITS.assignments，计入未完成的作业和最近 30 天内完成的作业。 */
  too_many_assignments_total: '作业最多 1000 项，请先清除已完成的作业',
  invalid_skip_date: '停课日期不对',
  too_many_skips: '停课日期最多 200 个',
  invalid_settings: '课表设置不对',
  /** 409; never echoes the other member's data. */
  /** 409；从不返回另一位成员的数据。 */
  id_taken: '这个编号已被使用',
  /** 503, before migration 0017. */
  /** 503，迁移 0017 之前。 */
  timetable_unavailable: '课表功能正在升级，请稍后再试',
} as const;

export type TimetableErrorCode = keyof typeof TIMETABLE_MESSAGES;
