import { describe, expect, it } from 'vitest';
import { LOCATION_MAX, MOMENT_COMMENT_MAX, MOMENT_MEDIA_DIMENSION_MAX, MOMENT_TEXT_MAX, MOMENT_VIDEO_DURATION_MAX_MS } from '@utmmsc/shared';
import { momentObjectKey } from '../profile/media';
import {
  MOMENT_INPUT_MESSAGES,
  MomentInputError,
  normalizeMomentMedia,
  readCreateMoment,
  readModerationReason,
  readMomentAudience,
  readMomentComment,
  readMomentLike,
  readMomentLocation,
  readMomentRelationPatch,
  readMomentReport,
  readResolveReport,
  readUpTo,
  type MomentInputErrorCode,
} from './input';

const MEMBER = 'mem_moments';
const CLIENT_ID = 'cid_0123456789';

function photo(extra: Record<string, unknown> = {}) {
  return { key: momentObjectKey(MEMBER, 'image/jpeg'), contentType: 'image/jpeg', ...extra };
}

function video(extra: Record<string, unknown> = {}) {
  return { key: momentObjectKey(MEMBER, 'video/mp4'), contentType: 'video/mp4', ...extra };
}

function preview(): string {
  return momentObjectKey(MEMBER, 'image/jpeg');
}

/** Runs `read` and returns the code it refused with, failing the test when it accepted the input. */
/** 执行 `read` 并返回拒绝时的错误码；若输入被接受则让测试失败。 */
function refusal(read: () => unknown): MomentInputErrorCode {
  try {
    read();
  } catch (error) {
    if (error instanceof MomentInputError) return error.code;
    throw error;
  }
  throw new Error('expected the input to be refused');
}

describe('MomentInputError', () => {
  it('carries the Chinese text of its code unless given one', () => {
    const error = new MomentInputError('empty_post');
    expect(error.message).toBe('写点什么，或加上照片、视频');
    expect(new MomentInputError('invalid_media', '最多 9 张照片').message).toBe('最多 9 张照片');
    for (const [code, message] of Object.entries(MOMENT_INPUT_MESSAGES)) {
      expect(new MomentInputError(code as MomentInputErrorCode).message).toBe(message);
    }
  });
});

describe('readCreateMoment', () => {
  it('normalizes text and keeps the audience, location and media', () => {
    const image = photo({ width: 1200, height: 900 });
    const input = readCreateMoment(MEMBER, {
      clientId: CLIENT_ID,
      text: '  第一行\r\n\r\n\r\n\r\n第二行  ',
      audience: 'club',
      location: '  多伦多  ',
      media: [image],
    });
    expect(input).toEqual({
      clientId: CLIENT_ID,
      text: '第一行\n\n\n第二行',
      audience: 'club',
      location: '多伦多',
      media: [{ key: image.key, contentType: 'image/jpeg', kind: 'image', width: 1200, height: 900, previewKey: null, durationMs: null }],
    });
  });

  it('accepts text alone, and media alone with empty text', () => {
    expect(readCreateMoment(MEMBER, { clientId: CLIENT_ID, text: 'hi', audience: 'friends' }).media).toEqual([]);
    const media = readCreateMoment(MEMBER, { clientId: CLIENT_ID, audience: 'private', media: [photo()] });
    expect(media.text).toBe('');
    expect(media.location).toBeNull();
  });

  it('refuses an empty post, counting whitespace and control characters as nothing', () => {
    expect(refusal(() => readCreateMoment(MEMBER, { clientId: CLIENT_ID, audience: 'friends' }))).toBe('empty_post');
    expect(refusal(() => readCreateMoment(MEMBER, { clientId: CLIENT_ID, text: ' \n\t\u0007 ', audience: 'friends', media: [] }))).toBe('empty_post');
  });

  it('counts the limit in code points', () => {
    const emoji = '\u{1F600}';
    expect(readCreateMoment(MEMBER, { clientId: CLIENT_ID, text: emoji.repeat(MOMENT_TEXT_MAX), audience: 'friends' }).text).toHaveLength(MOMENT_TEXT_MAX * 2);
    expect(refusal(() => readCreateMoment(MEMBER, { clientId: CLIENT_ID, text: 'a'.repeat(MOMENT_TEXT_MAX + 1), audience: 'friends' }))).toBe('text_too_long');
    expect(readCreateMoment(MEMBER, { clientId: CLIENT_ID, text: ` ${'a'.repeat(MOMENT_TEXT_MAX)} `, audience: 'friends' }).text).toHaveLength(MOMENT_TEXT_MAX);
  });

  it('refuses a bad client id, a text that is not a string and an unknown audience', () => {
    expect(refusal(() => readCreateMoment(MEMBER, { text: 'hi', audience: 'friends' }))).toBe('invalid_client_id');
    expect(refusal(() => readCreateMoment(MEMBER, { clientId: 'short', text: 'hi', audience: 'friends' }))).toBe('invalid_client_id');
    expect(refusal(() => readCreateMoment(MEMBER, { clientId: 'has space in it', text: 'hi', audience: 'friends' }))).toBe('invalid_client_id');
    expect(refusal(() => readCreateMoment(MEMBER, { clientId: CLIENT_ID, text: 42, audience: 'friends' }))).toBe('invalid_body');
    expect(refusal(() => readCreateMoment(MEMBER, { clientId: CLIENT_ID, text: 'hi' }))).toBe('invalid_audience');
    expect(refusal(() => readCreateMoment(MEMBER, { clientId: CLIENT_ID, text: 'hi', audience: 'public' }))).toBe('invalid_audience');
  });
});

