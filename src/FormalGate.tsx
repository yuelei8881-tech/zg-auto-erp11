import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { openCloudSession, type CloudSession } from './lib/cloud';
import { cloudConfigured, supabase } from './lib/supabase';

export function FormalGate({ children }: { children: (cloud: CloudSession) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [cloud, setCloud] = useState<CloudSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) setCloud(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    setError('');
    openCloudSession(session.user).then(setCloud).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '服务器连接失败。');
      setCloud(null);
    });
  }, [session?.user.id]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError('');
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: String(form.get('email') || '').trim(),
      password: String(form.get('password') || ''),
    });
    if (loginError) setError(loginError.message === 'Invalid login credentials' ? '邮箱或密码不正确' : loginError.message);
    setSubmitting(false);
  };

  if (!cloudConfigured) return <AuthCard title="服务器尚未配置" error="请在 Vercel 添加 Supabase 项目地址和 Publishable Key。" />;
  if (loading) return <AuthCard title="正在连接正式服务器" subtitle="正在安全读取登录状态…" />;
  if (!session) return <div className="auth-screen"><form className="auth-card" onSubmit={login}>
    <div className="auth-logo">Z&G</div><h1>Z&G AUTO ERP</h1><p>员工账号登录 · v0.75.0</p>
    <label><span>邮箱</span><input name="email" type="email" autoComplete="email" required /></label>
    <label><span>密码</span><input name="password" type="password" autoComplete="current-password" required /></label>
    {error && <p className="auth-error">{error}</p>}
    <button className="primary" disabled={submitting}>{submitting ? '正在登录…' : '登录系统'}</button>
  </form></div>;
  if (error) return <AuthCard title="无法进入系统" error={error} action={() => location.reload()} />;
  if (!cloud) return <AuthCard title="正在连接正式服务器" subtitle="首次登录会自动建立 Z&G 修理厂空间…" />;
  return children(cloud);
}

function AuthCard({ title, subtitle, error, action }: { title: string; subtitle?: string; error?: string; action?: () => void }) {
  return <div className="auth-screen"><div className="auth-card"><div className="auth-logo">Z&G</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}{error && <p className="auth-error">{error}</p>}{action && <button onClick={action}>重新连接</button>}</div></div>;
}
