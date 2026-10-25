import { Link } from 'react-router-dom';
import { formatRelative } from '../../../shared/format/time';
import { useLabels } from '../../../shared/i18n/locale';
import { AdminScreen } from '../layout/AdminScreen';
import { AdminField, AdminGroup } from '../ui/AdminCell';
import { EmptyBlock, LoadFailed } from '../ui/Feedback';
import { formatDayTime } from '../ui/labels';
import { ListSkeleton } from '../ui/ListSkeleton';
import { useAnnouncements } from './announcementData';
import { announcementsPath, deliveryText } from './announcementRules';

/**
 * One sent announcement, /admin/announcements/:id, read-only: the title and message as sent, when and by whom, and
 * whether it was emailed. It comes from the pages of history already loaded.
 * 单条已发公告，/admin/announcements/:id，只读：发出的标题和正文、时间和发送人，以及是否发了邮件。数据取自已加载的记录分页。
 */
export function AnnouncementDetail({ id }: { id: string }) {
  const { tr, locale } = useLabels();
  const history = useAnnouncements();
  const list = announcementsPath();
  const back = { to: list, label: tr('公告', 'Announcements') };
  const row = history.data?.announcements.find((item) => item.id === id);

  if (!row) {
    return (
      <AdminScreen title={tr('公告', 'Announcement')} back={back} escapeTo={list}>
        {!history.data ? (
          history.error ? (
            <LoadFailed error={history.error} onRetry={() => void history.refresh()} />
          ) : (
            <ListSkeleton rows={4} />
          )
        ) : (
          <EmptyBlock
            title={tr('找不到这条公告', "This announcement couldn't be found")}
            hint={tr('它可能在更早的记录里，回到列表加载更多后再打开。', 'It may be further back. Load more in the list, then open it from there.')}
            action={
              <Link to={list} replace className="inline-flex min-h-11 items-center rounded-lg px-3 text-[15px] font-medium text-brand-800 active:bg-stone-100">
                {tr('返回公告', 'Back to announcements')}
              </Link>
            }
          />
        )}
      </AdminScreen>
    );
  }

  const delivery = deliveryText(row);
  return (
    <AdminScreen title={tr('公告', 'Announcement')} back={back} escapeTo={list}>
      <AdminGroup>
        <div className="px-4 py-4">
          <p className="break-words text-[20px] font-semibold leading-7 text-wx-ink">{row.title}</p>
          <p className="mt-0.5 text-[14px] text-wx-meta">{formatRelative(row.sentAt)}</p>
        </div>
      </AdminGroup>
      <AdminGroup title={tr('正文', 'Message')}>
        <p className="whitespace-pre-wrap break-words px-4 py-3.5 text-[16px] leading-7 text-wx-ink">{row.body}</p>
      </AdminGroup>
      <AdminGroup>
        <AdminField label={tr('发送时间', 'Sent')}>{formatDayTime(row.sentAt, locale)}</AdminField>
        <AdminField label={tr('发送人', 'Sent by')}>{row.sentBy?.displayName ?? tr('已删除的成员', 'A removed member')}</AdminField>
        <AdminField label={tr('邮件', 'Email')}>{tr(delivery.zh, delivery.en)}</AdminField>
      </AdminGroup>
    </AdminScreen>
  );
}
