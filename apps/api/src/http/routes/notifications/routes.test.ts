import { describe, expect, it } from 'vitest';
import { ApiHttpError } from '../../errors';
import { notificationRoutes, readDeviceRegistration, readWebPushEndpoint } from './index';

const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ApiHttpError ? err.code : 'other';
  }
}

describe('notification routes', () => {
  const paths = notificationRoutes.routes.map((route) => `${route.method} ${route.path}`);

  it('exposes the key, devices, prefs and test routes', () => {
    expect(paths).toContain('GET /vapid-key');
    expect(paths).toContain('POST /devices');
    expect(paths).toContain('DELETE /devices');
    expect(paths).toContain('GET /prefs');
    expect(paths).toContain('PATCH /prefs');
    expect(paths).toContain('POST /test');
  });
});

describe('readDeviceRegistration', () => {
  it('accepts a browser subscription and an FCM token', () => {
    expect(readDeviceRegistration({ kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys, platform: 'android-chrome' })).toEqual({
      kind: 'webpush',
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys,
      platform: 'android-chrome',
    });
    expect(readDeviceRegistration({ kind: 'fcm', token: 'dGVzdA:APA91bH-x_y.z' })).toEqual({ kind: 'fcm', endpoint: 'dGVzdA:APA91bH-x_y.z', keys: null, platform: null });
  });

  it('accepts padded keys and drops an unusable platform label', () => {
    const padded = { p256dh: keys.p256dh, auth: `${keys.auth}==` };
    expect(readDeviceRegistration({ kind: 'webpush', endpoint: 'https://web.push.apple.com/x', keys: padded, platform: '<script>' }).platform).toBeNull();
  });

  it('refuses endpoints that are not https, too long, or carry credentials', () => {
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'http://push.example/x', keys }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'https://user:pw@push.example/x', keys }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: `https://push.example/${'a'.repeat(1000)}`, keys }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'not a url', keys }))).toBe('invalid_device');
  });

  it('accepts only known push services on the default port', () => {
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QH2',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
      'https://fcm.googleapis.com:443/fcm/send/abc',
    ]) {
      expect(readDeviceRegistration({ kind: 'webpush', endpoint, keys }).endpoint).toBe(endpoint);
    }
    for (const endpoint of [
      'https://push.example/x',
      'https://203.0.113.7/x',
      'https://[2001:db8::1]/x',
      'https://fcm.googleapis.com:8443/fcm/send/abc',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilpush.apple.com.example/x',
      'https://push.apple.com/x',
    ]) {
      expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint, keys }))).toBe('invalid_device');
    }
  });

  it('removes a stored endpoint whatever its host', () => {
    expect(readWebPushEndpoint('https://push.example/x', 'remove')).toBe('https://push.example/x');
    expect(code(() => readWebPushEndpoint('http://push.example/x', 'remove'))).toBe('invalid_device');
  });

  it('refuses keys that are not base64url or too long', () => {
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'a+b/c', auth: keys.auth } }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'a'.repeat(201), auth: keys.auth } }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'webpush', endpoint: 'https://fcm.googleapis.com/fcm/send/x' }))).toBe('invalid_device');
  });

  it('refuses tokens that are empty, too long, or contain other characters, and unknown kinds', () => {
    expect(code(() => readDeviceRegistration({ kind: 'fcm', token: '' }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'fcm', token: 'a'.repeat(4097) }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'fcm', token: 'a b' }))).toBe('invalid_device');
    expect(code(() => readDeviceRegistration({ kind: 'apns', token: 'abc' }))).toBe('invalid_device');
  });
});
