export interface InstallPromptEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>; }
let deferredPrompt: InstallPromptEvent | null = null;
export function registerPwa() {
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/service-worker.js').catch(() => undefined));
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event as InstallPromptEvent; window.dispatchEvent(new CustomEvent('zg-install-available')); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; window.dispatchEvent(new CustomEvent('zg-app-installed')); });
}
export function canInstallApp() { return Boolean(deferredPrompt); }
export async function installApp() { if (!deferredPrompt) return false; await deferredPrompt.prompt(); const choice = await deferredPrompt.userChoice; deferredPrompt = null; return choice.outcome === 'accepted'; }
