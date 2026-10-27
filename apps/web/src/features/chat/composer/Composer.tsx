import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ForwardedRef,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { MESSAGE_TEXT_MAX, type QuotePreview, type StickerItem } from '@utmmsc/shared';
import { useTr } from '../../../shared/i18n/locale';
import { useSessionStore } from '../../../shared/session/store';
import { toast } from '../../../shared/ui/toast';
import type { ComposerHandle, ComposerProps, QuoteTargetState } from '../room/types';
import { draftKey, useDraftsStore } from '../state/drafts';
import type { Translate } from '../format/systemText';
import { STICKER_PICK_ACCEPT } from '../stickers/prep';
import { useStickerLibrary } from '../stickers/store';
import { EmojiIcon, KeyboardIcon, PlusCircleIcon } from './composerIcons';
import { ExpressionPanel } from './ExpressionPanel';
import { IMAGE_PICK_ACCEPT, IMAGES_PER_PICK_MAX, ImagePrepError, prepareImage } from './imagePrep';
import { besideKeyboard, expectsSoftKeyboard, lastKeyboardHeight, rememberKeyboardHeight, watchKeyboard } from './keyboardHeight';
import { MentionPicker } from './MentionPicker';
import {
  capMessageText,
  collectMentions,
  deleteBackward,
  insertAtSelection,
  insertMention,
  mentionLabel,
  presentMentions,
  removeTokenOnBackspace,
  repairBrokenToken,
  typedMentionTrigger,
  type MentionTarget,
  type TextEdit,
  type TextSelection,
} from './mentionTokens';
import { PlusPanel } from './PlusPanel';
import { QuoteStrip } from './QuoteStrip';
import { addPickedStickers, roomForStickerPick } from './StickerPanel';
import { quoteForSticker, stickerRefOf } from './stickerGrid';
import { useAutoGrow } from './useAutoGrow';

type Panel = 'none' | 'emoji' | 'plus';

const DRAFT_SAVE_MS = 300;
/** The space a closed panel holds for the keyboard is given up after this long if no keyboard appears. */
/** 若一直没有键盘出现，已关闭的面板为键盘保留的空间在这段时间后释放。 */
const HANDOFF_MAX_MS = 1000;
const QUOTE_GONE: ReadonlySet<QuoteTargetState> = new Set(['recalled', 'deleted', 'hidden', 'unavailable']);

/**
 * Mention ids behind unsent drafts. Stored drafts keep only the text and the quote, so the ids stay in memory
 * for this session and are dropped when the member signs out or changes.
 * 未发送草稿中的提醒 id。保存的草稿只有文字和引用，所以 id 只在本次会话的内存中保留，成员退出或切换时清除。
 */
const draftMentions = new Map<string, MentionTarget[]>();
useSessionStore.subscribe((state, prev) => {
  if (!state.token || state.member?.id !== prev.member?.id) draftMentions.clear();
});

interface Restored {
  text: string;
  quote: QuotePreview | null;
  mentions: MentionTarget[];
}

function restoreDraft(meId: string | null, roomId: string): Restored {
  const draft = meId ? useDraftsStore.getState().getDraft(meId, roomId) : null;
  if (!meId || !draft) return { text: '', quote: null, mentions: [] };
  const text = capMessageText(draft.text);
  // A quote that is no longer readable is dropped instead of being shown again.
  // 已不可读的引用会被丢弃，不再显示。
  const quote = draft.quote?.state === 'ok' ? draft.quote : null;
  return { text, quote, mentions: presentMentions(text, draftMentions.get(draftKey(meId, roomId)) ?? []) };
}

function imageProblemText(error: unknown, tr: Translate): string {
  const problem = error instanceof ImagePrepError ? error.problem : 'invalid';
  if (problem === 'type') return tr('只支持 JPEG、PNG、WebP、GIF', 'Only JPEG, PNG, WebP, and GIF images are supported');
  if (problem === 'size') return tr('图片不能超过 8MB', 'Images must be 8MB or smaller');
  return tr('图片无效', 'That image is not valid');
}

