import { useMemo } from 'react';
import { create } from 'zustand';
import { useSessionStore } from '../../../shared/session/store';
import type { CommentReplyTarget } from '../model';

/**
 * The page's one comment bar, as every card, viewer and notice row reaches it. The CommentBarHost mounted on the
 * page registers itself here; open() hands it the target inside the tap, so its textarea is focused before the
 * tap ends and the keyboard rises on the first try. Drafts stay in memory, one per post and reply target.
 * 页面上唯一的评论栏，所有卡片、查看器和消息行都通过这里使用它。页面上挂载的 CommentBarHost 在此登记自己；open() 在点击中把目标交给它，
 * 因此输入框在点击结束之前就已获得焦点，键盘第一次就能弹出。草稿保存在内存中，每条动态和每个回复对象各一份。
 */

/** What the bar writes to, and what must stay visible above it. */
/** 评论栏写给谁，以及哪些内容必须在它上方保持可见。 */
export interface CommentTarget {
  postId: string;
  /** Placeholder 评论（全社团可见） / 回复 张三（全社团可见） on club posts. */
  /** 全社团动态的占位文字为「评论（全社团可见）」/「回复 张三（全社团可见）」。 */
  clubWide: boolean;
  replyTo: CommentReplyTarget | null;
  /** The InteractionBox, else the footer, or the tapped comment row or notice row. */
  /** 赞和评论区，没有时为底栏，或者是被点击的评论行或消息行。 */
  anchor: () => HTMLElement | null;
}

export interface CommentBarController {
  /**
   * Call inside the tap handler: the textarea is focused synchronously, so the keyboard rises on the first tap.
   * The draft for the target comes back.
   * 在点击处理函数中调用：输入框会同步获得焦点，键盘第一次点击就会弹出。该目标的草稿会恢复。
   */
  open(target: CommentTarget): void;
  /** Closes the bar and the keyboard; the draft is kept. */
  /** 关闭评论栏和键盘；草稿保留。 */
  close(): void;
  /** The open target, or null when closed. */
  /** 当前打开的目标；关闭时为 null。 */
  target: CommentTarget | null;
  /** Bar plus keyboard height in px while open, 0 when closed, for the page's bottom spacer. */
  /** 打开时评论栏加键盘的高度（像素），关闭时为 0，供页面底部留白使用。 */
  inset: number;
}

/**
 * Put this attribute on controls that open the bar for another target while it may already be open: a comment
 * row, the pill's 评论, a notice's 回复. Pressing one then keeps the textarea focused and the keyboard up, and its
 * tap simply retargets the bar; pressing anything else outside the bar closes it first.
 * 把这个属性加在可能在评论栏已打开时为另一个目标打开它的控件上：评论行、浮条中的「评论」、消息中的「回复」。按下这些控件时
 * 输入框保持焦点、键盘不收起，点击只是切换评论栏的目标；按下评论栏外的其他地方会先关闭评论栏。
 */
export const COMMENT_BAR_KEEP_ATTRIBUTE = 'data-comment-bar-keep';

/** Spread onto such a control: {...commentBarKeepProps}. */
/** 展开到这类控件上：{...commentBarKeepProps}。 */
export const commentBarKeepProps = { [COMMENT_BAR_KEEP_ATTRIBUTE]: '' } as const;

/** What the mounted host does for the controller. */
/** 已挂载的评论栏为控制器提供的操作。 */
export interface CommentBarHandle {
  open(target: CommentTarget): void;
  close(): void;
}

interface CommentBarState {
  target: CommentTarget | null;
  inset: number;
}

/** Written only by the mounted host; screens read it through useCommentBar(). */
/** 只由已挂载的评论栏写入；页面通过 useCommentBar() 读取。 */
export const useCommentBarState = create<CommentBarState>()(() => ({ target: null, inset: 0 }));

let host: CommentBarHandle | null = null;

/**
 * Called by CommentBarHost while it is mounted. A second host replaces the first (one per page); the returned
 * function unregisters and leaves the bar closed.
 * 由 CommentBarHost 在挂载期间调用。第二个挂载的会替换第一个（每个页面一个）；返回的函数取消登记，并让评论栏保持关闭。
 */
export function registerCommentBarHost(handle: CommentBarHandle): () => void {
  host = handle;
  return () => {
    if (host !== handle) return;
    host = null;
    useCommentBarState.setState({ target: null, inset: 0 });
  };
}

function openBar(target: CommentTarget): void {
  host?.open(target);
}

function closeBar(): void {
  host?.close();
}

/** The page's comment bar, shared by every card, viewer and notice row under one CommentBarHost. */
/** 页面上的评论栏，同一个 CommentBarHost 下的所有卡片、查看器和消息行共用。 */
export function useCommentBar(): CommentBarController {
  const target = useCommentBarState((s) => s.target);
  const inset = useCommentBarState((s) => s.inset);
  return useMemo(() => ({ open: openBar, close: closeBar, target, inset }), [target, inset]);
}

/* Drafts */
/* 草稿 */

/** Drafts kept for the session; the least recently written one goes first. */
/** 本次会话保留的草稿数上限；最久未写入的先被丢弃。 */
const DRAFTS_MAX = 50;

const drafts = new Map<string, string>();

export function commentDraftKey(postId: string, replyToCommentId: string | null): string {
  return `${postId}:${replyToCommentId ?? ''}`;
}

export function targetDraftKey(target: Pick<CommentTarget, 'postId' | 'replyTo'>): string {
  return commentDraftKey(target.postId, target.replyTo?.commentId ?? null);
}

export function readCommentDraft(key: string): string {
  return drafts.get(key) ?? '';
}

/** Saves the text under the key; blank text removes the draft. */
/** 把文字保存在该键下；空白文字会删除草稿。 */
export function writeCommentDraft(key: string, text: string): void {
  drafts.delete(key);
  if (!text.trim()) return;
  drafts.set(key, text);
  if (drafts.size <= DRAFTS_MAX) return;
  const oldest = drafts.keys().next().value;
  if (oldest !== undefined) drafts.delete(oldest);
}

/** Drops every saved comment draft; called on sign-out. */
/** 清除所有已保存的评论草稿；退出登录时调用。 */
export function clearCommentDrafts(): void {
  drafts.clear();
}

// A sign-out, an expired session or another member signing in drops the drafts even if the feed store is not loaded.
// 退出登录、会话过期或换成其他成员登录时清除草稿，即使动态 store 尚未加载。
useSessionStore.subscribe((state, prev) => {
  if (!state.token || state.member?.id !== prev.member?.id) clearCommentDrafts();
});