describe('readMomentAudience', () => {
  it('accepts exactly the three audiences', () => {
    expect(readMomentAudience('friends')).toBe('friends');
    expect(readMomentAudience('club')).toBe('club');
    expect(readMomentAudience('private')).toBe('private');
    for (const value of ['Friends', 'all', '', null, undefined, 1, ['club']]) {
      expect(refusal(() => readMomentAudience(value))).toBe('invalid_audience');
    }
  });
});

describe('readMomentLocation', () => {
  it('trims to one line and treats empty as no location', () => {
    expect(readMomentLocation('  Mississauga\n Campus  ')).toBe('Mississauga Campus');
    expect(readMomentLocation('   ')).toBeNull();
    expect(readMomentLocation('')).toBeNull();
    expect(readMomentLocation(null)).toBeNull();
    expect(readMomentLocation(undefined)).toBeNull();
  });

  it('allows LOCATION_MAX characters and no more', () => {
    expect(readMomentLocation('地'.repeat(LOCATION_MAX))).toHaveLength(LOCATION_MAX);
    expect(refusal(() => readMomentLocation('地'.repeat(LOCATION_MAX + 1)))).toBe('location_too_long');
    expect(refusal(() => readMomentLocation(12))).toBe('invalid_body');
  });
});

describe('normalizeMomentMedia', () => {
  it('keeps sizes, a video duration and an own JPEG preview', () => {
    const previewKey = preview();
    const clip = video({ width: 1080, height: 1920, durationMs: 15_000, previewKey });
    expect(normalizeMomentMedia(MEMBER, [clip])).toEqual([
      { key: clip.key, contentType: 'video/mp4', kind: 'video', width: 1080, height: 1920, previewKey, durationMs: 15_000 },
    ]);
  });

  it('reads missing sizes as null, so legacy clients still post', () => {
    const image = photo();
    expect(normalizeMomentMedia(MEMBER, [image])).toEqual([
      { key: image.key, contentType: 'image/jpeg', kind: 'image', width: null, height: null, previewKey: null, durationMs: null },
    ]);
    expect(normalizeMomentMedia(MEMBER, undefined)).toEqual([]);
    expect(normalizeMomentMedia(MEMBER, null)).toEqual([]);
  });

  it('accepts the size and duration bounds and refuses anything past them', () => {
    expect(normalizeMomentMedia(MEMBER, [photo({ width: 1, height: MOMENT_MEDIA_DIMENSION_MAX })])[0]?.height).toBe(MOMENT_MEDIA_DIMENSION_MAX);
    expect(normalizeMomentMedia(MEMBER, [video({ durationMs: 0 })])[0]?.durationMs).toBe(0);
    expect(normalizeMomentMedia(MEMBER, [video({ durationMs: MOMENT_VIDEO_DURATION_MAX_MS })])[0]?.durationMs).toBe(MOMENT_VIDEO_DURATION_MAX_MS);
    const bad: Record<string, unknown>[] = [
      { width: 0, height: 10 },
      { width: 10, height: MOMENT_MEDIA_DIMENSION_MAX + 1 },
      { width: 10.5, height: 10 },
      { width: '10', height: 10 },
      { width: 10 },
      { height: 10 },
      { width: Number.NaN, height: 10 },
    ];
    for (const size of bad) expect(refusal(() => normalizeMomentMedia(MEMBER, [photo(size)]))).toBe('invalid_media_size');
    expect(refusal(() => normalizeMomentMedia(MEMBER, [video({ durationMs: -1 })]))).toBe('invalid_media_size');
    expect(refusal(() => normalizeMomentMedia(MEMBER, [video({ durationMs: MOMENT_VIDEO_DURATION_MAX_MS + 1 })]))).toBe('invalid_media_size');
    expect(refusal(() => normalizeMomentMedia(MEMBER, [video({ durationMs: 1.5 })]))).toBe('invalid_media_size');
  });

  it('allows a duration on a video only', () => {
    expect(refusal(() => normalizeMomentMedia(MEMBER, [photo({ durationMs: 1000 })]))).toBe('invalid_media_size');
  });

  it('needs the preview to be the member’s own JPEG', () => {
    expect(refusal(() => normalizeMomentMedia(MEMBER, [photo({ previewKey: momentObjectKey('mem_other', 'image/jpeg') })]))).toBe('invalid_preview');
    expect(refusal(() => normalizeMomentMedia(MEMBER, [photo({ previewKey: momentObjectKey(MEMBER, 'image/png') })]))).toBe('invalid_preview');
    expect(refusal(() => normalizeMomentMedia(MEMBER, [photo({ previewKey: `moments/${MEMBER}/../x.jpg` })]))).toBe('invalid_preview');
    expect(refusal(() => normalizeMomentMedia(MEMBER, [photo({ previewKey: 7 })]))).toBe('invalid_preview');
  });

  it('refuses a video with photos, ten photos and other members’ files with the existing messages', () => {
    const error = (() => {
      try {
        normalizeMomentMedia(MEMBER, [photo(), video()]);
      } catch (caught) {
        return caught as MomentInputError;
      }
      return null;
    })();
    expect(error?.code).toBe('invalid_media');
    expect(error?.message).toMatch(/不能发在同一条/);
    const ten = Array.from({ length: 10 }, () => photo());
    expect(() => normalizeMomentMedia(MEMBER, ten)).toThrow(/9/);
    expect(refusal(() => normalizeMomentMedia(MEMBER, ten))).toBe('invalid_media');
    expect(refusal(() => normalizeMomentMedia(MEMBER, [video(), video()]))).toBe('invalid_media');
    expect(refusal(() => normalizeMomentMedia(MEMBER, [{ key: momentObjectKey('mem_other', 'image/jpeg'), contentType: 'image/jpeg' }]))).toBe('invalid_media');
    expect(refusal(() => normalizeMomentMedia(MEMBER, 'not a list'))).toBe('invalid_media');
    expect(normalizeMomentMedia(MEMBER, Array.from({ length: 9 }, () => photo()))).toHaveLength(9);
  });
});

