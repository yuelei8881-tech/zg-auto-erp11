import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { openCloudSession, type CloudSession } from './lib/cloud';
import { cloudConfigured, supabase } from './lib/supabase';

type AuthMode = 'login' | 'register' | 'forgot' | 'recovery';

export function FormalGate({ children }: { children: (cloud: CloudSession) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [cloud, setCloud] = useState<CloudSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<AuthMode>('login');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setMode('recovery');
      setSession(next);
      if (!next) setCloud(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user || mode === 'recovery') return;
    setError('');
    openCloudSession(session.user).then(setCloud).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : '服务器连接失败。');
      setCloud(null);
    });
  }, [session?.user.id, mode]);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase) return;
    const form = new FormData(event.currentTarget); setSubmitting(true); setError(''); setNotice('');
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: String(form.get('email') || '').trim(), password: String(form.get('password') || '') });
    if (loginError) setError(loginError.message === 'Invalid login credentials' ? '邮箱或密码不正确' : loginError.message);
    setSubmitting(false);
  };

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase) return;
    const form = new FormData(event.currentTarget); const email = String(form.get('email') || '').trim(); const password = String(form.get('password') || ''); const activationCode = String(form.get('activationCode') || '').trim().toUpperCase();
    if (activationCode.length < 6) { setError('请输入老板提供的员工激活码。'); return; }
    setSubmitting(true); setError(''); setNotice(''); sessionStorage.setItem('zg_staff_activation_code', activationCode);
    const { data, error: signupError } = await supabase.auth.signUp({ email, password });
    if (signupError) setError(signupError.message);
    else if (data.session) setNotice('账号已激活，正在进入系统…');
    else setNotice('账号已建立，请打开验证邮件完成确认后登录。');
    setSubmitting(false);
  };

  const forgot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase) return;
    const email = String(new FormData(event.currentTarget).get('email') || '').trim();
    setSubmitting(true); setError(''); setNotice('');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/` });
    if (resetError) setError(resetError.message); else setNotice('重置密码邮件已发送。请检查收件箱和垃圾邮件。');
    setSubmitting(false);
  };

  const recover = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (!supabase) return;
    const password = String(new FormData(event.currentTarget).get('password') || '');
    if (password.length < 8) { setError('新密码至少需要 8 位。'); return; }
    setSubmitting(true); setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) setError(updateError.message);
    else { await supabase.auth.signOut(); setSession(null); setCloud(null); setMode('login'); setNotice('密码已经更新，请使用新密码登录。'); }
    setSubmitting(false);
  };

  if (!cloudConfigured) return <AuthCard title="服务器尚未配置" error="请在 Vercel 添加 Supabase 项目地址和 Publishable Key。" />;
  if (loading) return <AuthCard title="正在连接正式服务器" subtitle="正在安全读取登录状态…" />;
  if (mode === 'recovery') return <div className="auth-screen"><form className="auth-card" onSubmit={recover}><div className="auth-logo">Z&G</div><h1>设置新密码</h1><p>请输入至少 8 位的新密码</p><label><span>新密码</span><input name="password" type="password" autoComplete="new-password" required minLength={8} /></label>{error && <p className="auth-error">{error}</p>}<button className="primary" disabled={submitting}>{submitting ? '正在保存…' : '保存新密码'}</button></form></div>;
  if (!session) return <div className="auth-screen"><form className="auth-card" onSubmit={mode === 'register' ? register : mode === 'forgot' ? forgot : login}>
    <div className="auth-logo">Z&G</div><h1>Z&G AUTO ERP</h1><p>{mode === 'forgot' ? '找回密码' : '员工账号登录 · v0.76.3'}</p>
    <label><span>邮箱</span><input name="email" type="email" autoComplete="email" required /></label>
    {mode !== 'forgot' && <label><span>密码</span><input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={8} /></label>}
    {mode === 'register' && <label><span>员工激活码</span><input name="activationCode" autoComplete="one-time-code" placeholder="由老板提供的 8 位激活码" required /></label>}
    {error && <p className="auth-error">{error}</p>}{notice && <p className="result-box">{notice}</p>}
    <button className="primary" disabled={submitting}>{submitting ? '请稍候…' : mode === 'register' ? '建立员工账号' : mode === 'forgot' ? '发送重置邮件' : '登录系统'}</button>
    {mode === 'login' && <button type="button" onClick={() => { setMode('forgot'); setError(''); setNotice(''); }}>忘记密码？</button>}
    <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : mode === 'forgot' ? 'login' : 'register'); setError(''); setNotice(''); }}>{mode === 'register' || mode === 'forgot' ? '返回登录' : '收到邀请？首次建立员工账号'}</button>
  </form></div>;
  if (error) return <AuthCard title="无法进入系统" error={error} action={() => location.reload()} />;
  if (!cloud) return <AuthCard title="正在连接正式服务器" subtitle="首次登录会自动建立 Z&G 修理厂空间…" />;
  return children(cloud);
}

function AuthCard({ title, subtitle, error, action }: { title: string; subtitle?: string; error?: string; action?: () => void }) {
  return <div className="auth-screen"><div className="auth-card"><div className="auth-logo">Z&G</div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}{error && <p className="auth-error">{error}</p>}{action && <button onClick={action}>重新连接</button>}</div></div>;
}
