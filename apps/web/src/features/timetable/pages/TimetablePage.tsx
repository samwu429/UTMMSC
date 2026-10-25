/**
 * Owner: T3, timetable web core. /timetable/* (timetable-final.md sections 9-12), lazily loaded outside AppShell:
 * /timetable is the week grid (课表) and /timetable/due the assignments tab (作业), each its own route so back and
 * deep links (?date=…&focus=tm_…, ?focus=ta_…, ?add=course) work. The page keeps the visible week, the stack of open sheets and
 * the menus; the grid, the list and the tabs below it do the drawing. Everything reads the persisted store, so the
 * page opens with data and no spinner, and refreshes in the background with ?rev.
 * 维护者：T3，课表网页核心。/timetable/*（timetable-final.md 第 9-12 节），在 AppShell 之外按需加载：/timetable 为周课表（课表），
 * /timetable/due 为作业标签（作业），各自是独立的路由，因此返回和深层链接（?date=…&focus=tm_…、?focus=ta_…、?add=course）都能使用。页面保存当前显示的周、
 * 已打开面板的堆栈和菜单；绘制由下面的课表、列表和标签完成。所有内容都读取已保存的 store，因此页面打开时就有数据、没有加载动画，
 * 并在后台带 ?rev 刷新。
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';
import {
  addDays,
  mondayOf,
  shortCode,
  skipKey,
  type TimetableAssignment,
  type TimetableCourse,
  type TimetableMeeting,
} from '@utmmsc/shared';
import { useLocaleStore } from '../../../shared/i18n/locale';
import { ActionSheet, type ActionSheetOption } from '../../../shared/ui/ActionSheet';
import { useConfirm } from '../../../shared/ui/confirm';
import { toast } from '../../../shared/ui/toast';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { AssignmentsTab } from '../due/AssignmentsTab';
import { dueDates, visibleWeekdays } from '../grid/layout';
import { ListView } from '../grid/ListView';
import '../grid/timetable.css';
import type { WeekStep, WeekSwipeHandle } from '../grid/useWeekSwipe';
import { WeekView } from '../grid/WeekView';
import { newTimetableId } from '../model/ids';
import { weekTitle } from '../model/labels';
import { useTorontoToday } from '../model/useTorontoNow';
import type { WeekOccurrence } from '../model/week';
import { thisDeviceDiffersFromToronto } from '../model/zone';
import { SettingsSheet } from '../settings/SettingsSheet';
import { AssignmentEditor } from '../sheets/AssignmentEditor';
import { draftFromAssignment, newAssignmentDraft, type AssignmentDraft } from '../sheets/assignmentDraft';
import { CopyDaysSheet } from '../sheets/CopyDaysSheet';
import { CourseCard, type CourseCardTarget } from '../sheets/CourseCard';
import { CourseEditor, newRowKey } from '../sheets/CourseEditor';
import { DEFAULT_DURATION, draftFromCourse, newCourseDraft, type CourseDraft, type NewRowAt } from '../sheets/courseDraft';
import { HolidaysSheet } from '../sheets/HolidaysSheet';
import { TermsSheet } from '../sheets/TermsSheet';
import { deleteCourse, refresh, setSkip, useTimetableView } from '../state/timetableStore';
import { readLastDuration, setViewMode, useViewMode } from '../ui/prefs';
import { COMPACT_QUERY, useMediaQuery } from '../ui/useMedia';
import { DueBadge, SyncBanner, TimetableChrome, type TimetableTab } from './TimetableChrome';
import { defaultSlot, initialMonday, linkedForm, readDeepLink, tabOfPath } from './pageModel';

const ImportSheet = lazy(() => import('../ics/ImportSheet'));

type Sheet =
  | { kind: 'course'; draft: CourseDraft; slot: NewRowAt | null }
  | { kind: 'card'; target: CourseCardTarget }
  | { kind: 'copy'; meetingId: string }
  | { kind: 'assignment'; draft: AssignmentDraft }
  | { kind: 'settings' }
  | { kind: 'terms' }
  | { kind: 'holidays' }
  | { kind: 'import' };

interface StackItem {
  id: number;
  sheet: Sheet;
}

interface Menu {
  title?: string;
  options: ActionSheetOption[];
}

/** How long a deep-linked block or row flashes. */
/** 深层链接指向的方块或行闪烁的时长。 */
const FLASH_MS = 2600;

function canGoBack(location: Location): boolean {
  if (location.key === 'default') return false;
  const index = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof index !== 'number' || index > 0;
}

