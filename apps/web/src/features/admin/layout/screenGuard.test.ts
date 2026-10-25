import { describe, expect, it } from 'vitest';
import { ScreenGuard } from './screenGuard';

function shownOn(key: string): ScreenGuard {
  const guard = new ScreenGuard(key);
  guard.enter();
  return guard;
}

describe('screen guard', () => {
  it('lets the screen navigate when nothing changed while the request was out', () => {
    const guard = shownOn('detail');
    const stillHere = guard.begin();
    expect(stillHere()).toBe(true);
  });

  it('stops a late goBack once the admin has backed out to the list', () => {
    const guard = shownOn('detail');
    const stillHere = guard.begin();
    guard.leave();
    expect(stillHere()).toBe(false);
  });

  it('stops it when the same screen now shows another entry', () => {
    const guard = shownOn('new-a');
    const stillHere = guard.begin();
    guard.track('new-b');
    expect(stillHere()).toBe(false);
    expect(guard.begin()()).toBe(true);
  });

  it('survives the extra mount of StrictMode', () => {
    const guard = new ScreenGuard('compose');
    guard.enter();
    guard.leave();
    guard.enter();
    expect(guard.begin()()).toBe(true);
  });

  it('does not count a screen that never mounted', () => {
    expect(new ScreenGuard('compose').begin()()).toBe(false);
  });
});
