/**
 * Owner: T3, timetable web core. The bars above the grid: the 48 px header (首页, the week title that opens a date
 * picker, + and ⋯) and the 40 px row with the 课表 | 作业 tabs and ‹ 今天 › at the right. In a short landscape window
 * both share one 48 px bar. Also the 作业 badge and the offline banner, each with its own state so the page above
 * never re-renders for them.
 * 维护者：T3，课表网页核心。课表上方的栏：48 px 的标题栏（首页、可打开日期选择的周标题、+ 和 ⋯），以及 40 px 的「课表 | 作业」标签行，右侧为
 * ‹ 今天 ›。在较矮的横屏窗口中，两者合并为一条 48 px 的栏。另有「作业」数字和离线提示，各自保存状态，因此上层页面不会因它们重新渲染。
 */
import { memo, useEffect, useState, type ReactNode } from 'react';
import type { TimetableAssignment, TimetableLocale } from '@utmmsc/shared';
import { dueBadge } from '../due/sections';
import { useTorontoNow } from '../model/useTorontoNow';
import { useTimetableSync } from '../state/timetableStore';
import { ChevronLeftIcon, ChevronRightIcon, MoreIcon, PlusIcon } from '../ui/icons';

export type TimetableTab = 'week' | 'due';

/** Overdue items plus items due within 48 hours, on the 作业 tab. */
/** 「作业」标签上的数字：已逾期加上 48 小时内截止的数量。 */
export const DueBadge = memo(function DueBadge({ assignments, locale }: { assignments: readonly TimetableAssignment[]; locale: TimetableLocale }) {
  const now = useTorontoNow();
  const count = dueBadge(assignments, now);
  if (count === 0) return null;
  return (
    <span className="ml-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-wx-red px-1 text-[11px] font-semibold leading-none text-white">
      <span className="sr-only">{locale === 'en' ? `${count} need attention` : `${count} 项需要注意`}</span>
      <span aria-hidden>{count > 99 ? '99+' : count}</span>
    </span>
  );
});

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** 离线 · 修改会在联网后同步, floating above the bottom edge while offline or while writes wait for the network. */
/** 离线或写入在等待网络时，悬浮在底部上方的「离线 · 修改会在联网后同步」。 */
export function SyncBanner({ locale }: { locale: TimetableLocale }) {
  const online = useOnline();
  const { pending, stalled } = useTimetableSync();
  if (online && !(stalled && pending > 0)) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4" style={{ bottom: 'calc(var(--safe-bottom) + 0.75rem)' }}>
      <span className="rounded-full bg-wx-popover/90 px-3 py-1.5 text-[13px] text-white shadow">
        {locale === 'en' ? 'Offline · changes sync when you’re back online' : '离线 · 修改会在联网后同步'}
      </span>
    </div>
  );
}

export interface WeekNav {
  showToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

function WeekNavButtons({ nav, locale }: { nav: WeekNav; locale: TimetableLocale }) {
  const en = locale === 'en';
  return (
    <div className="ml-auto flex items-center">
      <button type="button" onClick={nav.onPrev} aria-label={en ? 'Previous week' : '上一周'} className="flex h-10 w-10 items-center justify-center rounded-lg text-wx-ink active:bg-wx-pressed">
        <ChevronLeftIcon />
      </button>
      {nav.showToday ? (
        <button type="button" onClick={nav.onToday} className="flex h-10 items-center px-1">
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[13px] font-medium text-brand-800 active:bg-brand-100">{en ? 'Today' : '今天'}</span>
        </button>
      ) : null}
      <button type="button" onClick={nav.onNext} aria-label={en ? 'Next week' : '下一周'} className="flex h-10 w-10 items-center justify-center rounded-lg text-wx-ink active:bg-wx-pressed">
        <ChevronRightIcon />
      </button>
    </div>
  );
}

function Tabs({ tab, onTab, badge, locale }: { tab: TimetableTab; onTab: (tab: TimetableTab) => void; badge: ReactNode; locale: TimetableLocale }) {
  const en = locale === 'en';
  const item = (key: TimetableTab, label: ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => onTab(key)}
      className={`relative flex h-10 min-w-[60px] items-center justify-center px-3 text-[15px] ${tab === key ? 'font-semibold text-wx-ink' : 'text-wx-meta'}`}
    >
      {label}
      {tab === key ? <span aria-hidden className="absolute inset-x-4 bottom-0 h-[2px] rounded-full bg-brand-800" /> : null}
    </button>
  );
  return (
    <div role="tablist" aria-label={en ? 'Timetable' : '课表'} className="flex items-center">
      {item('week', en ? 'Timetable' : '课表')}
      {item(
        'due',
        <>
          {en ? 'Assignments' : '作业'}
          {badge}
        </>,
      )}
    </div>
  );
}

