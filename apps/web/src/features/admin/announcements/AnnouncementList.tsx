import { memo, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminAnnouncementRow } from '@utmmsc/shared';
import { formatRelative } from '../../../shared/format/time';
import { useLabels } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { AdminScreen, useSectionBack } from '../layout/AdminScreen';
import { useListKeyboard } from '../layout/listKeyboard';
import { useIsWide } from '../layout/media';
import { AdminCell, AdminGroup } from '../ui/AdminCell';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { ListSkeleton } from '../ui/ListSkeleton';
import { loadMoreAnnouncements, useAnnouncements } from './announcementData';
import { announcementMeta, announcementsPath, newAnnouncementPath } from './announcementRules';

const HEADER_ACTION = 'inline-flex min-h-11 items-center rounded-lg px-2.5 text-[16px] font-medium text-brand-800 active:bg-stone-100';
const PRIMARY_LINK = 'inline-flex min-h-11 items-center rounded-lg border-t-[3px] border-gold bg-brand-800 px-4 text-[15px] font-medium text-white';

type More = 'idle' | 'loading' | 'failed';

const AnnouncementRow = memo(function AnnouncementRow({ row, to, replace, selected }: { row: AdminAnnouncementRow; to: string; replace: boolean; selected: boolean }) {
  const { tr } = useLabels();
  // formatRelative already speaks the site language, so it serves both halves of the phrase.
  // formatRelative 已经使用网站语言，因此同一个结果用于这句话的两种语言。
  const when = formatRelative(row.sentAt);
  const meta = announcementMeta(row, { zh: when, en: when });
  return (
    <AdminCell
      rowId={row.id}
      to={to}
      replace={replace}
      selected={selected}
      lazy
      label={row.title}
      detail={tr(meta.zh, meta.en)}
    />
  );
});

/**
 * 公告: what was sent, newest first, each with when, who and whether it was emailed, 20 at a time with more loading
 * as the end comes into view (a button as the fallback). 发布 opens the compose screen. A server without the history
 * route says so and still offers 发布公告.
 * 「公告」：已发出的公告，最新的在前，每条注明时间、发送人以及是否发了邮件；每次 20 条，列表末尾进入视野时加载更多（保留按钮作为后备）。
 * 「发布」打开撰写界面。服务器没有记录接口时会说明，并仍提供「发布公告」。
 */
export function AnnouncementList({ selectedId }: { selectedId: string | null }) {
  const { tr } = useLabels();
  const back = useSectionBack();
  const history = useAnnouncements();
  const listRef = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState<More>('idle');
  useListKeyboard(listRef);
  const swap = useIsWide() && selectedId !== null;

  const page = history.data;
  const cursor = page?.nextCursor ?? null;

  async function loadMore() {
    if (!cursor || more === 'loading') return;
    setMore('loading');
    try {
      await loadMoreAnnouncements(cursor);
      setMore('idle');
    } catch {
      setMore('failed');
    }
  }
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });

  // The next page loads as the end of the list comes near; a failure waits for the button.
  // 列表末尾接近时加载下一页；失败后等成员点按钮。
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !cursor || more !== 'idle' || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreRef.current();
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [cursor, more]);

  const compose = (
    <Link to={newAnnouncementPath()} className={PRIMARY_LINK}>
      {tr('发布公告', 'New announcement')}
    </Link>
  );
  const trailing = (
    <Link to={newAnnouncementPath()} replace={swap} className={HEADER_ACTION}>
      {tr('发布', 'New')}
    </Link>
  );

  let body;
  if (!page) {
    body = history.error ? <LoadFailed error={history.error} onRetry={() => void history.refresh()} /> : <ListSkeleton rows={4} />;
  } else if (page.unavailable) {
    body = <EmptyBlock title={tr('历史记录暂不可用', "History isn't available yet")} hint={tr('仍可以发布新的公告。', 'You can still send a new announcement.')} action={compose} />;
  } else if (page.announcements.length === 0) {
    body = (
      <EmptyBlock
        title={tr('还没有发过公告', 'No announcements yet')}
        hint={tr('公告会通过邮件发给全体在用成员。', 'Announcements are emailed to every active member.')}
        action={compose}
      />
    );
  } else {
    body = (
      <>
        {history.error ? <LoadFailed error={history.error} onRetry={() => void history.refresh()} /> : null}
        <AdminGroup>
          {page.announcements.map((row) => (
            <AnnouncementRow key={row.id} row={row} to={announcementsPath(row.id)} replace={swap} selected={row.id === selectedId} />
          ))}
        </AdminGroup>
      </>
    );
  }

  return (
    <AdminScreen title={tr('公告', 'Announcements')} back={back} top trailing={trailing}>
      <div ref={listRef}>{body}</div>
      {cursor ? (
        <div ref={sentinel} className="flex flex-col items-center gap-2 px-4 pt-4">
          {more === 'failed' ? <p className="text-[13px] text-red-700">{tr('加载失败，请重试', "Couldn't load. Try again.")}</p> : null}
          <Button variant="secondary" loading={more === 'loading'} onClick={() => void loadMore()}>
            {tr('加载更多', 'Load more')}
          </Button>
        </div>
      ) : null}
    </AdminScreen>
  );
}
