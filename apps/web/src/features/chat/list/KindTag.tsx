import { useTr } from '../../../shared/i18n/locale';

/**
 * Small label after a conversation name, so a group chat and a direct message read apart at a glance.
 * 会话名称后的小标签，一眼分清群聊和私信。
 */
export function KindTag({ kind }: { kind: 'channel' | 'direct' }) {
  const tr = useTr();
  const tone = kind === 'channel' ? 'bg-brand-50 text-brand-700' : 'bg-wx-canvas text-wx-meta';
  return (
    <span className={`shrink-0 self-center rounded-[3px] px-1 text-[11px] font-normal leading-4 ${tone}`}>
      {kind === 'channel' ? tr('群聊', 'Group') : tr('私信', 'DM')}
    </span>
  );
}
