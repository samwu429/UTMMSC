/**
 * English for the timetable routes' messages (TIMETABLE_MESSAGES in packages/shared/src/timetable/types.ts).
 * Owner: T3, timetable web core. shared/api/errors.ts merges this file and is otherwise frozen.
 * 课表接口提示的英文（见 packages/shared/src/timetable/types.ts 中的 TIMETABLE_MESSAGES）。
 * 维护者：T3，课表网页核心。shared/api/errors.ts 合并本文件，此外不再改动。
 */
import { TIMETABLE_MESSAGES } from '@utmmsc/shared';
import type { EnglishPattern } from '../errors';

/** Exact server text to its English. invalid_body (请求格式错误) is already in the core map. */
/** 服务端原文到英文的对照。invalid_body（请求格式错误）已在核心对照表中。 */
export const ENGLISH: Readonly<Record<string, string>> = {
  [TIMETABLE_MESSAGES.invalid_id]: "That item's ID isn't valid.",
  [TIMETABLE_MESSAGES.invalid_course_code]: 'Enter a course code (up to 20 characters).',
  [TIMETABLE_MESSAGES.invalid_color]: "That course colour isn't valid.",
  [TIMETABLE_MESSAGES.invalid_meeting_kind]: "That kind of class isn't valid.",
  [TIMETABLE_MESSAGES.invalid_meeting_time]: 'Classes must be between 9:00 AM and 9:00 PM, in 5-minute steps.',
  [TIMETABLE_MESSAGES.meeting_too_short]: 'Each class must be at least 10 minutes long.',
  [TIMETABLE_MESSAGES.too_many_meetings]: 'A course can have at most 10 class times.',
  [TIMETABLE_MESSAGES.too_many_courses]: 'You can have at most 30 courses.',
  [TIMETABLE_MESSAGES.invalid_weeks]: 'Set up a term before using odd, even or custom weeks.',
  [TIMETABLE_MESSAGES.invalid_week_list]: 'Custom weeks must be between week 1 and 40, with no repeats.',
  [TIMETABLE_MESSAGES.invalid_term]: "The term dates aren't valid. A term can be at most 40 weeks long.",
  [TIMETABLE_MESSAGES.invalid_term_name]: 'Enter a name for the term.',
  [TIMETABLE_MESSAGES.too_many_terms]: 'You can have at most 6 terms.',
  [TIMETABLE_MESSAGES.term_not_found]: "That term doesn't exist.",
  [TIMETABLE_MESSAGES.course_not_found]: "That course doesn't exist.",
  [TIMETABLE_MESSAGES.invalid_assignment_title]: 'Enter a name for the assignment.',
  [TIMETABLE_MESSAGES.invalid_due_time]: "That due time isn't valid.",
  [TIMETABLE_MESSAGES.invalid_offset]: "That reminder time isn't valid.",
  [TIMETABLE_MESSAGES.too_many_offsets]: 'An assignment can have at most 3 reminders.',
  [TIMETABLE_MESSAGES.too_many_assignments]: 'You can have at most 300 open assignments.',
  [TIMETABLE_MESSAGES.too_many_assignments_total]: 'You can have at most 1000 assignments. Clear the done ones first.',
  [TIMETABLE_MESSAGES.invalid_skip_date]: "That date with no class isn't valid.",
  [TIMETABLE_MESSAGES.too_many_skips]: 'You can have at most 200 dates with no class.',
  [TIMETABLE_MESSAGES.invalid_settings]: "Those timetable settings aren't valid.",
  [TIMETABLE_MESSAGES.id_taken]: 'That ID is already in use.',
  [TIMETABLE_MESSAGES.timetable_unavailable]: 'The timetable is being upgraded. Try again soon.',
};

/** Server text that embeds a number or a name. The timetable routes send none today. */
/** 含数字或名称的服务端提示。课表接口目前没有这类提示。 */
export const ENGLISH_PATTERNS: readonly EnglishPattern[] = [];
