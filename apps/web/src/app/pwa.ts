/**
 * On each launch, look for a new service worker before the app is shown.
 * GitHub Pages and phones otherwise keep the previous build until several manual reloads.
 * 每次打开，在进入应用前先找新的服务工作线程。否则手机和 Pages 会把旧版本留到连刷好几次。
 */
export async function prepareLatestApp(): Promise<'reload' | 'ready'> {
  if (!('serviceWorker' in navigator)) return 'ready';
  const flag = 'utmmsc.sw-reloaded';
  if (sessionStorage.getItem(flag) === '1') {
    sessionStorage.removeItem(flag);
    return 'ready';
  }

  const hadController = !!navigator.serviceWorker.controller;
  const controllerChanged = new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 8000);
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      () => {
        window.clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });

  try {
    const registration = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    });
    await registration.update();

    let worker = registration.installing ?? registration.waiting;
    if (!worker) {
      worker = await new Promise<ServiceWorker | null>((resolve) => {
        const timer = window.setTimeout(() => resolve(null), 400);
        registration.addEventListener(
          'updatefound',
          () => {
            window.clearTimeout(timer);
            resolve(registration.installing);
          },
          { once: true },
        );
      });
    }
    if (!worker) return 'ready';

    if (worker.state !== 'installed' && worker.state !== 'activated') {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 6000);
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
            window.clearTimeout(timer);
            resolve();
          }
        });
      });
    }

    registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
    if (!hadController) return 'ready';

    const tookControl = await controllerChanged;
    if (!tookControl) return 'ready';
    sessionStorage.setItem(flag, '1');
    window.location.reload();
    return 'reload';
  } catch {
    return 'ready';
  }
}
