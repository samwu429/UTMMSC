import { canReviewApplications, canReviewYearRequests, type Role } from '@utmmsc/shared';
import { sectionPath } from '../sections';

/**
 * The 待审核 queue without the screens: which kinds a role reviews, the order items wait in, where each one lives,
 * which item opens after a decision, and how a batch of decisions runs. Pure, so it is tested without a browser.
 * 不含界面的「待审核」队列：某身份审核哪几类、事项的等待顺序、每一项的地址、做出决定后打开哪一项，以及一批决定如何执行。
 * 纯函数，无需浏览器即可测试。
 */

export const REVIEW_KINDS = ['applications', 'years'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

/** 入会申请 for anyone who approves members; 入学年份 for the system admin only, by the viewed role. */
/** 入会申请：能审核成员的人；入学年份：只有系统管理员，按当前视角的身份判断。 */
export function reviewKindsFor(role: Role): ReviewKind[] {
  const kinds: ReviewKind[] = [];
  if (canReviewApplications(role)) kinds.push('applications');
  if (canReviewYearRequests(role)) kinds.push('years');
  return kinds;
}

/** The kind in ?type=, or the first the role reviews when it is missing or not allowed. */
/** ?type= 中的类别；缺失或不允许时取该身份审核的第一类。 */
export function readReviewKind(raw: string | null, allowed: readonly ReviewKind[]): ReviewKind | null {
  const match = allowed.find((kind) => kind === raw);
  return match ?? allowed[0] ?? null;
}

export function reviewListPath(kind: ReviewKind): string {
  return `${sectionPath('review')}?type=${kind}`;
}

/** An item's own address. ?type= rides along, so the list beside or under it keeps its segment. */
/** 某一项自己的地址。附带 ?type=，旁边或下方的列表因此保持所在的分段。 */
export function reviewItemPath(kind: ReviewKind, id: string): string {
  return `${sectionPath('review')}/${kind}/${encodeURIComponent(id)}?type=${kind}`;
}

export function isReviewKind(value: string | undefined): value is ReviewKind {
  return value === 'applications' || value === 'years';
}

interface Waiting {
  id: string;
  createdAt: string;
}

/** Oldest first, so whoever waited longest is decided first; equal times keep a stable order by id. */
/** 最早的在前，等得最久的人先得到处理；时间相同时按 id 保持稳定的顺序。 */
export function oldestFirst<T extends Waiting>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    if (at !== bt) return (Number.isNaN(at) ? 0 : at) - (Number.isNaN(bt) ? 0 : bt);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The item to open once `id` is decided: the next one in the queue, or the one before it when `id` was last, or
 * null when it was the only one (or is not in the queue any more).
 * `id` 处理完之后要打开的一项：队列中的下一项；若 `id` 是最后一项则取前一项；若它是唯一的一项（或已不在队列中）则为 null。
 */
export function neighbourAfter<T extends { id: string }>(items: readonly T[], id: string): T | null {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  return items[index + 1] ?? items[index - 1] ?? null;
}

export function withoutId<T extends { id: string }>(items: readonly T[] | undefined, id: string): T[] | undefined {
  return items?.filter((item) => item.id !== id);
}

export interface BatchResult<T> {
  done: T[];
  failed: { item: T; error: unknown }[];
}

/**
 * Runs `task` for each item one after another, never two at once: every approval sends an email, and one failure
 * must not stop the rest. Reports progress after each item.
 * 逐个为每一项执行 `task`，绝不同时执行两项：每次通过都会发送邮件，而且一项失败不能让其余的停下。每处理完一项就报告进度。
 */
export async function runInOrder<T>(
  items: readonly T[],
  task: (item: T) => Promise<unknown>,
  onProgress?: (finished: number, total: number) => void,
): Promise<BatchResult<T>> {
  const result: BatchResult<T> = { done: [], failed: [] };
  for (const item of items) {
    try {
      await task(item);
      result.done.push(item);
    } catch (error) {
      result.failed.push({ item, error });
    }
    onProgress?.(result.done.length + result.failed.length, items.length);
  }
  return result;
}
