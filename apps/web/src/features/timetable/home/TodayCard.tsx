/**
 * Owner: T4, timetable home card. 今日课表 on the home page (timetable-final.md section 8): a white full-bleed section
 * under the Android app banner with a fixed minimum height, drawn on first paint from the persisted store (no
 * spinner) and refreshed in the background with ?rev. It shows the class now or next, the rest of today, the
 * assignment due first with a tick and an undo, and the class reminder state with one tap to turn it on. The import
 * sheet is a lazy chunk, so only this card, the store and the model join the main bundle.
 * 维护者：T4，课表首页卡片。首页上的「今日课表」（timetable-final.md 第 8 节）：安卓应用横幅下方的白色通栏区块，有固定的最小高度；
 * 首次绘制时就从保存的 store 显示（没有加载圈），再在后台用 ?rev 刷新。它显示正在上或下一节课、今天其余的课、最先截止的作业
 * （可勾选完成并撤销），以及上课提醒的状态，一点即可开启。导入表单是按需加载的代码块，所以只有这张卡片、store 和模型进入主包。
 */
import { Suspense, lazy, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { torontoDateOf } from '@utmmsc/shared';
import { useLocaleStore, useTr } from '../../../shared/i18n/locale';
import { toast } from '../../../shared/ui/toast';
import { enableNotifications, useNotificationStore, type EnableOutcome } from '../../notifications/notifications';
import { courseColor } from '../model/colors';
import { useTorontoNow } from '../model/useTorontoNow';
import { refresh, setAssignmentDone, updateSettings, useTimetable, useTimetableView } from '../state/timetableStore';
import { BellIcon, ChevronRightIcon, TickCircle } from '../ui/icons';
import { UndoBar, useTickGuard, useUndoOffer } from '../ui/UndoBar';
import { assignmentLink, assignmentRow, bellChip, canEnableHere, headerText, mainLine, nextReminderAt, type BellChip } from './todayModel';

const ImportSheet = lazy(() => import('../ics/ImportSheet'));

/** Where 手动添加 goes: the week view, which opens its 添加课程 sheet. */
/** 「手动添加」前往的地方：周课表，并打开其「添加课程」表单。 */
export const ADD_COURSE_PATH = '/timetable?add=course';

/**
 * How much higher the undo pill sits on Home. The tab bar is 66px tall above the safe area, and the raised 聊天 drop
 * right under the centred pill reaches about 27px above it, 93px in all; lifted by 5rem the pill starts at 100px.
 * 首页上「撤销」胶囊抬高的高度。标签栏在安全区之上高 66px，居中胶囊正下方浮起的「聊天」水滴又高出约 27px，共约 93px；
 * 抬高 5rem 后胶囊从 100px 处开始。
 */
export const TAB_BAR_LIFT = '5rem';

const SECTION = '-mx-4 mt-5 bg-white px-4 py-4';

function useOutcomeToast(): (outcome: EnableOutcome) => void {
  const tr = useTr();
  return (outcome) => {
    if (outcome === 'on') toast(tr('上课提醒已开启', 'Class reminders are on'));
    else if (outcome === 'denied') toast(tr('通知被拦截了，可以在「我的 → 设置 → 通知」里查看怎么打开', 'Notifications were blocked. See Me → Settings → Notifications for how to allow them.'), { ms: 3000 });
    else if (outcome === 'failed') toast(useNotificationStore.getState().error ?? tr('没能开启通知，请稍后再试', 'Notifications could not be turned on. Try again later.'), { ms: 2500 });
  };
}

function Bell({ chip, busy }: { chip: BellChip; busy: boolean }) {
  const tr = useTr();
  const report = useOutcomeToast();
  const pill = 'inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] leading-snug';

  function turnOn() {
    // On the web the permission request must be the very first thing the tap does, so it starts before the save.
    // 网页上请求权限必须是点击后的第一步，所以在保存设置之前开始。
    const { capability, device, serverReady } = useNotificationStore.getState();
    const pending = canEnableHere(capability, device, serverReady) ? enableNotifications() : null;
    updateSettings({ classReminders: true });
    if (pending) void pending.then(report);
    else toast(tr('上课提醒已开启', 'Class reminders are on'));
  }

  switch (chip.kind) {
    case 'master_off':
    case 'ios_install':
    case 'device_blocked':
      return (
        <Link to={chip.link} className="-my-1 inline-flex min-h-11 max-w-full items-center">
          <span className={`${pill} bg-stone-100 text-stone-700 active:bg-stone-200`}>
            <BellIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{chip.text}</span>
            <ChevronRightIcon className="-mr-1 h-4 w-4 shrink-0 text-stone-400" />
          </span>
        </Link>
      );
    case 'off':
    case 'enable_device':
      return (
        <button type="button" disabled={busy} onClick={chip.kind === 'off' ? turnOn : () => void enableNotifications().then(report)} className="-my-1 inline-flex min-h-11 max-w-full items-center disabled:opacity-60">
          <span className={`${pill} bg-brand-50 font-medium text-brand-800 active:bg-brand-100`}>
            <BellIcon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{chip.text}</span>
          </span>
        </button>
      );
    case 'on':
      return (
        <p className={`${pill} bg-stone-50 text-stone-600`}>
          <BellIcon className="h-4 w-4 shrink-0 text-brand-700" />
          <span className="min-w-0 truncate">{chip.text}</span>
        </p>
      );
  }
}

function TitleRow({ titleId, header }: { titleId: string; header: string }) {
  const tr = useTr();
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={titleId} className="text-[15px] font-medium text-brand-800">
        {tr('今日课表', "Today's classes")}
      </h2>
      <Link to="/timetable" className="-my-2.5 -mr-2 flex min-h-11 min-w-0 items-center rounded-lg pl-2 pr-1 text-[13px] active:bg-stone-100">
        <span className="truncate text-brand-700">{header}</span>
        <span className="ml-2.5 shrink-0 text-stone-500">{tr('全部', 'All')}</span>
        <ChevronRightIcon className="h-4 w-4 shrink-0 text-stone-400" />
      </Link>
    </div>
  );
}

