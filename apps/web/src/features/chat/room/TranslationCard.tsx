import { useCallback, useEffect, useRef, useState } from 'react';
import type { TranslateLang } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { useTr } from '../../../shared/i18n/locale';
import { WxSpinner } from '../../../shared/ui/WxSpinner';
import { chatApi } from '../api';
import { CloseIcon } from './messageIcons';

type CardState = { kind: 'loading' } | { kind: 'done'; text: string; source: TranslateLang; target: TranslateLang } | { kind: 'error'; message: string };

/**
 * Machine translation shown under a bubble. It starts translating when it mounts; a result that comes
 * back after the card was retried or closed is dropped.
 * 显示在气泡下方的机器翻译。挂载时即开始翻译；重试或关闭之后才返回的结果会被丢弃。
 */
export function TranslationCard({ text, own, onClose }: { text: string; own: boolean; onClose: () => void }) {
  const tr = useTr();
  const [state, setState] = useState<CardState>({ kind: 'loading' });
  const translateSeq = useRef(0);

  const run = useCallback(() => {
    const request = ++translateSeq.current;
    setState({ kind: 'loading' });
    chatApi.translate(text).then(
      (res) => {
        if (request === translateSeq.current) setState({ kind: 'done', text: res.text, source: res.sourceLang, target: res.targetLang });
      },
      (err: unknown) => {
        if (request === translateSeq.current) setState({ kind: 'error', message: errorMessage(err) });
      },
    );
  }, [text]);

  useEffect(() => {
    run();
    const seq = translateSeq;
    return () => {
      seq.current += 1;
    };
  }, [run]);

  const languageName = (lang: TranslateLang) => (lang === 'zh-CN' ? tr('中文', 'Chinese') : tr('英文', 'English'));
  const tone = own ? 'bg-wx-mine' : 'bg-wx-other';

  return (
    <div className={`mt-1 min-w-[120px] max-w-full rounded-[4px] px-3 py-2 text-wx-ink ${tone}`} data-interactive>
      <div className="mb-1 flex items-center gap-2 text-xs leading-4 text-wx-quoteInk">
        <span className="min-w-0 flex-1 truncate">{state.kind === 'done' ? `${languageName(state.source)} → ${languageName(state.target)}` : tr('翻译', 'Translation')}</span>
        <button type="button" onClick={onClose} className="-my-3 -mr-3 flex h-11 w-11 shrink-0 items-center justify-center" aria-label={tr('隐藏译文', 'Hide translation')}>
          <CloseIcon />
        </button>
      </div>
      {state.kind === 'loading' ? (
        <div className="flex items-center gap-2 py-1 text-[13px] text-wx-quoteInk">
          <WxSpinner size={16} label={tr('正在翻译', 'Translating')} />
          <span aria-hidden>{tr('正在翻译…', 'Translating…')}</span>
        </div>
      ) : state.kind === 'error' ? (
        <p className="text-[13px] leading-snug text-wx-quoteInk">
          {state.message}{' '}
          <button type="button" onClick={run} className={own ? 'text-brand-700 underline' : 'text-wx-link'}>
            {tr('重试', 'Retry')}
          </button>
        </p>
      ) : (
        <p className="whitespace-pre-wrap break-words text-[15px] leading-[1.4] [overflow-wrap:anywhere]">{state.text}</p>
      )}
    </div>
  );
}
