import { useId, useState } from 'react';
import { MOMENT_REPORT_NOTE_MAX, MOMENT_REPORT_REASONS, momentTextLength, type MomentReportReason } from '@utmmsc/shared';
import { ApiClientError, errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { toast } from '../../../shared/ui/toast';
import { momentsApi } from '../api';
import { useFeedStore } from '../state/feedStore';
import { limitCodePoints, momentReportReasonLabel, MomentSheet } from './PostMenus';

export interface ReportSheetProps {
  postId: string;
  /** Set to report one comment instead of the post. */
  /** 投诉某条评论而不是动态本身时设置。 */
  commentId?: string | null;
  onClose(): void;
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 text-wx-link" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * 投诉: 垃圾广告, 骚扰或攻击, 不当内容, 泄露隐私, 其他 with an optional note, then 已提交，管理员会尽快处理.
 * A repeated report also succeeds; a post that has gone in the meantime leaves the feed.
 * 投诉：垃圾广告、骚扰或攻击、不当内容、泄露隐私、其他，可附说明，提交后提示「已提交，管理员会尽快处理」。
 * 重复投诉同样算成功；期间已不存在的动态会从信息流中移除。
 */
export function ReportSheet({ postId, commentId = null, onClose }: ReportSheetProps) {
  const tr = useTr();
  const groupId = useId();
  const noteId = useId();
  const [reason, setReason] = useState<MomentReportReason | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteLength = momentTextLength(note.trim());

  async function submit() {
    if (!reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await momentsApi.report({ postId, commentId, reason, note: note.trim() || null });
      toast(tr('已提交，管理员会尽快处理', 'Thanks. An admin will review it.'));
      onClose();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiClientError && err.status === 404) {
        // The post or comment went away while the sheet was open; a post leaves every list.
        // 面板打开期间动态或评论已不存在；动态会从所有列表中移除。
        toast(errorMessage(err));
        if (err.code === 'moment_unavailable') useFeedStore.getState().dropPost(postId);
        onClose();
        return;
      }
      setError(errorMessage(err));
    }
  }

  return (
    <MomentSheet
      title={tr('投诉', 'Report')}
      onClose={onClose}
      footer={
        <>
          {error ? (
            <p className="mb-2 text-[13px] leading-5 text-wx-red" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!reason || busy}
            onClick={() => void submit()}
            className="flex min-h-11 w-full items-center justify-center rounded-lg border-t-[3px] border-gold bg-brand-800 text-[16px] font-medium text-white active:bg-brand-900 disabled:border-stone-300 disabled:bg-stone-300"
          >
            {busy ? <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden /> : null}
            {tr('提交', 'Submit')}
          </button>
        </>
      }
    >
      <p id={groupId} className="px-4 pb-2 pt-3 text-[13px] leading-5 text-wx-meta">
        {commentId ? tr('投诉这条评论的原因', 'Why are you reporting this comment?') : tr('投诉这条动态的原因', 'Why are you reporting this update?')}
      </p>
      <div role="radiogroup" aria-labelledby={groupId} className="bg-white">
        {MOMENT_REPORT_REASONS.map((value, index) => {
          const checked = reason === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => setReason(value)}
              className={`flex min-h-14 w-full items-center justify-between px-4 text-left text-[16px] text-wx-ink active:bg-wx-pressed ${index > 0 ? 'border-t-[0.5px] border-wx-line' : ''}`}
            >
              <span>{momentReportReasonLabel(value)}</span>
              {checked ? <CheckMark /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-2 bg-white px-4 py-3">
        <label htmlFor={noteId} className="sr-only">
          {tr('补充说明（选填）', 'Add a note (optional)')}
        </label>
        <textarea
          id={noteId}
          value={note}
          rows={3}
          placeholder={tr('补充说明（选填）', 'Add a note (optional)')}
          onChange={(event) => setNote(limitCodePoints(event.target.value, MOMENT_REPORT_NOTE_MAX))}
          className="block w-full resize-none bg-transparent text-[16px] leading-6 text-wx-ink outline-none placeholder:text-wx-meta"
        />
        <p className="mt-1 text-right text-[12px] leading-4 text-wx-meta" aria-hidden>
          {noteLength}/{MOMENT_REPORT_NOTE_MAX}
        </p>
      </div>
    </MomentSheet>
  );
}
