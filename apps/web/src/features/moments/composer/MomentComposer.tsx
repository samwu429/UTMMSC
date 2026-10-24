import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { MOMENT_IMAGE_LIMIT, MOMENT_TEXT_MAX, momentTextLength, normalizeMomentText, type MomentAudience } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { tr as translate, useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { ActionSheet, type ActionSheetOption } from '../../../shared/ui/ActionSheet';
import { useBackToClose } from '../../../shared/ui/overlayHistory';
import { toast } from '../../../shared/ui/toast';
import { useStatusBarColor } from '../../../shared/ui/useStatusBarColor';
import { useAutoGrow } from '../../chat/composer/useAutoGrow';
import { LocationIcon } from '../icons';
import { newMomentClientId, type PublishRequest } from '../model';
import { useFeedStore } from '../state/feedStore';
import { uploadMomentMedia } from '../transport/upload';
import { AudienceIcon, AudienceSheet, audienceDescription, audienceShortLabel, useAudienceCounts } from './AudienceSheet';
import { browserComposeEnv, createComposeBatch, type ComposeBatch, type UploadTransport } from './composeQueue';
import { claimKeptMedia, composeDrafts, draftHasContent, dropKeptMedia, keepMedia, peekKeptMedia } from './drafts';
import { LocationSheet } from './LocationSheet';
import { MediaPicker, type MediaPickerHandle } from './MediaPicker';
import { MediaTiles } from './MediaTiles';
import { pickProblemText, planPick, prepProblemText } from './mediaPrep';

/**
 * How the composer opened: with the files just picked from 拍照, 录像 or 从相册选择 (their uploads start at once),
 * or for text only (只发文字, or a long press on the camera), where the textarea is focused in the opening tap.
 * 编辑器如何打开：带着刚从「拍照」「录像」或「从相册选择」选中的文件（立即开始上传），或只发文字（「只发文字」或长按相机），
 * 此时输入框在打开的那次点击中获得焦点。
 */
export type ComposerStart = { kind: 'files'; files: File[] } | { kind: 'text' };

export interface MomentComposerProps {
  start: ComposerStart;
  /** 取消, after 保留 or 不保留 when there was content, or back. */
  /** 「取消」（有内容时在选择「保留」或「不保留」之后），或返回。 */
  onClose(): void;
  /** 发表: the feed store already has the local post; the page closes the composer and scrolls to the top. */
  /** 「发表」：动态 store 已有本地动态；页面关闭编辑器并滚动到顶部。 */
  onPublished(): void;
}

/** The counter appears from here on. */
/** 从这个字数开始显示计数。 */
const COUNTER_FROM = 1800;

/** Each blob goes up under its own type: the prepared photo, the video, or the JPEG preview. */
/** 每个 blob 都以自身的类型上传：处理后的照片、视频或 JPEG 预览图。 */
const uploadForQueue: UploadTransport = (file, { signal, onProgress }) => uploadMomentMedia(file, { signal, onProgress, contentType: file.type });

type OpenSheet = 'none' | 'add' | 'location' | 'audience' | 'keep';

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-wx-meta" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </svg>
  );
}

