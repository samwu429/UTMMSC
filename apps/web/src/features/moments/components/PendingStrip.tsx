import type { MomentRemoval } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import type { LocalPostState } from '../model';

/** Upload progress over all media: a thin ring that fills clockwise from 12 o'clock. */
/** 全部媒体的上传进度：从十二点方向顺时针填满的细圆环。 */
function ProgressRing({ progress }: { progress: number }) {
  const radius = 6.5;
  const circumference = 2 * Math.PI * radius;
  const share = Math.min(1, Math.max(0, progress));
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 shrink-0 -rotate-90 text-wx-link" aria-hidden>
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - share)} />
    </svg>
  );
}

function FailedMark() {
  return (
    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-wx-red text-[11px] font-bold leading-none text-white" aria-hidden>
      !
    </span>
  );
}

export interface PendingStripProps {
  state: LocalPostState;
  /** 重试: failed uploads again, then the same clientId. */
  /** 「重试」：重新上传失败的文件，再以同一个 clientId 发表。 */
  onRetry: () => void;
  /** 删除: asks first, then drops the post and its uploads. */
  /** 「删除」：先确认，再移除这条动态及其上传。 */
  onDelete: () => void;
}

/**
 * The state of an own post this device is still publishing: a ring while the media upload, 发送中… while the
 * post is sent, 等待网络 while offline, and 发送失败 with [重试] [删除].
 * 本设备仍在发表的自己的动态的状态：媒体上传时显示进度环，发送时显示「发送中…」，离线时显示「等待网络」，失败时显示「发送失败」及
 * [重试] [删除]。
 */
export function PendingStrip({ state, onRetry, onDelete }: PendingStripProps) {
  const tr = useTr();

  if (state.status === 'failed') {
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] leading-5">
        <span className="flex min-w-0 items-center gap-1.5 text-wx-red">
          <FailedMark />
          {tr('发送失败', 'Couldn’t send')}
        </span>
        {state.failure ? <span className="min-w-0 basis-full text-wx-meta [overflow-wrap:anywhere] sm:basis-auto">{state.failure}</span> : null}
        <span className="flex items-center gap-1">
          <button type="button" onClick={onRetry} className="-my-3 min-h-11 rounded-[4px] px-1.5 text-wx-link active:bg-wx-pressed">
            {tr('重试', 'Retry')}
          </button>
          <button type="button" onClick={onDelete} className="-my-3 min-h-11 rounded-[4px] px-1.5 text-wx-link active:bg-wx-pressed">
            {tr('删除', 'Delete')}
          </button>
        </span>
      </div>
    );
  }

  const percent = Math.round(Math.min(1, Math.max(0, state.progress)) * 100);
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[13px] leading-5 text-wx-meta">
      {state.status === 'uploading' ? (
        <>
          <ProgressRing progress={state.progress} />
          <span>{tr('发送中…', 'Sending…')}</span>
          <span className="tabular-nums" aria-hidden>
            {percent}%
          </span>
        </>
      ) : state.status === 'waiting' ? (
        <span>{tr('等待网络', 'Waiting for network')}</span>
      ) : (
        <>
          <WxSpinner size={16} label={tr('发送中…', 'Sending…')} />
          <span aria-hidden>{tr('发送中…', 'Sending…')}</span>
        </>
      )}
    </div>
  );
}

/**
 * Shown only to the author of a post a moderator removed: 「这条动态已被管理员移除：{reason}」. Only 删除 is left.
 * 只显示给被管理员移除的动态的作者：「这条动态已被管理员移除：{原因}」。只剩「删除」可用。
 */
export function RemovedStrip({ removal }: { removal: MomentRemoval }) {
  const tr = useTr();
  const reason = removal.reason?.trim();
  return (
    <p className="mt-2 rounded-[4px] bg-wx-bar px-2 py-1.5 text-[13px] leading-5 text-wx-meta [overflow-wrap:anywhere]">
      {tr('这条动态已被管理员移除', 'An admin removed this update')}
      {reason ? `${tr('：', ': ')}${reason}` : null}
    </p>
  );
}
