import type { AdminAnnouncementRow, AdminAnnouncementsResponse, AnnouncementResponse } from '@utmmsc/shared';
import { ApiClientError } from '../../../shared/api/errors';
import { plural, sectionPath, type Phrase } from '../sections';

/**
 * 公告 without the screens: addresses, the line under each sent announcement, the preview the send confirmation
 * shows, what the screen says after a send, and paging. Pure, so it is tested without a browser.
 * 不含界面的「公告」：地址、每条已发公告下方的一行、发送确认中显示的预览、发送之后界面说的话，以及分页。纯函数，无需浏览器即可测试。
 */

export const ANNOUNCEMENT_TITLE_MAX = 80;
export const ANNOUNCEMENT_BODY_MAX = 5000;
/** Lines of the message the send confirmation shows. */
/** 发送确认中显示的正文行数。 */
export const PREVIEW_LINES = 3;
const PREVIEW_CHARS = 240;

/** /admin/announcements/new is the compose screen, so no announcement id can be "new". */
/** /admin/announcements/new 是撰写界面，因此没有公告的 id 能是「new」。 */
export const NEW_ANNOUNCEMENT = 'new';

export function announcementsPath(id?: string | null): string {
  const base = sectionPath('announcements');
  return id ? `${base}/${encodeURIComponent(id)}` : base;
}

export function newAnnouncementPath(): string {
  return `${sectionPath('announcements')}/${NEW_ANNOUNCEMENT}`;
}

/**
 * The line under a sent announcement: when, who, and how it went out. 仅保存 says plainly that no member saw it.
 * The server records the email before the mail service answers, so the count is who it was addressed to, not who got it.
 * 已发公告下方的一行：何时、谁发的、如何发出。「仅保存」明确表示没有成员看到。
 * 服务器在邮件服务答复之前就记下了邮件，所以人数是收件人数，不是收到的人数。
 */
export function announcementMeta(row: AdminAnnouncementRow, relative: Phrase): Phrase {
  const sender: Phrase = row.sentBy ? { zh: row.sentBy.displayName, en: row.sentBy.displayName } : { zh: '已删除的成员', en: 'A removed member' };
  const how: Phrase = row.emailed ? { zh: `邮件 ${row.recipientCount} 人`, en: `Email to ${row.recipientCount}` } : { zh: '仅保存', en: 'Saved only' };
  return { zh: [relative.zh, sender.zh, how.zh].join(' · '), en: [relative.en, sender.en, how.en].join(' · ') };
}

/**
 * How it went out, for the announcement's own screen. Who it was sent to, and that delivery is not known here, since
 * the server does not keep what the mail service answered.
 * 发送方式，用于公告自己的界面。写明发给了谁，并说明这里不知道是否送达，因为服务器没有保存邮件服务的答复。
 */
export function deliveryText(row: AdminAnnouncementRow): Phrase {
  return row.emailed
    ? {
        zh: `发给 ${row.recipientCount} 位成员，这里看不到是否送达`,
        en: `To ${plural(row.recipientCount, 'member', 'members')}. Delivery isn't tracked here.`,
      }
    : { zh: '仅保存，没有发邮件，成员看不到', en: 'Saved only. No email was sent, so members did not see it.' };
}

/** The toast after a send: the mail has only started on its way, so it says so. */
/** 发送后的提示：邮件只是开始发出，因此照实说明。 */
export function sentToast(res: AnnouncementResponse): Phrase {
  return res.emailed
    ? { zh: `公告已保存，邮件正在发给 ${res.recipientCount} 位成员`, en: `Saved. Sending email to ${plural(res.recipientCount, 'member', 'members')}.` }
    : { zh: '公告已保存，没有发邮件', en: 'Announcement saved. No email was sent.' };
}

/**
 * Whether a send that failed may still have gone out. A 4xx means the server turned it down before sending anything.
 * A 5xx, or no answer at all because the connection dropped, does not say: the mail may already be on its way.
 * 失败的发送是否仍可能已经发出。4xx 表示服务器在发出任何内容之前就拒绝了。5xx，或因为连接中断根本没有答复，都说明不了什么：
 * 邮件可能已经在路上。
 */
export function sendMayHaveGoneOut(err: unknown): boolean {
  return !(err instanceof ApiClientError) || err.status >= 500;
}

