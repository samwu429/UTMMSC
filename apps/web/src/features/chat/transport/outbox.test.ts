import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedChatMessage, SendFrame } from '@utmmsc/shared';
import { ACK_TIMEOUT_MS, FLUSH_SPACING_MS, Outbox, ackedClientIds, buildSendFrame, type OutboxTransport } from './outbox';

interface Harness {
  outbox: Outbox;
  sent: SendFrame[];
  revoked: string[];
  uploads: { resolve(key: string): void; reject(error: unknown): void; signal: AbortSignal; progress(fraction: number): void }[];
  transport: OutboxTransport;
  network: { online: boolean };
}

function harness(): Harness {
  let seq = 0;
  const sent: SendFrame[] = [];
  const revoked: string[] = [];
  const uploads: Harness['uploads'] = [];
  const network = { online: true };
  const transport: OutboxTransport = {
    send: (frame) => {
      sent.push(frame);
      return true;
    },
    upload: (_file, { signal, onProgress }) =>
      new Promise<string>((resolve, reject) => {
        uploads.push({ resolve, reject, signal, progress: onProgress });
      }),
    online: () => network.online,
  };
  const outbox = new Outbox({
    timeoutText: () => 'Message not sent',
    uncertainText: () => 'May not have been sent',
    uploadFailureText: () => 'Upload failed',
    revokeUrl: (url) => revoked.push(url),
    makeClientId: () => `c${++seq}`,
  });
  return { outbox, sent, revoked, uploads, transport, network };
}