function keepFocus(event: SyntheticEvent) {
  // The textarea keeps focus, so the keyboard stays up and its height can still be measured.
  // 文本框保持焦点，键盘不会收起，仍可测量其高度。
  event.preventDefault();
}

function BarButton({ label, expanded, onClick, children }: { label: string; expanded?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onPointerDown={keepFocus}
      onMouseDown={keepFocus}
      onClick={onClick}
      aria-label={label}
      aria-expanded={expanded}
      className="-mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-wx-ink active:opacity-60"
    >
      {children}
    </button>
  );
}

/**
 * WeChat input bar: [text][emoji][more or send], with the emoji and more panels taking the keyboard's place,
 * mentions in channels, a quote strip and per-room drafts. It is never disabled for connectivity, because
 * room.sendText queues while offline. Keyed by room, so nothing carries over when the room changes.
 * 微信式输入栏：[文字][表情][更多或发送]。表情面板和更多面板取代键盘的位置，频道中可以 @ 成员，带引用条和按房间保存的草稿。
 * 它不会因为网络状态被禁用，因为 room.sendText 在离线时也会排队。按房间区分实例，切换房间时不会带入任何内容。
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(props, ref) {
  return <RoomComposer key={props.roomId} {...props} handleRef={ref} />;
});

function RoomComposer({
  roomId,
  kind,
  room,
  disabledNotice,
  canMentionAll,
  onSent,
  onPanelChange,
  handleRef,
}: ComposerProps & { handleRef: ForwardedRef<ComposerHandle> }) {
  const tr = useTr();
  const navigate = useNavigate();
  const meId = useSessionStore((s) => s.member?.id ?? null);
  const [restored] = useState(() => restoreDraft(meId, roomId));
  const [text, setText] = useState(restored.text);
  const [quote, setQuote] = useState<QuotePreview | null>(restored.quote);
  const [panel, setPanel] = useState<Panel>('none');
  const [panelHeight, setPanelHeight] = useState(lastKeyboardHeight);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  // A panel gave way to the keyboard, which is not up yet; its space is held so the input bar does not drop.
  // 面板已让位给键盘，但键盘尚未弹出；保留其空间，输入栏因此不会下落。
  const [handoff, setHandoff] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const photosRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const stickersRef = useRef<HTMLInputElement>(null);
  const mentionsRef = useRef<MentionTarget[]>(restored.mentions);
  const latestRef = useRef({ text: restored.text, quote: restored.quote });
  // The caret while the textarea is blurred (a panel or the picker is open); the element is the truth while focused.
  // 文本框失焦时（面板或选择列表打开）记录的光标位置；聚焦时以元素本身为准。
  const selectionRef = useRef<TextSelection>({ start: restored.text.length, end: restored.text.length });
  const pendingCaretRef = useRef<number | null>(null);
  const triggerRef = useRef(false);
  const composingRef = useRef(false);
  const roomRef = useRef(room);
  const onSentRef = useRef(onSent);
  const mountedRef = useRef(true);
  const imageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const reportedPanelRef = useRef(false);
  const panelHeightRef = useRef(panelHeight);

  const inputVisible = !disabledNotice;
  const activePanel: Panel = inputVisible ? panel : 'none';
  const mentionsEnabled = kind === 'channel' && room.capable;
  const hasText = text.trim().length > 0;

  useLayoutEffect(() => {
    latestRef.current = { text, quote };
    roomRef.current = room;
    onSentRef.current = onSent;
    panelHeightRef.current = panelHeight;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useAutoGrow(textareaRef, text, { active: inputVisible });

  useEffect(() => {
    let frame = 0;
    const stop = watchKeyboard((height) => {
      setKeyboardOpen(height !== null);
      // The held space is gone once the keyboard covers it. The room root follows the keyboard in its own
      // animation frame, so the space is released after that.
      // 键盘覆盖了保留的空间后，该空间即已用尽。房间根元素在其动画帧中跟随键盘，因此在那之后再释放。
      if (height === null || height < panelHeightRef.current - 1) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHandoff(false));
    });
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, []);

  useEffect(() => {
    if (!handoff) return;
    const timer = setTimeout(() => setHandoff(false), HANDOFF_MAX_MS);
    return () => clearTimeout(timer);
  }, [handoff]);

  useLayoutEffect(() => {
    const caret = pendingCaretRef.current;
    const element = textareaRef.current;
    if (caret === null || !element) return;
    pendingCaretRef.current = null;
    if (document.activeElement === element) element.setSelectionRange(caret, caret);
  }, [text]);

  const panelOpen = activePanel !== 'none';
  useEffect(() => {
    if (reportedPanelRef.current === panelOpen) return;
    reportedPanelRef.current = panelOpen;
    onPanelChange?.(panelOpen);
  }, [panelOpen, onPanelChange]);

  const applyEdit = useCallback((edit: TextEdit) => {
    selectionRef.current = { start: edit.caret, end: edit.caret };
    const element = textareaRef.current;
    if (edit.text === latestRef.current.text) {
      if (element && document.activeElement === element) element.setSelectionRange(edit.caret, edit.caret);
      return;
    }
    pendingCaretRef.current = edit.caret;
    latestRef.current = { ...latestRef.current, text: edit.text };
    setText(edit.text);
  }, []);

  const focusInput = useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    // A pending caret is applied once the new value is rendered.
    // 待应用的光标位置会在新值渲染后设置。
    if (pendingCaretRef.current !== null) return;
    const length = element.value.length;
    const { start, end } = selectionRef.current;
    element.setSelectionRange(Math.min(start, length), Math.min(end, length));
  }, []);

  function readSelection(): TextSelection {
    const element = textareaRef.current;
    if (element && document.activeElement === element) return { start: element.selectionStart, end: element.selectionEnd };
    return selectionRef.current;
  }

  function rememberSelection() {
    const element = textareaRef.current;
    if (element && document.activeElement === element) selectionRef.current = { start: element.selectionStart, end: element.selectionEnd };
  }

  // Backspace right after a mention removes the whole token. beforeinput covers soft keyboards whose keydown is 229.
  // 紧跟在提醒之后按退格会删除整个标记。beforeinput 覆盖 keydown 为 229 的软键盘。
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType !== 'deleteContentBackward' || !event.cancelable || event.isComposing) return;
      const edit = removeTokenOnBackspace(element.value, { start: element.selectionStart, end: element.selectionEnd }, mentionsRef.current);
      if (!edit) return;
      event.preventDefault();
      applyEdit(edit);
    };
    element.addEventListener('beforeinput', onBeforeInput);
    return () => element.removeEventListener('beforeinput', onBeforeInput);
  }, [inputVisible, applyEdit]);

  const saveDraft = useCallback(() => {
    // A sign-out or an expired session resets the drafts before this screen unmounts; saving then would
    // put the previous member's text back on the device.
    // 退出登录或会话过期会在本页卸载之前重置草稿；此时保存会把上一位成员的文字写回设备。
    const session = useSessionStore.getState();
    if (!meId || !session.token || session.member?.id !== meId) return;
    const { text: currentText, quote: currentQuote } = latestRef.current;
    const key = draftKey(meId, roomId);
    const drafts = useDraftsStore.getState();
    if (!currentText.trim() && !currentQuote) {
      drafts.clearDraft(meId, roomId);
      draftMentions.delete(key);
      return;
    }
    drafts.setDraft(meId, roomId, { text: currentText, quote: currentQuote });
    const kept = presentMentions(currentText, mentionsRef.current);
    if (kept.length) draftMentions.set(key, kept);
    else draftMentions.delete(key);
  }, [meId, roomId]);

  // Emptying the input clears the draft at once; anything else is saved after a pause in typing.
  // 清空输入框会立即清除草稿；其他改动在停止输入片刻后保存。
  useEffect(() => {
    if (!text.trim() && !quote) {
      saveDraft();
      return;
    }
    const timer = setTimeout(saveDraft, DRAFT_SAVE_MS);
    return () => clearTimeout(timer);
  }, [text, quote, saveDraft]);

  useEffect(() => saveDraft, [saveDraft]);

  // A quote whose message was withdrawn, removed, hidden or cleared away is dropped, here and in the saved draft.
  // 所引用的消息被撤回、删除、隐藏或清空后，引用会被去掉，已保存的草稿中也一样。
  useEffect(() => {
    if (!quote || !QUOTE_GONE.has(room.quoteTarget(quote.id))) return;
    latestRef.current = { ...latestRef.current, quote: null };
    setQuote(null);
  }, [room, quote]);

  function notifyTooLong() {
    toast(tr(`消息最多 ${MESSAGE_TEXT_MAX} 字`, `Messages can be at most ${MESSAGE_TEXT_MAX} characters`));
  }

  function insertTarget(target: MentionTarget, replaceTrigger: boolean): boolean {
    const edit = insertMention(latestRef.current.text, readSelection(), target, { replaceTrigger });
    if (!edit) {
      notifyTooLong();
      return false;
    }
    mentionsRef.current = [...mentionsRef.current, target];
    applyEdit(edit);
    return true;
  }

  function send() {
    if (!text.trim()) return;
    const picked = mentionsEnabled ? collectMentions(text, mentionsRef.current, { allowAll: canMentionAll }) : { mentions: [], mentionAll: false };
    const clientId = room.sendText({ text, replyTo: quote, mentions: picked.mentions, mentionAll: picked.mentionAll });
    if (!clientId) return;
    mentionsRef.current = [];
    setQuote(null);
    latestRef.current = { ...latestRef.current, quote: null };
    applyEdit({ text: '', caret: 0 });
    if (meId) {
      useDraftsStore.getState().clearDraft(meId, roomId);
      draftMentions.delete(draftKey(meId, roomId));
    }
    onSent();
  }

  /**
   * Sends a sticker at once. The panel and the typed text stay; a pending quote goes along only when the input is empty,
   * and is then cleared as send() clears it.
   * 立即发送表情。面板和已输入的文字保持不变；只有输入框为空时才带上待发送的引用，随后像 send() 一样清除它。
   */
  function sendSticker(sticker: StickerItem) {
    const unavailable = tr('表情暂时无法发送，请稍后再试', "Stickers can't be sent right now. Try again later.");
    if (!room.sendSticker || room.stickers === false) {
      toast(unavailable);
      return;
    }
    const replyTo = quoteForSticker(latestRef.current.text, latestRef.current.quote);
    const clientId = room.sendSticker(stickerRefOf(sticker), { replyTo });
    if (!clientId) {
      toast(unavailable);
      return;
    }
    useStickerLibrary.getState().pushRecent(sticker.id);
    if (replyTo) {
      setQuote(null);
      latestRef.current = { ...latestRef.current, quote: null };
    }
    onSent();
  }

  function collapse() {
    textareaRef.current?.blur();
    setHandoff(false);
    setPanel('none');
  }

  function manageStickers() {
    collapse();
    navigate('/chat/stickers', { state: { from: 'chat' } });
  }

  function chooseStickers() {
    if (roomForStickerPick()) stickersRef.current?.click();
  }

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const element = event.target;
    const prev = latestRef.current.text;
    let next = element.value;
    let caret = element.selectionStart;
    const repaired = repairBrokenToken(prev, next, caret, mentionsRef.current);
    if (repaired) {
      next = repaired.text;
      caret = repaired.caret;
    }
    if (next.length > MESSAGE_TEXT_MAX) {
      next = capMessageText(next);
      caret = Math.min(caret, next.length);
    }
    const adjusted = next !== element.value;
    selectionRef.current = { start: caret, end: caret };
    if (adjusted && next !== prev) pendingCaretRef.current = caret;
    latestRef.current = { ...latestRef.current, text: next };
    setText(next);
    if (mentionsEnabled && !adjusted && typedMentionTrigger(prev, next, caret)) {
      triggerRef.current = true;
      setPanel('none');
      setPickerOpen(true);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // keyCode 229 is the Enter that commits a pinyin candidate in Safari, after isComposing has already turned false.
    // keyCode 229 是 Safari 中确认拼音候选词的回车，此时 isComposing 已经变为 false。
    const composing = event.nativeEvent.isComposing || event.keyCode === 229 || composingRef.current;
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault();
      send();
      return;
    }
    if (event.key === 'Backspace' && !composing && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const element = event.currentTarget;
      const edit = removeTokenOnBackspace(element.value, { start: element.selectionStart, end: element.selectionEnd }, mentionsRef.current);
      if (!edit) return;
      event.preventDefault();
      applyEdit(edit);
    }
  }

  function togglePanel(next: 'emoji' | 'plus') {
    if (activePanel === next) {
      setPanel('none');
      focusInput();
      return;
    }
    // Measured before the blur, while the keyboard is still fully up. The panel is sized beside the keyboard,
    // so it grows into view as the keyboard goes and the input bar stays where it is.
    // 在失焦之前测量，此时键盘仍完全展开。面板按键盘让出的空间计算高度，随键盘收起而显现，输入栏保持不动。
    setPanelHeight(rememberKeyboardHeight() ?? lastKeyboardHeight());
    rememberSelection();
    textareaRef.current?.blur();
    setHandoff(false);
    setPanel(next);
  }

  function onInputFocus() {
    if (panel !== 'none' && expectsSoftKeyboard()) setHandoff(true);
    setPanel('none');
  }

  function chooseMention(target: MentionTarget) {
    setPickerOpen(false);
    insertTarget(target, triggerRef.current);
    triggerRef.current = false;
    focusInput();
  }

  function closePicker() {
    setPickerOpen(false);
    triggerRef.current = false;
    focusInput();
  }

  function insertEmoji(emoji: string) {
    const edit = insertAtSelection(latestRef.current.text, readSelection(), emoji);
    if (!edit) {
      notifyTooLong();
      return;
    }
    applyEdit(edit);
    useDraftsStore.getState().pushRecentEmoji(emoji);
  }

  function backspace() {
    applyEdit(deleteBackward(latestRef.current.text, readSelection(), mentionsRef.current));
  }

  function pickFiles(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (!files.length) return;
    if (files.length > IMAGES_PER_PICK_MAX) toast(tr('最多选择 9 张图片', 'Choose up to 9 images'));
    const chosen = files.slice(0, IMAGES_PER_PICK_MAX);
    // Picks are chained, so every image is queued in the order chosen even when a later pick finishes preparing first.
    // 多次选图依次串联，即使后一次先处理完，每张图片也按选择顺序排队。
    imageQueueRef.current = imageQueueRef.current.then(async () => {
      for (const file of chosen) {
        try {
          const image = await prepareImage(file);
          roomRef.current.sendImage(image.file, { width: image.width, height: image.height });
          if (mountedRef.current) onSentRef.current();
        } catch (error) {
          toast(imageProblemText(error, tr));
        }
      }
    });
  }

  useImperativeHandle(handleRef, () => ({
    focus: focusInput,
    collapse,
    insertMention: (member) => {
      if (kind !== 'channel') return;
      if (insertTarget({ kind: 'member', id: member.id, label: mentionLabel(member.displayName) || tr('成员', 'Member') }, false)) focusInput();
    },
    setQuote: (next) => {
      setQuote(next);
      latestRef.current = { ...latestRef.current, quote: next };
      focusInput();
    },
    restoreText: (value) => {
      const next = capMessageText(value);
      mentionsRef.current = [];
      applyEdit({ text: next, caret: next.length });
      focusInput();
    },
  }));

  const holding = inputVisible && activePanel === 'none' && handoff;
  const bottomInset = activePanel !== 'none' || holding || keyboardOpen ? '0px' : 'var(--safe-bottom)';
  const panelBox = { height: besideKeyboard(panelHeight) };

  return (
    <div
      className="shrink-0 border-t-[0.5px] border-wx-line bg-wx-bar"
      style={{ paddingLeft: 'var(--safe-left)', paddingRight: 'var(--safe-right)', paddingBottom: inputVisible ? bottomInset : 'var(--safe-bottom)' }}
    >
      {disabledNotice ? (
        <p className="flex h-[52px] items-center justify-center px-4 text-center text-[13px] leading-snug text-wx-meta">{disabledNotice}</p>
      ) : (
        <>
          {quote ? <QuoteStrip quote={quote} onCancel={() => setQuote(null)} /> : null}
          <div className="flex items-end gap-0.5 py-2 pl-2.5 pr-1.5">
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              maxLength={MESSAGE_TEXT_MAX}
              onChange={onChange}
              onPaste={(event) => {
                // maxLength cuts a long paste silently, so say why the end is missing.
                // maxLength 会悄悄截断过长的粘贴内容，所以提示末尾为什么不见了。
                const el = event.currentTarget;
                const kept = el.value.length - (el.selectionEnd - el.selectionStart);
                if (kept + event.clipboardData.getData('text').length > MESSAGE_TEXT_MAX) notifyTooLong();
              }}
              onKeyDown={onKeyDown}
              onFocus={onInputFocus}
              onBlur={rememberSelection}
              onSelect={rememberSelection}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              enterKeyHint="send"
              aria-label={tr('输入消息', 'Message')}
              className="block min-h-10 min-w-0 flex-1 resize-none rounded-[4px] bg-white px-2.5 py-[9px] text-[16px] leading-[22px] text-wx-ink caret-brand-700 outline-none focus-visible:outline-none"
            />
            <BarButton label={activePanel === 'emoji' ? tr('键盘', 'Keyboard') : tr('表情', 'Emoji')} onClick={() => togglePanel('emoji')}>
              {activePanel === 'emoji' ? <KeyboardIcon /> : <EmojiIcon />}
            </BarButton>
            {hasText ? (
              <button
                type="button"
                onPointerDown={keepFocus}
                onMouseDown={keepFocus}
                onClick={send}
                className="mb-1 ml-1 mr-1 h-8 shrink-0 rounded-[4px] bg-brand-800 px-3 text-[15px] font-medium text-white active:bg-brand-900"
              >
                {tr('发送', 'Send')}
              </button>
            ) : (
              <BarButton label={tr('更多功能', 'More')} expanded={activePanel === 'plus'} onClick={() => togglePanel('plus')}>
                <PlusCircleIcon />
              </BarButton>
            )}
          </div>
          {activePanel === 'emoji' ? (
            <div className="shrink-0 overflow-hidden" style={panelBox}>
              <ExpressionPanel
                height={panelHeight}
                canSend={hasText}
                onInsert={insertEmoji}
                onBackspace={backspace}
                onSend={send}
                onSendSticker={sendSticker}
                onAddStickers={chooseStickers}
                onManageStickers={manageStickers}
              />
            </div>
          ) : null}
          {activePanel === 'plus' ? (
            <div className="shrink-0 overflow-hidden" style={panelBox}>
              <PlusPanel height={panelHeight} onChoosePhotos={() => photosRef.current?.click()} onTakePhoto={() => cameraRef.current?.click()} />
            </div>
          ) : null}
          {holding ? <div className="shrink-0" style={panelBox} aria-hidden /> : null}
          <input
            ref={photosRef}
            type="file"
            multiple
            accept={IMAGE_PICK_ACCEPT}
            tabIndex={-1}
            aria-hidden
            className="hidden"
            onChange={(event) => {
              pickFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept={IMAGE_PICK_ACCEPT}
            capture="environment"
            tabIndex={-1}
            aria-hidden
            className="hidden"
            onChange={(event) => {
              pickFiles(event.target.files);
              event.target.value = '';
            }}
          />
          {/* Lives here rather than in the panel, so a pick still arrives when the panel closed meanwhile. */}
          {/* 放在这里而不是面板中，即使期间面板已关闭，选中的文件也能送达。 */}
          <input
            ref={stickersRef}
            type="file"
            multiple
            accept={STICKER_PICK_ACCEPT}
            tabIndex={-1}
            aria-hidden
            className="hidden"
            onChange={(event) => {
              addPickedStickers(event.target.files, tr);
              event.target.value = '';
            }}
          />
          {pickerOpen ? <MentionPicker roomId={roomId} meId={meId} canMentionAll={canMentionAll} onSelect={chooseMention} onClose={closePicker} /> : null}
        </>
      )}
    </div>
  );
}
