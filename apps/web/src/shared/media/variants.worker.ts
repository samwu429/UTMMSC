import { offscreenCanvas, renderVariantsWith } from './canvas';
import type { VariantSpec } from './sizing';

/**
 * The resize worker behind variants.ts: decodes with createImageBitmap and draws on OffscreenCanvas, off the main
 * thread. It answers every job, with ok false when it cannot help, so the page can fall back.
 * variants.ts 背后的缩放 Worker：用 createImageBitmap 解码，在 OffscreenCanvas 上绘制，不占用主线程。
 * 每个任务都会得到答复；无法处理时 ok 为 false，页面据此改用后备方案。
 */

interface Job {
  id: number;
  blob: Blob;
  specs: VariantSpec[];
}

// The app compiles against the DOM library, so the worker scope is described by hand.
// 应用按 DOM 类型库编译，因此手动描述 Worker 的全局作用域。
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<Job>) => void) | null;
  postMessage: (message: unknown) => void;
};

function canDraw(): boolean {
  try {
    return typeof OffscreenCanvas === 'function' && new OffscreenCanvas(1, 1).getContext('2d') !== null;
  } catch {
    return false;
  }
}

scope.onmessage = (event) => {
  const { id, blob, specs } = event.data;
  if (!canDraw()) {
    scope.postMessage({ id, ok: false, unsupported: true });
    return;
  }
  renderVariantsWith(blob, specs, offscreenCanvas).then(
    (result) => scope.postMessage({ id, ok: true, ...result }),
    () => scope.postMessage({ id, ok: false }),
  );
};
