import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICON_BACKGROUND } from '../../../shared/media/squareIcon';
import { IconCropScreen } from './IconCropScreen';

// A server render has no portals, so the screen renders in place; document only needs a body to aim at.
// 服务端渲染不支持传送门，因此界面原地渲染；document 只需提供一个 body 作为目标。
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), createPortal: (children: ReactNode) => children }));

const PICKED = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' });

function render(): string {
  return renderToStaticMarkup(createElement(IconCropScreen, { file: PICKED, onCancel: () => undefined, onDone: async () => undefined }));
}

describe('IconCropScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { body: {} });
    const error = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      error(...args);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows the 48 px preview on the colour the encoder fills, not on the brand tile', () => {
    const html = render();
    const tile = [...html.matchAll(/<div [^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes('h-12 w-12'));
    expect(tile).toBeDefined();
    expect(tile).toContain(`background-color:${ICON_BACKGROUND}`);
    expect(tile).not.toContain('bg-brand');
    expect(html).toContain('预览');
  });
});
