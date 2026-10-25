import { describe, expect, it } from 'vitest';
import { isAdminOverlayOpen, isEditableTarget, overlayOpened } from './overlayGate';
import { matchesTyped } from './TypedConfirmSheet';

describe('overlay gate', () => {
  it('counts open overlays, and closing one twice counts once', () => {
    expect(isAdminOverlayOpen()).toBe(false);
    const first = overlayOpened();
    const second = overlayOpened();
    expect(isAdminOverlayOpen()).toBe(true);
    first();
    first();
    expect(isAdminOverlayOpen()).toBe(true);
    second();
    expect(isAdminOverlayOpen()).toBe(false);
  });

  it('treats only fields as typing targets', () => {
    expect(isEditableTarget(null)).toBe(false);
    const field = { isContentEditable: false, closest: (selector: string) => (selector.includes('input') ? {} : null) };
    const row = { isContentEditable: false, closest: () => null };
    expect(isEditableTarget(field as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(row as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ isContentEditable: true, closest: () => null } as unknown as EventTarget)).toBe(true);
  });
});

describe('typed confirmation', () => {
  it('needs the exact name, apart from spaces at the ends', () => {
    expect(matchesTyped('学术交流', '学术交流')).toBe(true);
    expect(matchesTyped('  学术交流 ', '学术交流')).toBe(true);
    expect(matchesTyped('学术', '学术交流')).toBe(false);
    expect(matchesTyped('general', 'General')).toBe(false);
  });

  it('accepts either Unicode form, and never an empty name', () => {
    const composed = 'Caf\u00e9';
    const decomposed = 'Cafe\u0301';
    expect(matchesTyped(decomposed, composed)).toBe(true);
    expect(matchesTyped('', '')).toBe(false);
    expect(matchesTyped(' ', '  ')).toBe(false);
  });
});
