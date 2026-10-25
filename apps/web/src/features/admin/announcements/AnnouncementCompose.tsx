import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { errorMessage } from '../../../shared/api/errors';
import { useLabels } from '../../../shared/i18n/locale';
import { Button } from '../../../shared/ui/Button';
import { toast } from '../../../shared/ui/toast';
import { Switch } from '../../chat/info/Switch';
import { adminApi } from '../api';
import { Counter } from '../channels/channelParts';
import { AdminScreen, useAdminBack } from '../layout/AdminScreen';
import { useInsetGroups } from '../layout/media';
import { useScreenGuard } from '../layout/screenGuard';
import { refreshAdminSummary, useAdminCounts } from '../state/summaryStore';
import { AdminGroup } from '../ui/AdminCell';
import { StickyActionBar } from '../ui/StickyActionBar';
import {
  clearAnnouncementDraft,
  emptyAnnouncementDraft,
  invalidateAnnouncements,
  keepAnnouncementDraft,
  readAnnouncementDraft,
  type AnnouncementDraft,
} from './announcementData';
import {
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
  announcementsPath,
  canSendAnnouncement,
  emailSwitchLabel,
  previewLines,
  sendMayHaveGoneOut,
  sendTitle,
  sentToast,
  uncertainSendText,
} from './announcementRules';
import { SendPreviewSheet } from './SendPreviewSheet';

/**
 * 发布公告, /admin/announcements/new: a title (80) and a message (5000), and whether to email every active member, on
 * by default because email is the only way members see an announcement today; the footer says what happens without
 * it. With email, 预览并发送 shows the count, the title and the first lines before anything goes out. The text is
 * kept while the admin looks elsewhere.
 * 「发布公告」，/admin/announcements/new：标题（80）和正文（5000），以及是否发邮件给全体在用成员。默认发送，因为目前邮件是成员能看到公告的
 * 唯一途径；底部说明不发邮件会怎样。发邮件时，「预览并发送」在发出之前显示人数、标题和正文开头。管理员查看别处时文字会保留。
 */
