import { useEffect, useState } from 'react';
import type { CloudLoadProgress } from './lib/cloud';

// Only local timing/counts: no customer content, identifiers, credentials or upload.
export function LoadDiagnostics({ progress, loading }: { progress: CloudLoadProgress | null; loading: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!loading) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [loading]);
  const seconds = (ms: number) => (Math.max(0, ms) / 1000).toFixed(1);
  if (loading) return <section className="loading" role="status"><p>正在读取正式服务器数据…</p><p>{progress?.phase || '准备读取'} · 已等待 {seconds(progress ? now - progress.startedAt : 0)} 秒</p>{!!progress?.records && <small>已收到 {progress.records} 条资料，完整读取后显示</small>}</section>;
  if (!progress) return null;
  return <details className="panel" style={{ margin: '8px 0', padding: '12px 16px', fontSize: 13 }}><summary>本次读取耗时诊断 · {seconds(progress.elapsedMs)} 秒</summary><p>权限验证：{seconds(progress.membershipMs)} 秒<br />数据请求与下载：{seconds(progress.downloadMs)} 秒<br />数据转换：{seconds(progress.processingMs)} 秒（不含页面绘制）<br />共 {progress.pages} 批 / {progress.records} 条</p><small>如仍然缓慢，请截图这部分。以上不包含进入此页面之前的登录耗时。</small></details>;
}
