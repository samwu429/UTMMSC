import { describe, expect, it } from 'vitest';
import { AdminHistory } from './adminHistory';

describe('admin history', () => {
  it('pops back to the screen a push came from', () => {
    const history = new AdminHistory();
    history.record('k1', '/admin', 'PUSH');
    history.record('k2', '/admin/members?q=zh', 'PUSH');
    history.record('k3', '/admin/members/mem_1', 'PUSH');
    expect(history.canPopTo('k3', '/admin/members')).toBe(true);
    expect(history.canPopTo('k2', '/admin')).toBe(true);
    expect(history.canPopTo('k3', '/admin')).toBe(false);
    expect(history.enteredFromOutside('k1')).toBe(true);
    expect(history.enteredFromOutside('k2')).toBe(false);
  });

  it('replaces instead when the screen was opened directly', () => {
    const history = new AdminHistory();
    history.record('default', '/admin/members/mem_1', 'POP');
    expect(history.canPopTo('default', '/admin/members')).toBe(false);
    expect(history.enteredFromOutside('default')).toBe(false);
  });

  it('keeps the place of a replaced entry, as for a redirect or the next review item', () => {
    const history = new AdminHistory();
    history.record('k1', '/admin/review', 'PUSH');
    history.record('k2', '/admin/review/applications/a1', 'PUSH');
    history.record('k3', '/admin/review/applications/a2', 'REPLACE');
    expect(history.canPopTo('k3', '/admin/review')).toBe(true);

    const redirected = new AdminHistory();
    redirected.record('r1', '/admin', 'PUSH');
    redirected.record('r2', '/admin/events', 'REPLACE');
    expect(redirected.enteredFromOutside('r2')).toBe(true);
  });

  it('follows back and forward to entries it has seen', () => {
    const history = new AdminHistory();
    history.record('k1', '/admin/members', 'PUSH');
    history.record('k2', '/admin/members/mem_1', 'PUSH');
    history.record('k1', '/admin/members', 'POP');
    history.record('k4', '/admin/members/mem_2', 'PUSH');
    expect(history.canPopTo('k4', '/admin/members')).toBe(true);
  });

  it('does not tie a new visit to admin left earlier', () => {
    const history = new AdminHistory();
    history.record('k1', '/admin/members', 'PUSH');
    history.leave();
    history.record('k9', '/admin', 'PUSH');
    expect(history.enteredFromOutside('k9')).toBe(true);
    expect(history.canPopTo('k9', '/admin/members')).toBe(false);
  });
});