function findMeeting(courses: readonly TimetableCourse[], meetingId: string): { course: TimetableCourse; meeting: TimetableMeeting } | null {
  for (const course of courses) {
    const meeting = course.meetings.find((m) => m.id === meetingId);
    if (meeting) return { course, meeting };
  }
  return null;
}

let stackSeq = 0;

export default function TimetablePage() {
  const locale = useLocaleStore((s) => s.locale);
  const en = locale === 'en';
  const tr = useCallback((zh: string, enText: string) => (en ? enText : zh), [en]);
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const tab = tabOfPath(location.pathname);
  const view = useTimetableView();
  const today = useTorontoToday();
  const compact = useMediaQuery(COMPACT_QUERY);
  const mode = useViewMode();
  const [monday, setMonday] = useState(() => initialMonday(location.search, today));
  const [stack, setStack] = useState<StackItem[]>([]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [flashBlock, setFlashBlock] = useState<string | null>(null);
  const [flashAssignment, setFlashAssignment] = useState<string | null>(null);
  const [zoneNote] = useState(() => thisDeviceDiffersFromToronto());
  const swipe = useRef<WeekSwipeHandle>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  useStatusBarColor('#FFFFFF');

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (!flashBlock && !flashAssignment) return;
    const timer = setTimeout(() => {
      setFlashBlock(null);
      setFlashAssignment(null);
    }, FLASH_MS);
    return () => clearTimeout(timer);
  }, [flashBlock, flashAssignment]);

  /* Sheets */
  /* 面板 */

  const push = useCallback((sheet: Sheet) => {
    stackSeq += 1;
    const id = stackSeq;
    setStack((current) => [...current, { id, sheet }]);
  }, []);

  const replace = useCallback((id: number, sheet: Sheet) => {
    stackSeq += 1;
    const next = stackSeq;
    setStack((current) => current.map((item) => (item.id === id ? { id: next, sheet } : item)));
  }, []);

  const close = useCallback((id: number) => setStack((current) => current.filter((item) => item.id !== id)), []);

  const openNewCourse = useCallback(
    (date: string, at: NewRowAt) => {
      const current = viewRef.current;
      const draft = newCourseDraft({ id: newTimetableId('tc'), courses: current.courses, terms: current.terms, date, at, durationMin: readLastDuration() ?? DEFAULT_DURATION, rowKey: newRowKey() });
      push({ kind: 'course', draft, slot: at });
    },
    [push],
  );

  const openNewAssignment = useCallback(
    (courseId: string | null) => {
      push({ kind: 'assignment', draft: newAssignmentDraft({ id: newTimetableId('ta'), nowMs: Date.now(), offsets: viewRef.current.settings.assignmentOffsets, courseId }) });
    },
    [push],
  );

  const openAssignment = useCallback((assignment: TimetableAssignment) => push({ kind: 'assignment', draft: draftFromAssignment(assignment) }), [push]);

  // A deep link (a tapped reminder) opens its week and flashes its block or row, ?add= opens the 添加课程 or 添加作业
  // form, then the address is left plain. Each history entry's link is read once, so StrictMode's second run of this
  // effect does not open a second form.
  // 深层链接（被点开的提醒）会打开对应的周并让方块或行闪烁，?add= 会打开「添加课程」或「添加作业」表单，之后把地址恢复为不带参数。
  // 每条历史记录的链接只读取一次，因此 StrictMode 第二次运行这个副作用时不会再打开一个表单。
  const linkRead = useRef<string | null>(null);
  useEffect(() => {
    const link = readDeepLink(location.search);
    if (!link || linkRead.current === location.key) return;
    linkRead.current = location.key;
    if (link.monday) setMonday(link.monday);
    if (link.block) setFlashBlock(`${link.block.meetingId}|${link.block.date}`);
    if (link.assignmentId) setFlashAssignment(link.assignmentId);
    const form = linkedForm(link, today, monday, Date.now());
    if (form?.kind === 'course') openNewCourse(form.date, form.at);
    else if (form?.kind === 'assignment') openNewAssignment(null);
    navigate({ pathname: location.pathname, search: '' }, { replace: true });
  }, [location.key, location.search, location.pathname, navigate, today, monday, openNewCourse, openNewAssignment]);

  /** From the course card the editor takes the card's place; from the long-press menu it opens on top. */
  /** 从课程卡片打开时，编辑表单取代卡片；从长按菜单打开时，叠在上面。 */
  const editCourse = useCallback(
    (course: TimetableCourse, from?: number) => {
      const sheet: Sheet = { kind: 'course', draft: draftFromCourse(course, newRowKey), slot: null };
      if (from !== undefined) replace(from, sheet);
      else push(sheet);
    },
    [push, replace],
  );

  const toggleSkip = useCallback(
    (course: TimetableCourse, meeting: TimetableMeeting, date: string, skipped: boolean) => {
      setSkip({ onDate: date, meetingId: meeting.id, skipped });
      toast(skipped ? tr(`${shortCode(course.code)} 本次不上`, `${shortCode(course.code)} skipped this time`) : tr('已恢复上课', 'Class restored'));
    },
    [tr],
  );

  const removeCourse = useCallback(
    async (course: TimetableCourse) => {
      const ok = await confirm({
        title: tr(`删除 ${shortCode(course.code)}？`, `Delete ${shortCode(course.code)}?`),
        body: tr('所有上课时间都会删除，这门课的作业会保留。', 'Every class time is deleted; its assignments are kept.'),
        confirmLabel: tr('删除', 'Delete'),
        danger: true,
      });
      if (ok) deleteCourse(course.id);
    },
    [confirm, tr],
  );

  /* Grid */
  /* 课表 */

  const gridData = useMemo(() => ({ terms: view.terms, courses: view.courses, skips: view.skips }), [view.terms, view.courses, view.skips]);
  const weekdays = useMemo(() => visibleWeekdays(view.courses, view.settings.showWeekend), [view.courses, view.settings.showWeekend]);
  const due = useMemo(() => dueDates(view.assignments), [view.assignments]);
  const heading = weekTitle(view.terms, monday, locale);
  const title = heading.text;
  let hint: string | null = null;
  if (view.courses.length === 0) hint = tr('点按空白处添加课程，或在 ⋯ 中导入日历文件', 'Tap an empty slot to add a class, or import a calendar file from ⋯');
  else if (heading.readingWeek) hint = tr('阅读周 · 不上课', 'Reading week · no classes');

  const onStep = useCallback((step: WeekStep) => setMonday((current) => addDays(current, step === 'next' ? 7 : -7)), []);
  const onSlot = useCallback((date: string, weekday: NewRowAt['weekday'], startMin: number) => openNewCourse(date, { weekday, startMin }), [openNewCourse]);
  const onOpen = useCallback((occurrence: WeekOccurrence) => push({ kind: 'card', target: { meetingId: occurrence.meeting.id, date: occurrence.date } }), [push]);
  const onMenu = useCallback(
    (occurrence: WeekOccurrence) => {
      const { course, meeting, date } = occurrence;
      const single = viewRef.current.skips.some((skip) => skip.onDate === date && skip.meetingId === meeting.id);
      const holiday = !single && viewRef.current.skips.some((skip) => skipKey(skip.onDate, skip.meetingId) === skipKey(date, null));
      const options: ActionSheetOption[] = [{ label: tr('编辑', 'Edit'), onSelect: () => editCourse(course) }];
      if (!holiday) options.push({ label: single ? tr('恢复上课', 'Restore this class') : tr('本次不上', 'Skip this class'), onSelect: () => toggleSkip(course, meeting, date, !single) });
      options.push({ label: tr('复制到其他天', 'Copy to other days'), onSelect: () => push({ kind: 'copy', meetingId: meeting.id }) });
      options.push({ label: tr('删除', 'Delete'), danger: true, onSelect: () => void removeCourse(course) });
      setMenu({ title: shortCode(course.code), options });
    },
    [editCourse, push, removeCourse, toggleSkip, tr],
  );

  const thisMonday = mondayOf(today);
  const nav =
    tab === 'week'
      ? {
          showToday: monday !== thisMonday,
          onPrev: () => (mode === 'grid' && swipe.current ? swipe.current.go('prev') : setMonday((current) => addDays(current, -7))),
          onNext: () => (mode === 'grid' && swipe.current ? swipe.current.go('next') : setMonday((current) => addDays(current, 7))),
          onToday: () => setMonday(thisMonday),
        }
      : null;

  /* Header */
  /* 标题栏 */

  function goBack() {
    if (canGoBack(location)) navigate(-1);
    else navigate('/', { replace: true });
  }

  function switchTab(next: TimetableTab) {
    if (next === tab) return;
    navigate(next === 'due' ? '/timetable/due' : '/timetable', { replace: true });
  }

  function add() {
    if (tab === 'due') {
      openNewAssignment(null);
      return;
    }
    const slot = defaultSlot(today, monday, Date.now());
    openNewCourse(slot.date, slot.at);
  }

  async function exportNow() {
    try {
      const { exportTimetable } = await import('../ics/export');
      const result = await exportTimetable(viewRef.current);
      if (result === 'saved') toast(tr('已导出', 'Exported'));
    } catch {
      toast(tr('导出失败，请稍后再试', 'The export failed. Try again in a moment.'));
    }
  }

  function more() {
    setMenu({
      options: [
        { label: tr('设置', 'Settings'), onSelect: () => push({ kind: 'settings' }) },
        { label: tr('学期', 'Terms'), onSelect: () => push({ kind: 'terms' }) },
        { label: tr('假日', 'Holidays'), onSelect: () => push({ kind: 'holidays' }) },
        { label: tr('导入日历文件', 'Import a calendar file'), onSelect: () => push({ kind: 'import' }) },
        { label: tr('导出课表', 'Export timetable'), onSelect: () => void exportNow() },
        mode === 'grid'
          ? { label: tr('列表视图', 'List view'), onSelect: () => setViewMode('list') }
          : { label: tr('课表视图', 'Grid view'), onSelect: () => setViewMode('grid') },
      ],
    });
  }

  /* Sheets */
  /* 面板 */

  function renderSheet(item: StackItem) {
    const { id, sheet } = item;
    const onClose = () => close(id);
    switch (sheet.kind) {
      case 'course':
        return <CourseEditor key={id} initial={sheet.draft} view={view} locale={locale} slot={sheet.slot} lastDuration={readLastDuration()} onClose={onClose} />;
      case 'card':
        return (
          <CourseCard
            key={id}
            target={sheet.target}
            view={view}
            locale={locale}
            onClose={onClose}
            onEdit={(course) => editCourse(course, id)}
            onToggleSkip={toggleSkip}
            onCopy={(_course, meeting) => push({ kind: 'copy', meetingId: meeting.id })}
            onDelete={(course) => void removeCourse(course)}
            onAddAssignment={(course) => openNewAssignment(course.id)}
            onOpenAssignment={openAssignment}
          />
        );
      case 'copy': {
        const found = findMeeting(view.courses, sheet.meetingId);
        return found ? <CopyDaysSheet key={id} course={found.course} meeting={found.meeting} locale={locale} onClose={onClose} /> : null;
      }
      case 'assignment':
        return <AssignmentEditor key={id} initial={sheet.draft} view={view} locale={locale} onClose={onClose} />;
      case 'settings':
        return (
          <SettingsSheet
            key={id}
            view={view}
            locale={locale}
            onClose={onClose}
            onOpenTerms={() => push({ kind: 'terms' })}
            onOpenHolidays={() => push({ kind: 'holidays' })}
            onImport={() => push({ kind: 'import' })}
            onExport={() => void exportNow()}
          />
        );
      case 'terms':
        return <TermsSheet key={id} view={view} locale={locale} onClose={onClose} />;
      case 'holidays':
        return <HolidaysSheet key={id} view={view} locale={locale} onClose={onClose} />;
      case 'import':
        return (
          <Suspense key={id} fallback={null}>
            <ImportSheet onClose={onClose} />
          </Suspense>
        );
    }
  }

  return (
    <div
      className={`tt-page flex flex-col overflow-hidden ${tab === 'week' && mode === 'grid' ? 'bg-white lg:bg-wx-canvas' : 'bg-wx-canvas'}`}
      style={{ paddingTop: 'var(--safe-top)', paddingBottom: 'var(--safe-bottom)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
    >
      <div className={`mx-auto flex min-h-0 w-full max-w-[64rem] flex-1 flex-col ${tab === 'week' && mode === 'grid' ? 'bg-white' : ''}`}>
        <TimetableChrome
          tab={tab}
          compact={compact}
          locale={locale}
          title={title}
          zoneNote={zoneNote}
          pickerDate={monday === thisMonday ? today : monday}
          badge={<DueBadge assignments={view.assignments} locale={locale} />}
          nav={nav}
          onBack={goBack}
          onPickDate={(date) => setMonday(mondayOf(date))}
          onAdd={add}
          onMore={more}
          onTab={switchTab}
        />
        {tab === 'week' ? (
          mode === 'grid' ? (
            <WeekView
              ref={swipe}
              monday={monday}
              data={gridData}
              weekdays={weekdays}
              today={today}
              dueDates={due}
              locale={locale}
              pendingIds={view.pendingIds}
              flashKey={flashBlock}
              hint={hint}
              onStep={onStep}
              onSlot={onSlot}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          ) : (
            <ListView monday={monday} data={gridData} weekdays={weekdays} today={today} locale={locale} pendingIds={view.pendingIds} flashKey={flashBlock} onOpen={onOpen} />
          )
        ) : (
          <AssignmentsTab view={view} locale={locale} flashId={flashAssignment} onAdd={() => openNewAssignment(null)} onOpen={openAssignment} />
        )}
      </div>
      <SyncBanner locale={locale} />
      {stack.map(renderSheet)}
      {menu ? <ActionSheet title={menu.title} options={menu.options} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}

