import React, { useEffect, useState } from 'react';
import { canInstallApp, installApp } from './pwa';
function isStandalone() { return window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone); }
export function PwaInstall() {
  const [installable, setInstallable] = useState(canInstallApp());
  const [online, setOnline] = useState(navigator.onLine);
  const [showIosHelp, setShowIosHelp] = useState(false);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const edge = /edg/i.test(navigator.userAgent);
  useEffect(() => {
    const available = () => setInstallable(true), installed = () => setInstallable(false), goOnline = () => setOnline(true), goOffline = () => setOnline(false);
    window.addEventListener('zg-install-available', available); window.addEventListener('zg-app-installed', installed); window.addEventListener('online', goOnline); window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('zg-install-available', available); window.removeEventListener('zg-app-installed', installed); window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);
  if (isStandalone() && online) return null;
  return <>
    {!online && <div className="pwa-offline">当前网络已断开：可查看已打开页面，新增资料请联网后保存。</div>}
    {!isStandalone() && (installable || ios || edge) && <div className="pwa-install-card">
      <img src="/icons/zg-auto-icon.svg" alt="Z&G AUTO"/><div><b>安装 Z&G AUTO</b><small>添加到桌面，像普通应用一样打开</small></div>
      <button type="button" onClick={async () => { if (installable) { const accepted = await installApp(); if (accepted) setInstallable(false); } else setShowIosHelp(value => !value); }}>安装</button>
      <button type="button" className="pwa-dismiss" aria-label="关闭" onClick={event => (event.currentTarget.parentElement!.style.display = 'none')}>×</button>
      {showIosHelp && <p>{ios ? 'iPhone/iPad：请用 Safari 打开本站，点击底部“分享”按钮，再选择“添加到主屏幕”。' : '电脑 Edge：点击地址栏右侧的“安装应用”图标；如果没有显示，请打开右上角菜单 → 应用 → 将此站点安装为应用。'}</p>}
    </div>}
  </>;
}