function image(localUrl = 'blob:one') {
  return { file: new Blob(['x'], { type: 'image/png' }), localUrl, width: 640, height: 480 };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('flushing', () => {
  it('spaces sends at least 900ms apart', () => {
    const { outbox, sent, transport } = harness();
    outbox.enqueue({ text: 'a' });
    outbox.enqueue({ text: 'b' });
    outbox.enqueue({ text: 'c' });
    const link = outbox.attach(transport);
    expect(sent).toHaveLength(0);
    link.setReady(true);
    expect(sent.map((f) => f.text)).toEqual(['a']);
    vi.advanceTimersByTime(FLUSH_SPACING_MS - 1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent.map((f) => f.text)).toEqual(['a', 'b']);
    vi.advanceTimersByTime(FLUSH_SPACING_MS);
    expect(sent.map((f) => f.text)).toEqual(['a', 'b', 'c']);
  });

  it('sends nothing extra when flushed twice in a row', () => {
    const { outbox, sent, transport } = harness();
    outbox.enqueue({ text: 'a' });
    outbox.enqueue({ text: 'b' });
    const stale = outbox.attach(transport);
    const link = outbox.attach(transport);
    stale.setReady(true);
    expect(sent).toHaveLength(0);
    link.setReady(true);
    link.setReady(true);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(FLUSH_SPACING_MS);
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(FLUSH_SPACING_MS * 3);
    expect(sent).toHaveLength(2);
  });

  it('waits while not ready and keeps items across a detach', () => {
    const { outbox, sent, transport } = harness();
    const first = outbox.attach(transport);
    outbox.enqueue({ text: 'a' });
    expect(outbox.list()[0]?.status).toBe('queued');
    first.detach();
    const second = outbox.attach(transport);
    // The old link can no longer stall or detach the new one.
    // 旧链接再也无法卡住或解绑新链接。
    first.setReady(false);
    first.detach();
    second.setReady(true);
    expect(sent).toHaveLength(1);
  });
});

describe('acks and failures', () => {
  it('removes an item when its clientId is confirmed and revokes its blob URL', () => {
    const { outbox, revoked, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    const id = outbox.enqueue({ text: '', image: { ...image('blob:a'), imageKey: 'chat/k.png' } });
    expect(outbox.ack('unknown')).toBe(false);
    expect(outbox.ack(id)).toBe(true);
    expect(outbox.list()).toHaveLength(0);
    expect(revoked).toEqual(['blob:a']);
  });

  it('fails only the item named by an error', () => {
    const { outbox, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    const a = outbox.enqueue({ text: 'a' });
    outbox.enqueue({ text: 'b' });
    vi.advanceTimersByTime(FLUSH_SPACING_MS);
    expect(outbox.fail(a, 'You are sending too fast.')).toBe(true);
    const [first, second] = outbox.list();
    expect(first).toMatchObject({ status: 'failed', failure: 'You are sending too fast.' });
    expect(second?.status).toBe('sending');
  });

  it('times out after 12s, counting only while ready', () => {
    const { outbox, sent, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    outbox.enqueue({ text: 'a' });
    vi.advanceTimersByTime(6_000);
    link.setReady(false);
    expect(outbox.list()[0]?.status).toBe('queued');
    vi.advanceTimersByTime(60_000);
    expect(outbox.list()[0]?.status).toBe('queued');
    link.setReady(true);
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(ACK_TIMEOUT_MS - 1);
    expect(outbox.list()[0]?.status).toBe('sending');
    vi.advanceTimersByTime(1);
    expect(outbox.list()[0]).toMatchObject({ status: 'failed', failure: 'Message not sent' });
  });

  it('stops the ack clock while the page is hidden', () => {
    const { outbox, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    outbox.enqueue({ text: 'a' });
    vi.advanceTimersByTime(5_000);
    link.setVisible(false);
    vi.advanceTimersByTime(60_000);
    expect(outbox.list()[0]?.status).toBe('sending');
    link.setVisible(true);
    vi.advanceTimersByTime(ACK_TIMEOUT_MS - 5_000 - 1);
    expect(outbox.list()[0]?.status).toBe('sending');
    vi.advanceTimersByTime(1);
    expect(outbox.list()[0]).toMatchObject({ status: 'failed', failure: 'Message not sent' });
  });

  it('queues a timed-out item again when the socket drops, but not one the server refused', () => {
    const { outbox, sent, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    const timedOut = outbox.enqueue({ text: 'a' });
    vi.advanceTimersByTime(ACK_TIMEOUT_MS);
    const refused = outbox.enqueue({ text: 'b' });
    outbox.fail(refused, 'You are muted.');
    expect(outbox.list().map((p) => p.status)).toEqual(['failed', 'failed']);
    link.setReady(false);
    expect(outbox.list()).toMatchObject([
      { clientId: timedOut, status: 'queued', failure: null },
      { clientId: refused, status: 'failed', failure: 'You are muted.' },
    ]);
    link.setReady(true);
    vi.advanceTimersByTime(FLUSH_SPACING_MS);
    expect(sent.filter((f) => f.clientId === timedOut)).toHaveLength(2);
    expect(sent.filter((f) => f.clientId === refused)).toHaveLength(1);
  });

  it('drops a quote whose message was withdrawn and sends without it', () => {
    const { outbox, sent, transport } = harness();
    const id = outbox.enqueue({ text: 'reply', replyTo: { id: 4, authorId: 'm2', authorName: 'B', excerpt: 'secret', hasImage: false, state: 'ok' } });
    outbox.dropQuote(4);
    expect(outbox.list()[0]?.replyTo).toBeNull();
    const link = outbox.attach(transport);
    link.setReady(true);
    expect(sent[0]).toEqual({ type: 'send', clientId: id, text: 'reply' });
  });

  it('retries under the same clientId without the quote after the server refuses it', () => {
    const { outbox, sent, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    const id = outbox.enqueue({ text: 'reply', replyTo: { id: 4, authorId: 'm2', authorName: 'B', excerpt: 'x', hasImage: false, state: 'ok' } });
    expect(sent[0]?.replyToId).toBe(4);
    vi.advanceTimersByTime(FLUSH_SPACING_MS);
    expect(outbox.retryWithoutQuote(id)).toBe(true);
    expect(sent[1]).toEqual({ type: 'send', clientId: id, text: 'reply' });
    expect(outbox.list()[0]).toMatchObject({ status: 'sending', replyTo: null, failure: null });
  });

  it('leaves a send an old server never answered to the member instead of sending it twice', () => {
    const { outbox, sent, transport } = harness();
    const link = outbox.attach(transport);
    link.setCapable(false);
    link.setReady(true);
    const lost = outbox.enqueue({ text: 'hello' });
    vi.advanceTimersByTime(FLUSH_SPACING_MS);
    const timedOut = outbox.enqueue({ text: 'again' });
    vi.advanceTimersByTime(ACK_TIMEOUT_MS);
    outbox.ack(lost);
    const dropped = outbox.enqueue({ text: 'bye' });
    expect(outbox.list().map((p) => p.status)).toEqual(['failed', 'sending']);
    link.setReady(false);
    expect(outbox.list()).toMatchObject([
      { clientId: timedOut, status: 'failed', failure: 'Message not sent' },
      { clientId: dropped, status: 'failed', failure: 'May not have been sent' },
    ]);
    link.setReady(true);
    vi.advanceTimersByTime(FLUSH_SPACING_MS * 4);
    expect(sent.map((f) => f.text)).toEqual(['hello', 'again', 'bye']);
    outbox.resend(dropped);
    expect(sent.map((f) => f.text)).toEqual(['hello', 'again', 'bye', 'bye']);
  });

  it('fails a queued resend when the next server turns out to be old', () => {
    const { outbox, sent, transport } = harness();
    const link = outbox.attach(transport);
    link.setCapable(true);
    link.setReady(true);
    const id = outbox.enqueue({ text: 'hello' });
    link.setReady(false);
    expect(outbox.list()[0]?.status).toBe('queued');
    link.setCapable(false);
    expect(outbox.list()[0]).toMatchObject({ clientId: id, status: 'failed', failure: 'May not have been sent' });
    link.setReady(true);
    vi.advanceTimersByTime(FLUSH_SPACING_MS * 2);
    expect(sent).toHaveLength(1);
  });

  it('keeps a quote and mentions until the server that sends them is known to be old', () => {
    const { outbox, sent, transport } = harness();
    const quote = { id: 4, authorId: 'm2', authorName: 'B', excerpt: 'x', hasImage: false, state: 'ok' as const };
    const early = outbox.enqueue({ text: 'reply', replyTo: quote, mentions: ['m2'], mentionAll: true });
    const link = outbox.attach(transport);
    link.setCapable(true);
    link.setReady(true);
    expect(sent[0]).toEqual({ type: 'send', clientId: early, text: 'reply', replyToId: 4, mentions: ['m2'], mentionAll: true });

    const late = outbox.enqueue({ text: 'later', replyTo: quote, mentions: ['m2'] });
    link.setReady(false);
    link.setCapable(false);
    expect(outbox.list().find((p) => p.clientId === late)).toMatchObject({ status: 'queued', replyTo: null, mentions: [], mentionAll: false });
    link.setReady(true);
    vi.advanceTimersByTime(FLUSH_SPACING_MS);
    expect(sent.find((f) => f.clientId === late)).toEqual({ type: 'send', clientId: late, text: 'later' });
  });

  it('resends with the same clientId', () => {
    const { outbox, sent, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    const id = outbox.enqueue({ text: 'hello', mentions: ['m1', 'm1'], replyTo: { id: 4, authorId: 'm2', authorName: 'B', excerpt: 'x', hasImage: false, state: 'ok' } });
    outbox.fail(id, 'nope');
    vi.advanceTimersByTime(FLUSH_SPACING_MS);
    outbox.resend(id);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[1]).toEqual({ type: 'send', clientId: id, text: 'hello', replyToId: 4, mentions: ['m1'] });
  });
});

describe('images', () => {
  it('uploads, reports progress, then sends with the image key and size', async () => {
    const { outbox, sent, uploads, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    const id = outbox.enqueue({ text: '', image: image() });
    expect(outbox.list()[0]?.status).toBe('uploading');
    uploads[0]?.progress(0.5);
    expect(outbox.list()[0]?.image?.progress).toBe(0.5);
    uploads[0]?.resolve('chat/channel/x.png');
    await vi.runAllTimersAsync();
    expect(sent[0]).toEqual({ type: 'send', clientId: id, text: '', imageKey: 'chat/channel/x.png', imageWidth: 640, imageHeight: 480 });
  });

  it('uploads one image at a time, in order', async () => {
    const { outbox, uploads, transport } = harness();
    outbox.attach(transport);
    outbox.enqueue({ text: '', image: image('blob:1') });
    outbox.enqueue({ text: '', image: image('blob:2') });
    expect(uploads).toHaveLength(1);
    uploads[0]?.resolve('k1');
    await vi.runAllTimersAsync();
    expect(uploads).toHaveLength(2);
  });

  it('re-uploads on resend only when the image key is still missing', async () => {
    const { outbox, uploads, sent, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    const failedUpload = outbox.enqueue({ text: '', image: image('blob:1') });
    uploads[0]?.reject(new Error('offline'));
    await vi.runAllTimersAsync();
    expect(outbox.list()[0]).toMatchObject({ status: 'failed', failure: 'Upload failed' });
    outbox.resend(failedUpload);
    expect(uploads).toHaveLength(2);
    uploads[1]?.resolve('k1');
    await vi.runAllTimersAsync();
    expect(sent).toHaveLength(1);

    outbox.fail(failedUpload, 'rate limited');
    outbox.resend(failedUpload);
    await vi.runAllTimersAsync();
    expect(uploads).toHaveLength(2);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.imageKey).toBe('k1');
  });

  it('aborts and revokes on discard, and revokes everything on dispose', () => {
    const { outbox, uploads, revoked, transport } = harness();
    outbox.attach(transport);
    const a = outbox.enqueue({ text: '', image: image('blob:a') });
    outbox.enqueue({ text: '', image: image('blob:b') });
    outbox.discard(a);
    expect(uploads[0]?.signal.aborted).toBe(true);
    expect(revoked).toEqual(['blob:a']);
    outbox.dispose();
    expect(revoked).toEqual(['blob:a', 'blob:b']);
    expect(outbox.list()).toHaveLength(0);
  });

  it('waits for the network before uploading', async () => {
    const { outbox, uploads, sent, transport, network } = harness();
    network.online = false;
    const link = outbox.attach(transport);
    outbox.enqueue({ text: 'hi' });
    outbox.enqueue({ text: '', image: image() });
    expect(uploads).toHaveLength(0);
    expect(outbox.list()[1]).toMatchObject({ status: 'queued', image: { progress: 0, imageKey: null } });
    network.online = true;
    link.setReady(true);
    expect(uploads).toHaveLength(1);
    uploads[0]?.resolve('k1');
    await vi.runAllTimersAsync();
    expect(sent.map((f) => f.imageKey ?? f.text)).toEqual(['hi', 'k1']);
  });

  it('uploads again once the socket is back after a network failure, but not after a refusal', async () => {
    const { outbox, uploads, transport } = harness();
    const link = outbox.attach(transport);
    link.setReady(true);
    outbox.enqueue({ text: '', image: image('blob:1') });
    uploads[0]?.reject(new TypeError('Network request failed'));
    await vi.runAllTimersAsync();
    outbox.enqueue({ text: '', image: image('blob:2') });
    uploads[1]?.reject(new Error('too large'));
    await vi.runAllTimersAsync();
    expect(outbox.list().map((p) => p.status)).toEqual(['failed', 'failed']);
    link.setReady(true);
    expect(uploads).toHaveLength(2);
    link.setReady(false);
    link.setReady(true);
    expect(uploads).toHaveLength(3);
    expect(outbox.list().map((p) => p.status)).toEqual(['uploading', 'failed']);
  });

  it('puts an interrupted upload back in the queue on detach', () => {
    const { outbox, uploads, transport } = harness();
    const link = outbox.attach(transport);
    outbox.enqueue({ text: '', image: image() });
    link.detach();
    expect(uploads[0]?.signal.aborted).toBe(true);
    expect(outbox.list()[0]).toMatchObject({ status: 'queued', image: { progress: 0, imageKey: null } });
  });
});

describe('frames', () => {
  it('leaves out the quote and mentions for an old server', () => {
    const item = {
      clientId: 'c1',
      text: 'hi',
      replyTo: { id: 4, authorId: 'm2', authorName: 'B', excerpt: 'x', hasImage: false, state: 'ok' as const },
      mentions: ['m2'],
      mentionAll: true,
      image: { localUrl: '', width: 10, height: 20, progress: 1, imageKey: 'k' },
      status: 'queued' as const,
      failure: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    expect(buildSendFrame(item, false)).toEqual({ type: 'send', clientId: 'c1', text: 'hi', imageKey: 'k', imageWidth: 10, imageHeight: 20 });
    expect(buildSendFrame(item)).toMatchObject({ replyToId: 4, mentions: ['m2'], mentionAll: true });
  });

  it('omits invalid image sizes', () => {
    const frame = buildSendFrame({
      clientId: 'c1',
      text: '',
      replyTo: null,
      mentions: [],
      mentionAll: false,
      image: { localUrl: '', width: 0, height: 0, progress: 1, imageKey: 'k' },
      status: 'queued',
      failure: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(frame).toEqual({ type: 'send', clientId: 'c1', text: '', imageKey: 'k' });
  });

  it('finds acked client ids in echoes and in own history rows', () => {
    const own = { id: 3, clientId: 'c2' } as NormalizedChatMessage;
    const other = { id: 4, clientId: null } as NormalizedChatMessage;
    expect(ackedClientIds({ type: 'message', message: own, clientId: 'c2' })).toEqual(['c2']);
    expect(ackedClientIds({ type: 'history_result', messages: [own, other], hasMore: false, changed: [{ ...own, id: 5, clientId: 'c3' }] })).toEqual(['c2', 'c3']);
    expect(ackedClientIds({ type: 'pong' })).toEqual([]);
  });
});