export interface TimetableChromeProps {
  tab: TimetableTab;
  compact: boolean;
  locale: TimetableLocale;
  title: string;
  /** 按多伦多时间, when this device keeps another clock. */
  /** 这台设备使用其他时钟时显示「按多伦多时间」。 */
  zoneNote: boolean;
  /** The date the picker starts on. */
  /** 日期选择器的初始日期。 */
  pickerDate: string;
  badge: ReactNode;
  nav: WeekNav | null;
  onBack: () => void;
  onPickDate: (date: string) => void;
  onAdd: () => void;
  onMore: () => void;
  onTab: (tab: TimetableTab) => void;
}

export function TimetableChrome({ tab, compact, locale, title, zoneNote, pickerDate, badge, nav, onBack, onPickDate, onAdd, onMore, onTab }: TimetableChromeProps) {
  const en = locale === 'en';
  const back = (
    <button type="button" onClick={onBack} className="flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-2 text-[16px] font-medium text-brand-800 active:bg-stone-100" aria-label={en ? 'Back to Home' : '返回首页'}>
      <ChevronLeftIcon />
      {en ? 'Home' : '首页'}
    </button>
  );
  const heading =
    tab === 'week' ? (
      <label className="relative flex min-w-0 cursor-pointer flex-col items-center justify-center rounded-lg px-2 active:bg-stone-100">
        <span className="max-w-full truncate text-[17px] font-semibold leading-tight text-wx-ink">{title}</span>
        {zoneNote ? <span className="text-[10px] leading-tight text-wx-meta">{en ? 'Toronto time' : '按多伦多时间'}</span> : null}
        <input
          type="date"
          aria-label={en ? `${title}. Jump to a date` : `${title}，选择日期跳转`}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          value={pickerDate}
          onClick={(event) => {
            try {
              event.currentTarget.showPicker?.();
            } catch {
              // Some browsers refuse showPicker outside a direct tap; the input still opens on its own.
              // 部分浏览器不允许在非直接点按时调用 showPicker；输入框仍会自行打开。
            }
          }}
          onChange={(event) => {
            if (/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)) onPickDate(event.target.value);
          }}
        />
      </label>
    ) : (
      <h1 className="truncate text-[17px] font-semibold text-wx-ink">{en ? 'Assignments' : '作业'}</h1>
    );
  const actions = (
    <div className="flex shrink-0 items-center">
      <button type="button" onClick={onAdd} aria-label={tab === 'week' ? (en ? 'Add a course' : '添加课程') : en ? 'Add an assignment' : '添加作业'} className="flex h-11 w-11 items-center justify-center rounded-lg text-wx-ink active:bg-wx-pressed">
        <PlusIcon />
      </button>
      <button type="button" onClick={onMore} aria-label={en ? 'More' : '更多'} className="flex h-11 w-11 items-center justify-center rounded-lg text-wx-ink active:bg-wx-pressed">
        <MoreIcon />
      </button>
    </div>
  );

  if (compact) {
    return (
      <header className="flex h-12 shrink-0 items-center gap-1 border-b-[0.5px] border-wx-line bg-white px-1">
        {back}
        <div className="flex min-w-0 shrink justify-center">{heading}</div>
        <Tabs tab={tab} onTab={onTab} badge={badge} locale={locale} />
        {nav ? <WeekNavButtons nav={nav} locale={locale} /> : <div className="ml-auto" />}
        {actions}
      </header>
    );
  }

  return (
    <>
      <header className="relative flex h-12 shrink-0 items-center bg-white px-1">
        {back}
        <div className="absolute inset-y-0 left-1/2 flex max-w-[50%] -translate-x-1/2 items-center">{heading}</div>
        <div className="ml-auto">{actions}</div>
      </header>
      <div className="flex h-10 shrink-0 items-center border-b-[0.5px] border-wx-line bg-white pl-1 pr-1">
        <Tabs tab={tab} onTab={onTab} badge={badge} locale={locale} />
        {nav ? <WeekNavButtons nav={nav} locale={locale} /> : null}
      </div>
    </>
  );
}