/** What the compose screen says when a send may have gone out, so the admin checks before sending again. */
/** 发送可能已经发出时撰写界面显示的话，让管理员先查看再决定是否重发。 */
export function uncertainSendText(sendEmail: boolean): Phrase {
  return sendEmail
    ? { zh: '公告可能已发出，请先查看公告记录再重试。', en: 'It may have gone out. Check the history before trying again.' }
    : { zh: '公告可能已保存，请先查看公告记录再重试。', en: 'It may have been saved. Check the history before trying again.' };
}

/**
 * The first lines of the message, as the send confirmation shows them: blank lines dropped, at most PREVIEW_LINES
 * lines and PREVIEW_CHARS characters, with … when something was left out.
 * 发送确认中显示的正文开头：去掉空行，最多 PREVIEW_LINES 行、PREVIEW_CHARS 个字符，有内容被省略时加「…」。
 */
export function previewLines(body: string, lines = PREVIEW_LINES): string[] {
  const all = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const shown: string[] = [];
  let left = PREVIEW_CHARS;
  let cut = all.length > lines;
  for (const line of all.slice(0, lines)) {
    if (left <= 0) {
      cut = true;
      break;
    }
    const chars = Array.from(line);
    if (chars.length > left) {
      shown.push(chars.slice(0, left).join(''));
      cut = true;
      break;
    }
    shown.push(line);
    left -= chars.length;
  }
  if (cut && shown.length > 0) shown[shown.length - 1] = `${shown[shown.length - 1]}…`;
  return shown;
}

/** The title of the send confirmation; the count is left out while the summary has not given it. */
/** 发送确认的标题；摘要尚未给出人数时不写人数。 */
export function sendTitle(recipients: number | undefined): Phrase {
  return recipients === undefined
    ? { zh: '发送给全体在用成员？', en: 'Send to every active member?' }
    : { zh: `发送给 ${recipients} 位成员？`, en: `Send to ${plural(recipients, 'member', 'members')}?` };
}

export function emailSwitchLabel(recipients: number | undefined): Phrase {
  return recipients === undefined
    ? { zh: '发送邮件给全体在用成员', en: 'Email every active member' }
    : { zh: `发送邮件给全体在用成员（${recipients} 人）`, en: `Email every active member (${recipients})` };
}

/** One page of history after another, without repeats if a page boundary moved under a new announcement. */
/** 把历史记录逐页接起来；若新公告让分页边界移动，也不会出现重复。 */
export function appendAnnouncements(page: AdminAnnouncementsResponse, next: AdminAnnouncementsResponse): AdminAnnouncementsResponse {
  const seen = new Set(page.announcements.map((row) => row.id));
  return { announcements: [...page.announcements, ...next.announcements.filter((row) => !seen.has(row.id))], nextCursor: next.nextCursor };
}

/**
 * A fresh first page, followed by the older pages already loaded, so a reload does not drop them. They join only
 * when the loaded rows overlap the fresh page and reach past it; otherwise rows between the two could be missing,
 * and the fresh page alone is right. The joined history keeps the loaded cursor, which points past its last row.
 * 新的第一页，后面接上已加载的更早分页，重新加载时就不会把它们丢掉。只有当已加载的行与新的一页有重叠、并延伸到它之后时才接上；
 * 否则两者之间可能缺行，这时只用新的一页才对。接起来的记录沿用已加载的游标，它指向最后一行之后。
 */
export function keepLoadedPages(fresh: AdminAnnouncementsResponse, loaded: AdminAnnouncementsResponse | null | undefined): AdminAnnouncementsResponse {
  if (!loaded) return fresh;
  const ids = new Set(fresh.announcements.map((row) => row.id));
  const overlaps = loaded.announcements.some((row) => ids.has(row.id));
  const reachesPast = loaded.announcements.some((row) => !ids.has(row.id));
  if (!overlaps || !reachesPast) return fresh;
  return appendAnnouncements(fresh, { announcements: loaded.announcements, nextCursor: loaded.nextCursor });
}

export function canSendAnnouncement(title: string, body: string): boolean {
  return title.trim().length > 0 && body.trim().length > 0 && title.length <= ANNOUNCEMENT_TITLE_MAX && body.length <= ANNOUNCEMENT_BODY_MAX;
}