describe('readMomentComment', () => {
  it('flattens a comment to one line', () => {
    expect(readMomentComment({ clientId: CLIENT_ID, text: '  好\n看\t\t的  照片 ' })).toEqual({ clientId: CLIENT_ID, text: '好 看 的 照片', replyToCommentId: null });
    expect(readMomentComment({ clientId: CLIENT_ID, text: 'ok', replyToCommentId: 'pcm_abc' }).replyToCommentId).toBe('pcm_abc');
    expect(readMomentComment({ clientId: CLIENT_ID, text: 'ok', replyToCommentId: null }).replyToCommentId).toBeNull();
  });

  it('needs 1 to MOMENT_COMMENT_MAX code points', () => {
    expect(refusal(() => readMomentComment({ clientId: CLIENT_ID, text: '   ' }))).toBe('empty_comment');
    expect(refusal(() => readMomentComment({ clientId: CLIENT_ID }))).toBe('empty_comment');
    expect(readMomentComment({ clientId: CLIENT_ID, text: '\u{1F44D}'.repeat(MOMENT_COMMENT_MAX) }).text).toHaveLength(MOMENT_COMMENT_MAX * 2);
    expect(refusal(() => readMomentComment({ clientId: CLIENT_ID, text: 'a'.repeat(MOMENT_COMMENT_MAX + 1) }))).toBe('comment_too_long');
  });

  it('refuses a bad client id and a malformed reply target', () => {
    expect(refusal(() => readMomentComment({ text: 'hi' }))).toBe('invalid_client_id');
    expect(refusal(() => readMomentComment({ clientId: CLIENT_ID, text: ['hi'] }))).toBe('invalid_body');
    expect(refusal(() => readMomentComment({ clientId: CLIENT_ID, text: 'hi', replyToCommentId: 5 }))).toBe('invalid_body');
    expect(refusal(() => readMomentComment({ clientId: CLIENT_ID, text: 'hi', replyToCommentId: '' }))).toBe('invalid_body');
  });

  it('never reads the member answered from the body', () => {
    const input = readMomentComment({ clientId: CLIENT_ID, text: 'hi', replyToMemberId: 'mem_x', replyTo: { id: 'mem_x' } });
    expect(input).toEqual({ clientId: CLIENT_ID, text: 'hi', replyToCommentId: null });
  });
});