function MaybeLink({ to, className, children }: { to: string | null; className: string; children: ReactNode }) {
  return to ? (
    <Link to={to} className={`${className} rounded-lg active:bg-stone-50`}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

export function TodayCard(): JSX.Element | null {
  const tr = useTr();
  const locale = useLocaleStore((state) => state.locale);
  const view = useTimetableView();
  const nowMs = useTorontoNow();
  const dismissedEmpty = useTimetable((state) => state.dismissedEmpty);
  const capability = useNotificationStore((state) => state.capability);
  const device = useNotificationStore((state) => state.device);
  const serverReady = useNotificationStore((state) => state.serverReady);
  const busy = useNotificationStore((state) => state.busy);
  const titleId = useId();
  const [importing, setImporting] = useState(false);
  const undo = useUndoOffer();
  const tickAllowed = useTickGuard();

  useEffect(() => {
    // The store throttles this and refreshes again on its own when the page comes back or goes online.
    // store 会限制频率，并在页面回到前台或恢复联网时自行刷新。
    void refresh();
  }, []);

  const { main, later } = useMemo(() => mainLine(view, nowMs, locale), [view, nowMs, locale]);
  const row = useMemo(() => assignmentRow(view.assignments, view.courses, nowMs, locale), [view.assignments, view.courses, nowMs, locale]);
  const nextSend = useMemo(() => nextReminderAt(view, view.settings, view.remindersAllowed, nowMs), [view, nowMs]);
  const today = torontoDateOf(nowMs);
  const header = useMemo(() => headerText(view.terms, today, locale), [view.terms, today, locale]);
  const chip = bellChip({ remindersAllowed: view.remindersAllowed, settings: view.settings, nextSendAtMs: nextSend, capability, device, serverReady, nowMs }, locale);

  function tick(id: string) {
    // The next assignment takes this one's place under the finger, so a second tap right after is ignored.
    // 下一项作业会立刻移到手指下方，所以紧接着的第二下点按会被忽略。
    if (!tickAllowed()) return;
    setAssignmentDone(id, true);
    undo.show(tr('已完成', 'Done'), () => setAssignmentDone(id, false));
  }

  const sheet = importing ? (
    <Suspense fallback={null}>
      <ImportSheet onClose={() => setImporting(false)} />
    </Suspense>
  ) : null;

  // Dismissed and nothing to show: one line that leads to 添加课程.
  // 已关闭空状态且没有内容可显示：只留一行，通往「添加课程」。
  if (main.kind === 'empty' && dismissedEmpty && !row) {
    return (
      <section aria-label={tr('课表', 'Timetable')} className="-mx-4 mt-5 bg-white">
        <Link to={ADD_COURSE_PATH} className="flex min-h-12 items-center gap-1 px-4 text-[15px] active:bg-stone-50">
          <span className="font-medium text-brand-800">{tr('课表', 'Timetable')}</span>
          <span className="text-stone-400"> · </span>
          <span className="min-w-0 flex-1 truncate text-stone-600">{tr('添加课程', 'Add a class')}</span>
          <ChevronRightIcon className="h-4 w-4 shrink-0 text-stone-400" />
        </Link>
        {sheet}
      </section>
    );
  }

  return (
    <section aria-labelledby={titleId} className={`${SECTION} min-h-[9.5rem]`}>
      <TitleRow titleId={titleId} header={header} />

      {main.kind === 'loading' ? (
        <div aria-busy="true" className="mt-4 space-y-2.5">
          <div className="h-4 w-2/3 rounded bg-stone-100 motion-safe:animate-pulse" />
          <div className="h-3 w-1/2 rounded bg-stone-100 motion-safe:animate-pulse" />
        </div>
      ) : null}

      {main.kind === 'empty' ? (
        dismissedEmpty ? (
          <Link to={ADD_COURSE_PATH} className="mt-2 flex min-h-11 items-center gap-1 text-[15px] text-stone-600">
            {tr('添加课程', 'Add a class')}
            <ChevronRightIcon className="h-4 w-4 text-stone-400" />
          </Link>
        ) : (
          <div className="mt-2">
            <p className="text-[15px] leading-snug text-wx-ink">{tr('添加课表，上课前提醒你', 'Add your timetable and get reminded before class')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Link to={ADD_COURSE_PATH} className="flex min-h-11 items-center rounded-lg bg-brand-800 px-4 text-[15px] font-medium text-white active:bg-brand-900">
                {tr('手动添加', 'Add a class')}
              </Link>
              <button type="button" onClick={() => setImporting(true)} className="min-h-11 rounded-lg bg-brand-50 px-4 text-[15px] font-medium text-brand-800 active:bg-brand-100">
                {tr('导入日历文件', 'Import a calendar file')}
              </button>
              <button type="button" onClick={() => useTimetable.getState().setDismissedEmpty(true)} className="min-h-11 rounded-lg px-3 text-[15px] text-stone-500 active:bg-stone-100">
                {tr('以后再说', 'Not now')}
              </button>
            </div>
          </div>
        )
      ) : null}

      {main.kind === 'in_class' ? (
        <Link to={main.link} className="-mx-2 mt-2 block rounded-lg px-2 py-1 active:bg-stone-50">
          <p className="text-[13px] font-medium text-brand-700">{main.label}</p>
          <p className="mt-0.5 truncate text-[17px] font-semibold text-wx-ink">{main.text}</p>
          <div
            role="progressbar"
            aria-label={tr('本节课进度', 'Class progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(main.progress * 100)}
            className="mt-2 h-1 overflow-hidden rounded-full bg-brand-50"
          >
            <div className="h-full rounded-full bg-brand-700" style={{ width: `${Math.round(main.progress * 1000) / 10}%` }} />
          </div>
        </Link>
      ) : null}

      {main.kind === 'next' ? (
        <Link to={main.link} className="-mx-2 mt-2 block rounded-lg px-2 py-1 active:bg-stone-50">
          <p className="text-[13px] text-stone-500">{main.label}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-[17px] font-semibold text-wx-ink">{main.text}</p>
            <span className="shrink-0 rounded-full bg-gold px-2.5 py-0.5 text-[12px] font-medium text-brand-900">{main.pill}</span>
          </div>
        </Link>
      ) : null}

      {main.kind === 'quiet' ? (
        <MaybeLink to={main.link} className="-mx-2 mt-2 block px-2 py-1.5">
          <p className="text-[15px] leading-snug text-wx-ink">{main.text}</p>
        </MaybeLink>
      ) : null}

      {later.length ? (
        <ul className="mt-2.5">
          {later.map((line) => (
            <li key={line.key}>
              <Link to={line.link} className="-mx-2 -my-1.5 flex min-h-11 items-center rounded-lg px-2 text-[14px] text-stone-600 active:bg-stone-50">
                <span className="truncate">{line.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {row ? (
        <div className="mt-3 border-t border-stone-100 pt-3">
          <div className="flex flex-wrap items-center gap-x-2 text-[13px]">
            <Link to="/timetable/due" className="-my-2.5 flex min-h-11 items-center font-medium text-brand-800">
              {tr('作业', 'Assignments')}
            </Link>
            {row.overdueText ? <span className="font-medium text-wx-red">{row.overdueText}</span> : null}
            {row.overdueText && row.soonText ? <span className="text-stone-300">·</span> : null}
            {row.soonText ? <span className="text-stone-500">{row.soonText}</span> : null}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => tick(row.first.id)}
              aria-label={tr(`完成 ${row.first.title}`, `Mark ${row.first.title} done`)}
              className="-ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center text-stone-400 active:text-brand-700"
            >
              <TickCircle done={false} className="h-6 w-6" />
            </button>
            <Link to={assignmentLink(row.first.id)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg active:bg-stone-50">
              {row.first.course ? <span aria-hidden className="h-8 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: courseColor(row.first.course.color).ink }} /> : null}
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] text-wx-ink">{row.first.title}</span>
                  {view.pendingIds.has(row.first.id) ? <span role="img" aria-label={tr('待同步', 'Not synced')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold" /> : null}
                </span>
                <span className="block truncate text-[13px] text-stone-500">
                  {row.first.meta}
                  {' · '}
                  <span className={row.first.overdue ? 'text-wx-red' : ''}>{row.first.relative}</span>
                </span>
              </span>
            </Link>
          </div>
        </div>
      ) : null}

      {main.kind !== 'loading' && main.kind !== 'empty' ? (
        <div className="mt-2">
          <Bell chip={chip} busy={busy} />
        </div>
      ) : null}

      <UndoBar offer={undo.offer} onDismiss={undo.dismiss} lift={TAB_BAR_LIFT} />
      {sheet}
    </section>
  );
}