export function AnnouncementCompose() {
  const { tr } = useLabels();
  const goBack = useAdminBack();
  const insetGroups = useInsetGroups();
  const counts = useAdminCounts();
  const recipients = counts?.announcementRecipients;
  const [draft, setDraft] = useState<AnnouncementDraft>(readAnnouncementDraft);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  // `unsure`: the send failed in a way that does not say whether it went out, so the alert points at the history.
  // `unsure`：发送失败的方式说明不了是否已经发出，因此提示指向公告记录。
  const [problem, setProblem] = useState<{ text: string; unsure: boolean } | null>(null);
  const sent = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const beginAction = useScreenGuard();
  const titleId = useId();
  const titleCounterId = useId();
  const bodyId = useId();
  const bodyCounterId = useId();
  const switchId = useId();
  const list = announcementsPath();
  const back = { to: list, label: tr('公告', 'Announcements') };
  const ready = canSendAnnouncement(draft.title, draft.body);

  useEffect(() => {
    if (!sent.current) keepAnnouncementDraft(draft);
  }, [draft]);

  function change(patch: Partial<AnnouncementDraft>) {
    setProblem(null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function send() {
    // The preview sheet closes first, so its history entry is gone before the screen goes back.
    // 先关闭预览层，在界面返回之前它的历史记录已被移除。
    setPreviewing(false);
    setBusy(true);
    setProblem(null);
    const stillHere = beginAction();
    const sendEmail = draft.sendEmail;
    try {
      const res = await adminApi.announce({ title: draft.title.trim(), body: draft.body.trim(), sendEmail });
      sent.current = true;
      clearAnnouncementDraft();
      invalidateAnnouncements();
      refreshAdminSummary();
      const done = sentToast(res);
      toast(tr(done.zh, done.en));
      // An admin who already went back or opened another screen stays where they are. A screen still mounted on a
      // newer entry (发布 tapped again) starts an empty draft, so the sent text is not sent twice.
      // 管理员已经返回或打开了别的界面时，留在原处。界面仍挂载在更新的记录上时（又点了「发布」），改为空白草稿，
      // 已发出的内容就不会被发两次。
      if (stillHere()) {
        goBack(list);
      } else {
        sent.current = false;
        setDraft(emptyAnnouncementDraft());
        setBusy(false);
      }
    } catch (err) {
      // A failure does not prove nothing went out, so the history and the counts load again either way. When the
      // answer does not say (no answer, or a 5xx), the screen says to check the history before sending again.
      // 失败并不能证明什么都没发出，因此无论如何都重新加载记录和计数。答复说明不了时（没有答复或 5xx），界面提示先查看记录再重发。
      invalidateAnnouncements();
      refreshAdminSummary();
      if (sendMayHaveGoneOut(err)) {
        const unsure = uncertainSendText(sendEmail);
        setProblem({ text: tr(unsure.zh, unsure.en), unsure: true });
      } else {
        setProblem({ text: errorMessage(err), unsure: false });
      }
      setBusy(false);
    }
  }

  function review() {
    if (!ready || busy) return;
    if (draft.sendEmail) setPreviewing(true);
    else void send();
  }

  // The fields are not a form, so Enter in the title never sends or saves; it moves on to the message, as the
  // keyboard's 下一项 says. The Enter that commits an IME candidate is left alone (Safari reports keyCode 229).
  // 这些输入框不在表单里，所以在标题里按回车不会发送或保存，而是像键盘上的「下一项」那样移到正文。确认输入法候选词的回车不做处理
  // （Safari 报告 keyCode 229）。
  function titleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    bodyRef.current?.focus();
  }

  const heading = sendTitle(recipients);
  const switchLabel = emailSwitchLabel(recipients);
  return (
    <AdminScreen
      title={tr('发布公告', 'New announcement')}
      back={back}
      escapeTo={list}
      footer={
        <StickyActionBar>
          <Button onClick={() => review()} loading={busy} disabled={!ready}>
            {draft.sendEmail ? tr('预览并发送', 'Review and send') : tr('保存公告', 'Save announcement')}
          </Button>
        </StickyActionBar>
      }
    >
      <div>
        <AdminGroup title={<label htmlFor={titleId}>{tr('标题', 'Title')}</label>}>
          <div className="flex items-center gap-3 px-4 py-2">
            <input
              id={titleId}
              value={draft.title}
              onChange={(event) => change({ title: event.target.value })}
              onKeyDown={titleKeyDown}
              maxLength={ANNOUNCEMENT_TITLE_MAX}
              autoComplete="off"
              enterKeyHint="next"
              aria-describedby={titleCounterId}
              className="min-w-0 flex-1 bg-transparent py-2 text-[17px] text-wx-ink outline-none"
            />
            <Counter id={titleCounterId} value={draft.title} max={ANNOUNCEMENT_TITLE_MAX} />
          </div>
        </AdminGroup>

        <AdminGroup title={<label htmlFor={bodyId}>{tr('正文', 'Message')}</label>}>
          <div className="px-4 py-2">
            <textarea
              ref={bodyRef}
              id={bodyId}
              value={draft.body}
              onChange={(event) => change({ body: event.target.value })}
              maxLength={ANNOUNCEMENT_BODY_MAX}
              rows={8}
              aria-describedby={bodyCounterId}
              className="block min-h-[12rem] w-full resize-y bg-transparent py-1.5 text-[16px] leading-6 text-wx-ink outline-none"
            />
            <div className="flex justify-end pb-1">
              <Counter id={bodyCounterId} value={draft.body} max={ANNOUNCEMENT_BODY_MAX} />
            </div>
          </div>
        </AdminGroup>

        <AdminGroup
          footer={tr(
            '不发邮件时，公告只保存在这里，成员看不到。想让大家在聊天里看到，请在「公告」频道发消息。',
            "Without email, the announcement is only saved here and members won't see it. To reach people in chat, post in the Announcements channel.",
          )}
        >
          <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
            <span id={switchId} className="min-w-0 flex-1 text-[17px] leading-6 text-wx-ink">
              {tr(switchLabel.zh, switchLabel.en)}
            </span>
            <Switch checked={draft.sendEmail} labelledBy={switchId} onChange={(sendEmail) => change({ sendEmail })} />
          </div>
        </AdminGroup>

        {problem ? (
          <div role="alert" className={`mt-3 rounded-lg bg-red-50 py-2 text-[14px] text-red-800 ${insetGroups ? 'px-3' : 'mx-4 px-3'}`}>
            <p>{problem.text}</p>
            {problem.unsure ? (
              <button type="button" onClick={() => goBack(list)} className="-mb-1 inline-flex min-h-11 items-center font-medium text-red-900 underline underline-offset-2">
                {tr('查看公告记录', 'View history')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {previewing ? (
        <SendPreviewSheet
          heading={tr(heading.zh, heading.en)}
          title={draft.title.trim()}
          lines={previewLines(draft.body)}
          onSend={() => void send()}
          onCancel={() => setPreviewing(false)}
        />
      ) : null}
    </AdminScreen>
  );
}
