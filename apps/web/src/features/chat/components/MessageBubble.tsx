import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { RECALL_WINDOW_MS, withinRecallWindow, type ChatMessage, type TranslateLang } from '@utmmsc/shared';
import { errorMessage } from '../../../shared/api/errors';
import { formatMessageTime } from '../../../shared/format/time';
import { Button } from '../../../shared/ui/Button';
import { useConfirm } from '../../../shared/ui/confirm';
import { MemberAvatar } from '../../profile/InitialAvatar';
import { Sheet } from '../../profile/Sheet';
import { chatApi } from '../api';

interface Props {
  message: ChatMessage;
  own: boolean;
  canModerate: boolean;
  mediaToken: string | null;
  onDelete: (id: number) => void;
  onRecall: (id: number) => void;
  onMute: (memberId: string) => void;
  onOpenProfile: (memberId: string) => void;
}

const LONG_PRESS_MS = 450;

function languageName(lang: TranslateLang): string {
  return lang === 'zh-CN' ? '中文' : 'English';
}

function recallNotice(own: boolean, name: string): string {
  if (own) return '你撤回了一条消息';
  const who = name.trim() || '有人';
  return `${who}撤回了一条消息`;
}

function copyWithFallback(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

/**
 * Others sit on the left and the sender on the right. Avatar and name open the profile;
 * the bubble opens copy, translate, and recall. Withdrawal still depends on the server clock.
 * 别人在左、自己在右。头像和名字打开资料；气泡打开复制、翻译和撤回。能否撤回仍由服务器时钟决定。
 */
export function MessageBubble({ message, own, canModerate, mediaToken, onDelete, onRecall, onMute, onOpenProfile }: Props) {
  const ask = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<{ text: string; label: string } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const press = useRef({ x: 0, y: 0, timer: null as ReturnType<typeof setTimeout> | null, long: false, moved: false });
  const translateSeq = useRef(0);
  const ignoreClose = useRef(false);
  const closeGuard = useRef<(() => void) | null>(null);

  const canDelete = own || canModerate;
  const hasText = !message.deleted && !message.recalled && message.text.trim().length > 0;
  const canRecall = own && !message.deleted && !message.recalled && withinRecallWindow(message.createdAt, now);
  const canOpen = hasText || canRecall;
  const profileLabel = `${message.author.displayName.trim() || '成员'}的资料`;

  useEffect(() => {
    if (!own || message.deleted || message.recalled) return;
    const createdAtMs = Date.parse(message.createdAt);
    if (!Number.isFinite(createdAtMs)) return;
    const remaining = createdAtMs + RECALL_WINDOW_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 30);
    return () => clearTimeout(timer);
  }, [own, message.deleted, message.recalled, message.createdAt]);

  useEffect(() => {
    const pressState = press.current;
    const guard = closeGuard;
    return () => {
      if (pressState.timer) clearTimeout(pressState.timer);
      guard.current?.();
    };
  }, []);

  function clearPress() {
    if (press.current.timer) {
      clearTimeout(press.current.timer);
      press.current.timer = null;
    }
  }

  function releasePress() {
    clearPress();
  }

  /**
   * deferClose is for a press that is still down. Its release lands on the new backdrop and
   * must not count as a dismiss.
   * 按住还没松开时打开菜单，松手会落在新遮罩上，这次不能当成关闭。
   */
  function openMenu(deferClose = false) {
    translateSeq.current += 1;
    setTranslating(false);
    setTranslation(null);
    setStatus(null);
    setNow(Date.now());
    setMenuOpen(true);
    closeGuard.current?.();
    closeGuard.current = null;
    if (!deferClose) {
      ignoreClose.current = false;
      return;
    }
    ignoreClose.current = true;
    const arm = () => {
      window.removeEventListener('pointerup', arm, true);
      window.removeEventListener('pointercancel', arm, true);
      closeGuard.current = null;
      setTimeout(() => {
        ignoreClose.current = false;
      }, 0);
    };
    closeGuard.current = () => {
      window.removeEventListener('pointerup', arm, true);
      window.removeEventListener('pointercancel', arm, true);
    };
    window.addEventListener('pointerup', arm, true);
    window.addEventListener('pointercancel', arm, true);
  }

  function closeMenu() {
    if (ignoreClose.current) return;
    setMenuOpen(false);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!canOpen || (event.button !== 0 && event.button !== 2)) return;
    press.current.x = event.clientX;
    press.current.y = event.clientY;
    press.current.long = false;
    press.current.moved = false;
    clearPress();
    if (event.button !== 0) return;
    press.current.timer = setTimeout(() => {
      press.current.long = true;
      press.current.timer = null;
      openMenu(true);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (press.current.timer === null) return;
    const dx = event.clientX - press.current.x;
    const dy = event.clientY - press.current.y;
    if (dx * dx + dy * dy > 100) {
      press.current.moved = true;
      clearPress();
    }
  }

  function onBubbleClick() {
    if (!canOpen) return;
    if (press.current.long || press.current.moved) {
      press.current.long = false;
      press.current.moved = false;
      return;
    }
    openMenu();
  }

  function onContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!canOpen) return;
    event.preventDefault();
    openMenu(event.buttons !== 0);
  }

  async function remove() {
    const ok = await ask({ title: '删除这条消息？', confirmLabel: '删除', danger: true });
    if (ok) onDelete(message.id);
  }

  async function recall() {
    setMenuOpen(false);
    const ok = await ask({
      title: '撤回这条消息？',
      body: '撤回后，大家会看到一条撤回提示，原文不会再显示。',
      confirmLabel: '撤回',
      danger: true,
    });
    if (ok) onRecall(message.id);
  }

  async function copyText() {
    setStatus(null);
    const text = message.text;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setStatus('已复制');
        return;
      }
    } catch {
      // The legacy path below covers browsers that block the async clipboard.
    }
    setStatus(copyWithFallback(text) ? '已复制' : '复制失败');
  }

  async function translate() {
    const request = ++translateSeq.current;
    setTranslating(true);
    setStatus(null);
    setTranslation(null);
    try {
      const res = await chatApi.translate(message.text);
      if (request !== translateSeq.current) return;
      setTranslation({ text: res.text, label: `${languageName(res.sourceLang)} → ${languageName(res.targetLang)}` });
    } catch (err) {
      if (request !== translateSeq.current) return;
      setStatus(errorMessage(err));
    } finally {
      if (request === translateSeq.current) setTranslating(false);
    }
  }

  if (message.recalled && !message.deleted) {
    return (
      <p className="px-8 py-1 text-center text-[13px] leading-snug text-stone-400">
        {recallNotice(own, message.author.displayName)}
        <span className="mx-1">·</span>
        {formatMessageTime(message.createdAt)}
      </p>
    );
  }

  const bubbleClass = `rounded-2xl px-3 py-2 ${own ? 'rounded-br-md bg-brand-700 text-white' : 'rounded-bl-md bg-white text-brand-800 ring-1 ring-stone-200'} ${message.deleted ? 'italic text-stone-400' : ''}`;

  return (
    <div className={`flex items-start gap-2 ${own ? 'flex-row-reverse' : ''}`}>
      <button type="button" onClick={() => onOpenProfile(message.author.id)} className="mt-5 shrink-0 rounded-full" aria-label={profileLabel}>
        <MemberAvatar name={message.author.displayName || '成'} avatarKey={message.author.avatarKey} className="h-9 w-9 text-sm" />
      </button>
      <div className={`flex min-w-0 max-w-[78%] flex-col ${own ? 'items-end' : 'items-start'}`}>
        <div className={`mb-0.5 flex max-w-full items-center gap-2 text-xs ${own ? 'flex-row-reverse' : ''}`}>
          <button type="button" onClick={() => onOpenProfile(message.author.id)} className="truncate font-medium text-brand-800">
            {message.author.displayName}
          </button>
          <span className="shrink-0 text-stone-400">{formatMessageTime(message.createdAt)}</span>
        </div>
        <div
          className={`${bubbleClass} ${canOpen ? 'cursor-pointer select-none' : ''}`}
          style={canOpen ? { WebkitTouchCallout: 'none' } : undefined}
          onClick={onBubbleClick}
          onContextMenu={onContextMenu}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={releasePress}
          onPointerCancel={releasePress}
          onPointerLeave={clearPress}
        >
          {message.deleted ? (
            <span className="text-sm">消息已删除</span>
          ) : (
            <>
              {message.imageKey && mediaToken ? (
                <img src={chatApi.mediaUrl(message.imageKey, mediaToken)} alt="" className="mb-1 max-h-72 rounded-lg" loading="lazy" />
              ) : null}
              {message.text ? <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{message.text}</p> : null}
            </>
          )}
        </div>
        {!message.deleted && (canOpen || canDelete || (canModerate && !own)) ? (
          <div className={`mt-1 flex gap-3 text-xs text-stone-400 ${own ? 'flex-row-reverse' : ''}`}>
            {canOpen ? (
              <button type="button" onClick={() => openMenu()} className="min-h-11 px-1" aria-label="消息操作">
                ···
              </button>
            ) : null}
            {canDelete ? (
              <button type="button" onClick={() => void remove()} className="min-h-11 px-1">
                删除
              </button>
            ) : null}
            {canModerate && !own ? (
              <button type="button" onClick={() => onMute(message.author.id)} className="min-h-11 px-1">
                禁言
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {menuOpen
        ? createPortal(
            <Sheet title="消息" closeLabel="关闭" onClose={closeMenu}>
              <div className="space-y-2">
                {hasText ? (
                  <Button block variant="secondary" onClick={() => void copyText()}>
                    复制
                  </Button>
                ) : null}
                {hasText ? (
                  <Button block variant="secondary" loading={translating} onClick={() => void translate()}>
                    翻译
                  </Button>
                ) : null}
                {canRecall ? (
                  <Button block variant="danger" onClick={() => void recall()}>
                    撤回
                  </Button>
                ) : null}
                {status ? <p className="text-sm text-stone-500">{status}</p> : null}
                {translation ? (
                  <div className="rounded-xl bg-brand-50 px-3 py-2 text-[15px] leading-snug text-brand-800">
                    <p className="mb-1 text-xs text-stone-500">{translation.label}</p>
                    <p className="whitespace-pre-wrap break-words">{translation.text}</p>
                  </div>
                ) : null}
              </div>
            </Sheet>,
            document.body,
          )
        : null}
    </div>
  );
}
