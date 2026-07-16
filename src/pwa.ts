export interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>; }
let deferredPrompt: InstallPromptEvent | null = null;
export function registerPwa() {
  if ('serviceWorker' in navigator) window.addEventListener('load', async () => {
    try {
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      });
      const registration = await navigator.serviceWorker.register('/service-worker.js', { updateViaCache: 'none' });
      await registration.update();
      window.setInterval(() => void registration.update(), 15 * 60 * 1000);
    } catch { /* The ERP remains usable when installation is unavailable. */ }
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event as InstallPromptEvent; window.dispatchEvent(new CustomEvent('zg-install-available')); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; window.dispatchEvent(new CustomEvent('zg-app-installed')); });
}
export function canInstallApp() { return Boolean(deferredPrompt); }
export async function installApp() { if (!deferredPrompt) return false; await deferredPrompt.prompt(); const choice = await deferredPrompt.userChoice; deferredPrompt = null; return choice.outcome === 'accepted'; }
