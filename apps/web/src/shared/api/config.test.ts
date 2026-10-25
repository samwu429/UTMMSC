import { describe, expect, it } from 'vitest';
import { API_BASE_URL, WORKER_API_BASE_URL, resolveApiBase } from './config';

const page = (origin: string) => ({ origin, hostname: new URL(origin).hostname });

describe('resolveApiBase', () => {
  it('uses the same origin on utmmsc.com and www.utmmsc.com', () => {
    expect(resolveApiBase(undefined, page('https://utmmsc.com'))).toBe('https://utmmsc.com/api');
    expect(resolveApiBase(undefined, page('https://www.utmmsc.com'))).toBe('https://www.utmmsc.com/api');
    expect(resolveApiBase('', { origin: 'https://UTMMSC.com', hostname: 'UTMMSC.com' })).toBe('https://UTMMSC.com/api');
  });

  it('lets a configured base win, without its trailing slashes', () => {
    expect(resolveApiBase('http://localhost:8787/', page('https://utmmsc.com'))).toBe('http://localhost:8787');
    expect(resolveApiBase('  https://example.test/api//  ', page('http://localhost:5173'))).toBe('https://example.test/api');
  });

  it('falls back to the workers.dev address anywhere else', () => {
    expect(resolveApiBase(undefined, page('http://localhost:5173'))).toBe(WORKER_API_BASE_URL);
    expect(resolveApiBase('   ', page('https://samwu429.github.io'))).toBe(WORKER_API_BASE_URL);
    expect(resolveApiBase(undefined, page('https://utmmsc.com.evil.test'))).toBe(WORKER_API_BASE_URL);
    expect(resolveApiBase(undefined, null)).toBe(WORKER_API_BASE_URL);
  });

  it('has no trailing slash at import time in Node', () => {
    expect(API_BASE_URL.endsWith('/')).toBe(false);
  });
});