describe('readMomentLike', () => {
  it('takes the desired state as a boolean only', () => {
    expect(readMomentLike({ liked: true })).toBe(true);
    expect(readMomentLike({ liked: false })).toBe(false);
    for (const liked of [undefined, null, 1, 'true']) expect(refusal(() => readMomentLike({ liked }))).toBe('invalid_like');
  });
});

describe('readMomentRelationPatch', () => {
  it('keeps the fields present', () => {
    expect(readMomentRelationPatch({ hideFrom: true })).toEqual({ hideFrom: true });
    expect(readMomentRelationPatch({ mute: false })).toEqual({ mute: false });
    expect(readMomentRelationPatch({ hideFrom: false, mute: true, other: 1 })).toEqual({ hideFrom: false, mute: true });
  });

  it('needs at least one boolean', () => {
    expect(refusal(() => readMomentRelationPatch({}))).toBe('invalid_relation');
    expect(refusal(() => readMomentRelationPatch({ hideFrom: 'yes' }))).toBe('invalid_relation');
    expect(refusal(() => readMomentRelationPatch({ mute: null }))).toBe('invalid_relation');
  });
});

describe('readMomentReport', () => {
  it('reads a report on a post or a comment', () => {
    expect(readMomentReport({ postId: 'post_1', reason: 'spam' })).toEqual({ postId: 'post_1', commentId: null, reason: 'spam', note: null });
    expect(readMomentReport({ postId: 'post_1', commentId: 'pcm_1', reason: 'other', note: '  请看看  ' })).toEqual({
      postId: 'post_1',
      commentId: 'pcm_1',
      reason: 'other',
      note: '请看看',
    });
    expect(readMomentReport({ postId: 'post_1', reason: 'privacy', note: '   ' }).note).toBeNull();
  });

  it('refuses an unknown reason, a long note and a missing post', () => {
    expect(refusal(() => readMomentReport({ postId: 'post_1', reason: 'rude' }))).toBe('invalid_report_reason');
    expect(refusal(() => readMomentReport({ postId: 'post_1' }))).toBe('invalid_report_reason');
    expect(refusal(() => readMomentReport({ postId: 'post_1', reason: 'spam', note: 'a'.repeat(201) }))).toBe('report_note_too_long');
    expect(readMomentReport({ postId: 'post_1', reason: 'spam', note: 'a'.repeat(200) }).note).toHaveLength(200);
    expect(refusal(() => readMomentReport({ reason: 'spam' }))).toBe('invalid_body');
    expect(refusal(() => readMomentReport({ postId: 'post_1', commentId: 3, reason: 'spam' }))).toBe('invalid_body');
    expect(refusal(() => readMomentReport({ postId: 'post_1', reason: 'spam', note: 3 }))).toBe('invalid_body');
  });
});

describe('moderation input', () => {
  it('needs a one-line reason of 1 to 200 characters', () => {
    expect(readModerationReason({ reason: '  广告\n内容 ' })).toBe('广告 内容');
    expect(refusal(() => readModerationReason({}))).toBe('missing_moderation_reason');
    expect(refusal(() => readModerationReason({ reason: '  ' }))).toBe('missing_moderation_reason');
    expect(refusal(() => readModerationReason({ reason: 'a'.repeat(201) }))).toBe('moderation_reason_too_long');
  });

  it('reads a resolve action, needing a reason only to remove', () => {
    expect(readResolveReport({ action: 'remove', reason: '违规' })).toEqual({ action: 'remove', reason: '违规' });
    expect(readResolveReport({ action: 'dismiss', reason: 'ignored' })).toEqual({ action: 'dismiss', reason: null });
    expect(refusal(() => readResolveReport({ action: 'remove' }))).toBe('missing_moderation_reason');
    expect(refusal(() => readResolveReport({ action: 'delete' }))).toBe('invalid_resolve_action');
  });
});

describe('readUpTo', () => {
  it('returns a valid ISO instant in toISOString form', () => {
    expect(readUpTo({ upTo: '2026-10-24T08:15:30.123Z' })).toBe('2026-10-24T08:15:30.123Z');
    expect(readUpTo({ upTo: '2026-10-24T16:15:30+08:00' })).toBe('2026-10-24T08:15:30.000Z');
    expect(readUpTo({ upTo: '2026-10-24T08:15Z' })).toBe('2026-10-24T08:15:00.000Z');
  });

  it('refuses anything else', () => {
    for (const upTo of [undefined, '', 'yesterday', '2026-10-24', '2026-13-01T00:00:00Z', 'Oct 24 2026 08:15', 1761293730123]) {
      expect(refusal(() => readUpTo({ upTo }))).toBe('invalid_time');
    }
  });
});
