import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MomentNotice } from '@utmmsc/shared';
import { COMMENT_BAR_KEEP_ATTRIBUTE } from '../comment/useCommentBar';
import { NoticeRow } from './NoticeRow';

function notice(patch: Partial<MomentNotice> & { preview?: MomentNotice['post']['preview'] } = {}): MomentNotice {
  const { preview = null, ...rest } = patch;
  return {
    id: 'mnt_1',
    kind: 'comment',
    createdAt: '2026-10-24T10:00:00.000Z',
    read: false,
    actor: { id: 'bob', displayName: 'Bob', avatarKey: null },
    post: { id: 'post_1', excerpt: '今天', preview, available: true, clubWide: false },
    comment: { id: 'pcm_1', body: '好看', replyTo: null },
    ...rest,
  };
}

/** The row as the server renders it, inside a router for the avatar link. */
/** 服务端渲染出的这一行，放在路由中以便渲染头像链接。 */
function render(value: MomentNotice, mediaToken: string | null = 'tok'): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(NoticeRow, { notice: value, mediaToken, onOpen: () => undefined, onReply: () => undefined })),
  );
}

const images = (html: string) => [...html.matchAll(/<img [^>]*src="([^"]*)"/g)].map((match) => decodeURIComponent(match[1] ?? ''));

describe('NoticeRow', () => {
  // The router's layout effects warn on every server render; the rows themselves are what is checked.
  // 路由的 layout effect 在每次服务端渲染时都会警告；这里检查的是消息行本身。
  beforeEach(() => {
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a video without a preview as the dark tile with the play glyph, never the video file', () => {
    const html = render(notice({ preview: { key: null, kind: 'video' } }));
    expect(images(html)).toEqual([]);
    expect(html).toContain('bg-stone-800');
  });

  it('loads the preview image when there is one', () => {
    const html = render(notice({ preview: { key: 'moments/alice/med_vp.jpg', kind: 'video' } }));
    expect(images(html).some((src) => src.includes('moments/alice/med_vp.jpg'))).toBe(true);
  });

  it('keeps an open comment bar when 回复 is pressed, as comment rows do', () => {
    const html = render(notice());
    const reply = html.match(/<button[^>]*aria-label="回复 Bob"[^>]*>/)?.[0] ?? '';
    expect(reply).toContain(`${COMMENT_BAR_KEEP_ATTRIBUTE}=""`);
    const whole = html.match(/<button[^>]*class="absolute inset-0[^>]*>/)?.[0] ?? '';
    expect(whole).not.toContain(COMMENT_BAR_KEEP_ATTRIBUTE);
  });
});
