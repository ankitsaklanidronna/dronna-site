import { useEffect, useMemo, useState } from 'react';

const INSTALL_DISMISS_KEY = 'dronna_pwa_install_dismissed';
const PWA_STATIC_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/offline.html',
  '/terms.html',
  '/privacy-policy.html',
  '/refund-policy.html',
  '/legal.css',
  '/favicon.svg',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png'
];

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function normalizeSameOriginUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function collectCurrentAssetUrls() {
  const urls = new Set(PWA_STATIC_URLS);
  urls.add(`${window.location.pathname || '/'}${window.location.search || ''}`);

  performance.getEntriesByType('resource').forEach((entry) => {
    const normalized = normalizeSameOriginUrl(entry.name);
    if (normalized) urls.add(normalized);
  });

  document.querySelectorAll('link[href], script[src], img[src]').forEach((element) => {
    const raw = element.getAttribute('href') || element.getAttribute('src');
    if (!raw) return;
    const normalized = normalizeSameOriginUrl(raw);
    if (normalized) urls.add(normalized);
  });

  return Array.from(urls);
}

async function sendCacheRequest(registration) {
  const activeWorker = registration?.active || registration?.waiting || registration?.installing;
  if (!activeWorker) return;

  activeWorker.postMessage({
    type: 'CACHE_URLS',
    payload: collectCurrentAssetUrls()
  });
}

function activateWaitingWorker(registration) {
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}

export function registerServiceWorker() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    let hasReloadedForUpdate = false;

    try {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hasReloadedForUpdate) return;
        hasReloadedForUpdate = true;
        window.location.reload();
      });

      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      registration.update().catch(() => null);

      if (registration.waiting) {
        activateWaitingWorker(registration);
      }

      await navigator.serviceWorker.ready;
      await sendCacheRequest(registration);

      registration.addEventListener('updatefound', () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener('statechange', async () => {
          if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
            activateWaitingWorker(registration);
          }

          if (installingWorker.state === 'activated') {
            await sendCacheRequest(registration);
          }
        });
      });
    } catch (error) {
      console.error('Service worker registration failed', error);
    }
  }, { once: true });
}

export function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(() => isStandaloneMode());
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(INSTALL_DISMISS_KEY) === '1');

  const isIos = useMemo(() => /iphone|ipad|ipod/i.test(window.navigator.userAgent), []);

  useEffect(() => {
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
      setDismissed(localStorage.getItem(INSTALL_DISMISS_KEY) === '1');
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      localStorage.removeItem(INSTALL_DISMISS_KEY);
      setDismissed(false);
    };

    const handleConnectivityChange = () => setIsOnline(navigator.onLine);
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (event) => setIsInstalled(event.matches || window.navigator.standalone === true);

    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('online', handleConnectivityChange);
    window.addEventListener('offline', handleConnectivityChange);

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleDisplayModeChange);
    } else {
      mediaQuery.addListener(handleDisplayModeChange);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('online', handleConnectivityChange);
      window.removeEventListener('offline', handleConnectivityChange);

      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleDisplayModeChange);
      } else {
        mediaQuery.removeListener(handleDisplayModeChange);
      }
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('install-banner-open', !isInstalled && !dismissed && (Boolean(deferredPrompt) || isIos));
    return () => document.body.classList.remove('install-banner-open');
  }, [deferredPrompt, dismissed, isInstalled, isIos]);

  const hideInstallBanner = () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, '1');
    setDismissed(true);
  };

  const installApp = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const result = await deferredPrompt.userChoice;

    if (result.outcome !== 'accepted') {
      hideInstallBanner();
    }

    setDeferredPrompt(null);
  };

  const shouldShowInstallBanner = !isInstalled && !dismissed && (Boolean(deferredPrompt) || isIos);

  return (
    <>
      {!isOnline && (
        <div className="offline-indicator" role="status" aria-live="polite">
          Offline mode active
        </div>
      )}

      {shouldShowInstallBanner && (
        <div className="install-banner" role="dialog" aria-label="Install Dronna app">
          <div>
            <p className="install-banner-title">Install the Dronna app</p>
            <p className="install-banner-copy">
              {deferredPrompt
                ? 'Open Dronna faster on your phone or desktop and launch it directly from your home screen.'
                : 'On iPhone or iPad, open the Share menu and choose Add to Home Screen.'}
            </p>
          </div>

          <div className="install-banner-actions">
            {deferredPrompt ? (
              <button className="btn-primary" onClick={installApp}>
                Install App
              </button>
            ) : (
              <button className="btn-outline" onClick={hideInstallBanner}>
                Dismiss
              </button>
            )}
            {deferredPrompt && (
              <button className="install-banner-dismiss" onClick={hideInstallBanner}>
                Later
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
