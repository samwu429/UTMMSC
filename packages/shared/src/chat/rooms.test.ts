import { describe, expect, it } from 'vitest';
import {
  CHANNEL_AUDIENCES,
  DEFAULT_HISTORY_VISIBILITY,
  HISTORY_VISIBILITIES,
  HISTORY_VISIBILITY_LABELS,
  channelRoomId,
  directRoomId,
  orderedPair,
  parseRoomId,
} from './rooms';

describe('history visibility', () => {
  it('defaults to the WeChat rule', () => {
    expect(DEFAULT_HISTORY_VISIBILITY).toBe('since_join');
    expect(HISTORY_VISIBILITIES).toContain(DEFAULT_HISTORY_VISIBILITY);
  });

  it('labels every option in both languages', () => {
    for (const option of HISTORY_VISIBILITIES) {
      expect(HISTORY_VISIBILITY_LABELS[option].zh.length).toBeGreaterThan(0);
      expect(HISTORY_VISIBILITY_LABELS[option].en.length).toBeGreaterThan(0);
    }
  });
});

describe('room ids', () => {
  it('round-trips channel and direct ids', () => {
    expect(parseRoomId(channelRoomId('ch_1'))).toEqual({ kind: 'channel', id: 'ch_1' });
    expect(parseRoomId(directRoomId('dm_1'))).toEqual({ kind: 'direct', id: 'dm_1' });
  });

  it('rejects unknown kinds and empty ids', () => {
    expect(parseRoomId('group:x')).toBeNull();
    expect(parseRoomId('channel:')).toBeNull();
    expect(parseRoomId('nocolon')).toBeNull();
  });

  it('orders a pair canonically', () => {
    expect(orderedPair('b', 'a')).toEqual(['a', 'b']);
    expect(orderedPair('a', 'b')).toEqual(['a', 'b']);
  });

  it('keeps custom as the only audience that needs membership rows', () => {
    expect(CHANNEL_AUDIENCES.filter((audience) => audience === 'custom')).toHaveLength(1);
  });
});
