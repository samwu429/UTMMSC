import { describe, expect, it } from 'vitest';
import { notificationCardVariant, type CardInput } from './card';

const base: CardInput = { capability: 'webpush', device: 'off', serverReady: true, dismissed: false };

describe('notificationCardVariant', () => {
  it('offers to turn notifications on in a browser that is off', () => {
    expect(notificationCardVariant(base)).toBe('enable');
  });

  it('stays hidden once closed', () => {
    expect(notificationCardVariant({ ...base, dismissed: true })).toBeNull();
    expect(notificationCardVariant({ ...base, capability: 'ios-install', dismissed: true })).toBeNull();
    expect(notificationCardVariant({ ...base, capability: 'native', dismissed: true })).toBeNull();
  });

  it('stays hidden when on, blocked, failed or still checking', () => {
    for (const device of ['on', 'denied', 'failed', 'checking'] as const) {
      expect(notificationCardVariant({ ...base, device })).toBeNull();
      expect(notificationCardVariant({ ...base, capability: 'native', device })).toBeNull();
    }
    expect(notificationCardVariant({ ...base, capability: null })).toBeNull();
  });

  it('waits until the server can send Web Push before asking a browser', () => {
    expect(notificationCardVariant({ ...base, serverReady: false })).toBeNull();
    expect(notificationCardVariant({ ...base, serverReady: null })).toBeNull();
    expect(notificationCardVariant({ ...base, capability: 'ios-install', serverReady: false })).toBeNull();
  });

  it('explains home-screen install on iPhone', () => {
    expect(notificationCardVariant({ ...base, capability: 'ios-install' })).toBe('install');
  });

  it('offers the app its own switch, which does not depend on Web Push', () => {
    expect(notificationCardVariant({ ...base, capability: 'native', serverReady: null })).toBe('enable');
  });

  it('never shows where notifications cannot work', () => {
    for (const capability of ['native-unavailable', 'ios-update', 'unsupported'] as const) {
      expect(notificationCardVariant({ ...base, capability })).toBeNull();
    }
  });
});