function OptionRow({ icon, label, value, accent, onClick, children }: { icon: ReactNode; label: string; value?: string; accent?: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="dialog" className="flex w-full items-center gap-3 bg-white pl-5 text-left active:bg-wx-pressed">
      <span className={`shrink-0 ${accent ? 'text-wx-link' : 'text-wx-ink'}`}>{icon}</span>
      <span className="flex min-h-14 min-w-0 flex-1 items-center gap-2 border-b-[0.5px] border-wx-line py-2 pr-4">
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[17px] leading-snug ${accent ? 'text-wx-link' : 'text-wx-ink'}`}>{label}</span>
          {children}
        </span>
        {value ? <span className="max-w-[45%] shrink-0 truncate text-[15px] text-wx-meta">{value}</span> : null}
        <Chevron />
      </span>
    </button>
  );
}

/**
 * Replaces the feed in document flow while open (the page keeps the feed mounted and hidden): text, media
 * tiles with live uploads, 所在位置 and 谁可以看 (好友 every time), then 发表. Uploads start the moment files are
 * picked, so 发表 only hands the post to the feed store, which waits for them. 取消 with text or media asks
 * 将此次编辑保留？; 保留 stores the text, audience and place on this device and keeps the media, still uploading,
 * for this session. Leaving any other way (a notice opened, the app hidden) keeps them the same way.
 * 打开时在文档流中替换信息流（页面保留信息流的挂载并隐藏）：正文、实时上传的媒体图块、「所在位置」和「谁可以看」（每次默认好友），然后「发表」。
 * 文件一选中就开始上传，因此「发表」只是把动态交给动态 store，由它等待上传完成。有正文或媒体时「取消」会询问「将此次编辑保留？」；
 * 「保留」把正文、可见范围和地点存在本设备上，媒体在本次会话中保留并继续上传。以其他方式离开（打开了通知、应用被切到后台）时同样保留。
 */
export function MomentComposer({ start, onClose, onPublished }: MomentComposerProps) {
  const tr = useTr();
  const counterId = useId();
  const memberId = useSessionStore((s) => s.member?.id ?? null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<MediaPickerHandle>(null);

  // Reading what 保留 left is pure, so React may run this twice; the batch is claimed in an effect.
  // 读取「保留」留下的内容没有副作用，React 可以执行两次；批次在副作用中才被领取。
  const [initial] = useState(() => {
    const draft = memberId ? composeDrafts.load(memberId) : null;
    const kept = memberId ? peekKeptMedia(memberId) : null;
    // New media of the other kind replace what was kept; the same kind joins it.
    // 新选的另一种媒体会取代保留的媒体；同类媒体则加在后面。
    const pickedKind = start.kind === 'files' ? (planPick(start.files, { kind: null, count: 0 }).accepted[0]?.kind ?? null) : null;
    const keptKind = kept?.kind() ?? null;
    const reuse = kept !== null && (pickedKind === null || keptKind === null || keptKind === pickedKind);
    return { draft, batch: reuse && kept ? kept : createComposeBatch(browserComposeEnv(uploadForQueue)), keptMedia: reuse };
  });
  const batch: ComposeBatch = initial.batch;
  const [text, setText] = useState(initial.draft?.text ?? '');
  const [audience, setAudience] = useState<MomentAudience>(initial.draft?.audience ?? 'friends');
  const [location, setLocation] = useState<string | null>(initial.draft?.location ?? null);
  // A draft with media came back after a reload, so its photos are gone: 照片需要重新选择.
  // 带媒体的草稿在重新加载后恢复，照片已经不在了：照片需要重新选择。
  const [repick, setRepick] = useState(() => !initial.keptMedia && (initial.draft?.mediaCount ?? 0) > 0);
  const [sheet, setSheet] = useState<OpenSheet>('none');
  const items = useSyncExternalStore(batch.subscribe, batch.items, batch.items);
  const decidedRef = useRef(false);
  const startedRef = useRef(false);
  const latest = useRef({ text, audience, location });

  useLayoutEffect(() => {
    latest.current = { text, audience, location };
  });

  useStatusBarColor('#FFFFFF');
  useAutoGrow(textareaRef, text, { maxLines: 14 });
  // Fetched now, so 谁可以看 opens with its numbers.
  // 现在就取，打开「谁可以看」时人数已经就绪。
  useAudienceCounts();

  const normalized = normalizeMomentText(text);
  const length = momentTextLength(normalized);
  const overLimit = length > MOMENT_TEXT_MAX;
  const kind = items[0]?.local.kind ?? null;
  const canAdd = items.length === 0 || (kind === 'image' && items.length < MOMENT_IMAGE_LIMIT);
  const canPublish = memberId !== null && !overLimit && (normalized.length > 0 || items.length > 0);
  const online = batch.online();
  const waiting = !online && items.some((item) => item.status === 'queued' || item.status === 'uploading');

  function addFiles(files: readonly File[]) {
    const plan = planPick(files, { kind: batch.kind(), count: batch.items().length });
    if (plan.problems.length) toast(plan.problems.map((problem) => pickProblemText(problem, translate)).join('\n'), { ms: 2500 });
    if (!plan.accepted.length) return;
    batch.add(plan.accepted);
    setRepick(false);
  }

  /**
   * Saves the text, audience and place, and keeps the media for this session; nothing worth keeping clears the
   * draft. An unmount keeps even an empty batch, because StrictMode mounts the composer again right after and
   * claims it back; 保留 releases an empty one.
   * 保存正文、可见范围和地点，并在本次会话中保留媒体；没有值得保留的内容时清除草稿。卸载时即使批次为空也保留它，因为 StrictMode
   * 会紧接着再次挂载编辑器并取回它；「保留」则释放空的批次。
   */
  function keep(releaseEmpty: boolean) {
    if (!memberId) {
      batch.release();
      return;
    }
    const { text: body, audience: who, location: where } = latest.current;
    const mediaCount = batch.items().length;
    if (draftHasContent({ text: body, mediaCount })) composeDrafts.save(memberId, { text: body, audience: who, location: where, mediaCount });
    else composeDrafts.clear(memberId);
    if (releaseEmpty && mediaCount === 0) batch.release();
    else keepMedia(memberId, batch);
  }

  function discard() {
    decidedRef.current = true;
    batch.release();
    if (memberId) composeDrafts.clear(memberId);
    onClose();
  }

  function requestClose() {
    if (sheet === 'keep') return;
    if (!draftHasContent({ text: latest.current.text, mediaCount: batch.items().length })) {
      discard();
      return;
    }
    setSheet('keep');
  }

  // Back closes the composer, through 将此次编辑保留？ when there is something to keep; the sheet has its own entry.
  // 返回关闭编辑器，有内容时先经过「将此次编辑保留？」；该菜单有自己的历史记录。
  useBackToClose(requestClose, sheet !== 'keep');

  const closeRef = useRef(requestClose);
  useLayoutEffect(() => {
    closeRef.current = requestClose;
  });

  useEffect(() => {
    // Listening on window lets every layer above (sheets, the preview, a drag) take Escape first on document;
    // they mark it handled, so only an Escape nobody took closes the composer.
    // 监听 window，上层的面板、预览和拖动都会先在 document 上处理 Escape 并将其标记为已处理；只有无人处理的 Escape 才会关闭编辑器。
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useLayoutEffect(() => {
    if (start.kind !== 'text') return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus({ preventScroll: true });
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
    // Only on opening, inside the tap that opened it.
    // 只在打开时执行，处于打开它的那次点击之中。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The composer starts at the top of the document. This runs after the page's layout effects, which have
    // saved the feed's place by then; the page restores it when the composer closes.
    // 编辑器从文档顶部开始。这里在页面的布局副作用之后运行，页面此时已保存信息流的位置；编辑器关闭时由页面恢复。
    window.scrollTo(0, 0);
    if (memberId) {
      const kept = peekKeptMedia(memberId);
      if (kept === batch) claimKeptMedia(batch);
      else if (kept) dropKeptMedia();
    }
    if (!startedRef.current) {
      startedRef.current = true;
      if (start.kind === 'files') addFiles(start.files);
    }
    return () => {
      if (decidedRef.current) return;
      // Leaving without 保留 or 不保留 keeps everything; a member who signed out keeps nothing.
      // 没有选择「保留」或「不保留」就离开时保留全部内容；已退出登录的成员则不保留任何内容。
      if (memberId && useSessionStore.getState().member?.id === memberId) keep(false);
      else batch.release();
    };
    // Mount and unmount only; start is the opening request.
    // 只在挂载和卸载时执行；start 是打开时的请求。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => batch.onProblem((error) => toast(prepProblemText(error, translate), { ms: 2500 })), [batch]);

  useEffect(() => {
    // A reload or a closed app should not lose what was typed, so the draft is saved whenever the page is hidden.
    // 重新加载或关闭应用不应丢失已输入的内容，因此页面每次被隐藏时都保存草稿。
    const save = () => {
      if (decidedRef.current || !memberId) return;
      const { text: body, audience: who, location: where } = latest.current;
      composeDrafts.save(memberId, { text: body, audience: who, location: where, mediaCount: batch.items().length });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', save);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', save);
    };
  }, [batch, memberId]);

  function publish() {
    if (!canPublish || !memberId) return;
    const uploads = batch.items().length > 0 ? batch : null;
    // A tile that failed gets another try now; the store waits for every upload before it posts.
    // 失败的图块现在再试一次；store 会等所有上传完成后再发表。
    uploads?.retry();
    const request: PublishRequest = { clientId: newMomentClientId(), text: normalized, audience, location, uploads };
    decidedRef.current = true;
    try {
      useFeedStore.getState().publish(request);
    } catch (error) {
      decidedRef.current = false;
      toast(errorMessage(error));
      return;
    }
    if (!uploads) batch.release();
    composeDrafts.clear(memberId);
    if (location) composeDrafts.rememberPlace(memberId, location);
    onPublished();
  }

  const addOptions: ActionSheetOption[] = [{ label: tr('拍照', 'Take photo'), onSelect: () => pickerRef.current?.takePhoto() }];
  if (items.length === 0) addOptions.push({ label: tr('录像', 'Record video'), onSelect: () => pickerRef.current?.recordVideo() });
  addOptions.push({ label: tr('从相册选择', 'Choose from library'), onSelect: () => pickerRef.current?.chooseFromLibrary() });

  return (
    <div className="min-h-[100dvh] bg-white" style={{ paddingBottom: 'calc(2rem + var(--safe-bottom))' }}>
      <header
        className="sticky top-0 z-20 bg-white"
        style={{ paddingTop: 'var(--safe-top)', paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}
      >
        <div className="flex h-14 items-center justify-between px-2">
          <button type="button" onClick={requestClose} className="min-h-11 min-w-11 px-2 text-[17px] text-wx-ink active:opacity-60">
            {tr('取消', 'Cancel')}
          </button>
          <button type="button" onClick={publish} disabled={!canPublish} className="group flex h-11 items-center px-2">
            <span className="flex h-8 items-center rounded-[4px] bg-brand-800 px-3 text-[15px] font-medium text-white group-active:bg-brand-900 group-disabled:bg-wx-pressed group-disabled:text-wx-meta">
              {tr('发表', 'Post')}
            </span>
          </button>
        </div>
      </header>
      <div style={{ paddingLeft: 'calc(1.25rem + var(--safe-left))', paddingRight: 'calc(1.25rem + var(--safe-right))' }}>
        <textarea
          ref={textareaRef}
          rows={4}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={tr('这一刻的想法…', "What's on your mind…")}
          aria-label={tr('这一刻的想法…', "What's on your mind…")}
          aria-describedby={length >= COUNTER_FROM ? counterId : undefined}
          className="block w-full resize-none bg-transparent pb-2 pt-3 text-[17px] leading-[26px] text-wx-ink caret-brand-700 outline-none placeholder:text-wx-meta focus-visible:outline-none"
        />
        {length >= COUNTER_FROM ? (
          <p id={counterId} className={`pb-2 text-right text-[13px] tabular-nums ${overLimit ? 'text-wx-red' : 'text-wx-meta'}`} aria-live="polite">
            {length}/{MOMENT_TEXT_MAX}
          </p>
        ) : null}
        {repick ? <p className="pb-2 text-[13px] text-wx-meta">{tr('照片需要重新选择', 'Pick the photos again')}</p> : null}
        <div className="pt-2">
          <MediaTiles
            items={items}
            canAdd={canAdd}
            online={online}
            onAdd={() => setSheet('add')}
            onRetry={(id) => batch.retryItem(id)}
            onRemove={(id) => batch.remove(id)}
            onMove={(from, to) => batch.move(from, to)}
          />
        </div>
        {waiting ? <p className="pt-2 text-[13px] text-wx-meta">{tr('等待网络', 'Waiting for network')}</p> : null}
      </div>
      <div className="mt-8 border-t-[0.5px] border-wx-line" style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)' }}>
        <OptionRow
          icon={<LocationIcon className="h-6 w-6" />}
          label={location ?? tr('所在位置', 'Location')}
          accent={location !== null}
          onClick={() => {
            // Synchronous, so the place field can take focus inside this tap and the keyboard rises.
            // 同步渲染，地点输入框才能在这次点击中获得焦点并弹出键盘。
            flushSync(() => setSheet('location'));
          }}
        />
        <OptionRow icon={<AudienceIcon audience={audience} className="h-6 w-6" />} label={tr('谁可以看', 'Who can see')} value={audienceShortLabel(audience, tr)} onClick={() => setSheet('audience')}>
          {audience === 'club' ? <span className="mt-0.5 block text-[13px] leading-snug text-wx-meta">{audienceDescription('club', tr)}</span> : null}
        </OptionRow>
      </div>
      <MediaPicker ref={pickerRef} onPicked={addFiles} />
      {sheet === 'add' ? <ActionSheet options={addOptions} onClose={() => setSheet('none')} /> : null}
      {sheet === 'location' ? <LocationSheet value={location} onChange={setLocation} onClose={() => setSheet('none')} /> : null}
      {sheet === 'audience' ? <AudienceSheet value={audience} onChange={setAudience} onClose={() => setSheet('none')} /> : null}
      {sheet === 'keep' ? (
        <ActionSheet
          title={tr('将此次编辑保留？', 'Keep this draft?')}
          onClose={() => setSheet('none')}
          options={[
            {
              label: tr('保留', 'Keep'),
              onSelect: () => {
                decidedRef.current = true;
                keep(true);
                onClose();
              },
            },
            { label: tr('不保留', 'Discard'), danger: true, onSelect: discard },
          ]}
        />
      ) : null}
    </div>
  );
}
