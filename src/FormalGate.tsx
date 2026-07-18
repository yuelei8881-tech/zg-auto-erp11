import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { openCloudSession, type CloudSession } from './lib/cloud';
import { cloudConfigured, supabase } from './lib/supabase';

type AuthMode = 'login' | 'register' | 'forgot' | 'recovery';

function friendlyAuthError(message: string) {
  if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确。请检查后重试，或使用“忘记密码”。';
  if (/email not confirmed/i.test(message)) return '邮箱尚未验证，请打开验证邮件后再登录。';
  if (/rate limit/i.test(message)) return '尝试次数过多，请稍后再试。';
  return message || '登录服务暂时不可用，请稍后重试。';
}

export function FormalGate({ children }: { children: (cloud: CloudSession) => ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [cloud, setCloud] = useState<CloudSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<AuthMode>(() =>
    new URLSearchParams(location.search).get('recovery') === '1' ? 'recovery' : 'login'
  );
  const [notice, setNotice] = useState('');
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(friendlyAuthError(sessionError.message));
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'PASSWORD_RECOVERY') setMode('recovery');
      setSession(next);
      if (!next) setCloud(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user || mode === 'recovery') return;
    let cancelled = false;
    setError('');
    setCloud(null);
    void openCloudSession(session.user)
      .then(value => { if (!cancelled) setCloud(value); })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '服务器连接失败。');
      });
    return () => { cancelled = true; };
  }, [session?.user.id, mode, connectionAttempt]);

  const resetToLogin = useCallback(async () => {
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await supabase?.auth.signOut({ scope: 'local' });
    } finally {
      sessionStorage.removeItem('zg_staff_activation_code');
      setSession(null);
      setCloud(null);
      setMode('login');
      setSubmitting(false);
    }
  }, []);

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    setSubmitting(true); setError(''); setNotice('');
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: String(form.get('email') || '').trim().toLowerCase(),
      password: String(form.get('password') || ''),
    });
    if (loginError) setError(friendlyAuthError(loginError.message));
    setSubmitting(false);
  };

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') || '').trim().toLowerCase();
    const password = String(form.get('password') || '');
    const activationCode = String(form.get('activationCode') || '').trim().toUpperCase();
    if (activationCode.length < 6) { setError('请输入老板提供的员工激活码。'); return; }
    setSubmitting(true); setError(''); setNotice('');
    sessionStorage.setItem('zg_staff_activation_code', activationCode);
    const { data, error: signupError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { zg_staff_activation_code: activationCode } },
    });
    if (signupError) setError(friendlyAuthError(signupError.message));
    else if (data.session) setNotice('账号已激活，正在进入系统…');
    else setNotice('账号已建立，请打开验证邮件完成确认后登录。');
    setSubmitting(false);
  };

  const forgot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const email = String(new FormData(event.currentTarget).get('email') || '').trim().toLowerCase();
    setSubmitting(true); setError(''); setNotice('');
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/?recovery=1`,
    });
    if (resetError) setError(friendlyAuthError(resetError.message));
    else setNotice('密码重置邮件已发送，请检查收件箱和垃圾邮件。');
    setSubmitting(false);
  };

  const recover = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    const password = String(new FormData(event.currentTarget).get('password') || '');
    if (password.length < 8) { setError('新密码至少需要 8 位。'); return; }
    setSubmitting(true); setError('');
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) setError(friendlyAuthError(updateError.message));
    else {
      await supabase.auth.signOut({ scope: 'local' });
      history.replaceState({}, '', `${location.origin}${location.pathname}`);
      setSession(null); setCloud(null); setMode('login');
      setNotice('密码已经更新，请使用新密码登录。');
    }
    setSubmitting(false);
  };

  if (!cloudConfigured) return <AuthCard title="服务器尚未配置" error="缺少服务器连接信息，请联系系统管理员。" />;
  if (loading) return <AuthCard title="正在连接正式服务器" subtitle="正在安全读取登录状态…" />;

  if (mode === 'recovery') return <div className="auth-screen"><form className="auth-card" onSubmit={recover}>
    <div className="auth-logo">Z&G</div><h1>设置新密码</h1><p>请输入至少 8 位的新密码</p>
    <label><span>新密码</span><input name="password" type="password" autoComplete="new-password" required minLength={8} /></label>
    {error && <p className="auth-error">{error}</p>}
    <button className="primary" disabled={submitting}>{submitting ? '正在保存…' : '保存新密码'}</button>
  </form></div>;

  if (!session) return <div className="auth-screen"><form className="auth-card" onSubmit={mode === 'register' ? register : mode === 'forgot' ? forgot : login}>
    <div className="auth-logo">Z&G</div><h1>Z&G AUTO ERP</h1>
    <p>{mode === 'forgot' ? '找回密码' : '员工账号登录 · v0.84.0'}</p>
    <label><span>邮箱</span><input name="email" type="email" autoComplete="email" required /></label>
    {mode !== 'forgot' && <label><span>密码</span><input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={8} /></label>}
    {mode === 'register' && <label><span>员工激活码</span><input name="activationCode" autoComplete="one-time-code" placeholder="由老板提供的 8 位激活码" required /></label>}
    {error && <p className="auth-error">{error}</p>}{notice && <p className="result-box">{notice}</p>}
    <button className="primary" disabled={submitting}>{submitting ? '请稍候…' : mode === 'register' ? '建立员工账号' : mode === 'forgot' ? '发送重置邮件' : '登录系统'}</button>
    {mode === 'login' && <button type="button" onClick={() => { setMode('forgot'); setError(''); setNotice(''); }}>忘记密码？</button>}
    <button type="button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setNotice(''); }}>{mode === 'login' ? '收到邀请？首次建立员工账号' : '返回登录'}</button>
  </form></div>;

  if (error) return <AuthCard
    title="无法进入系统"
    error={error}
    actionLabel="重新连接"
    action={() => setConnectionAttempt(value => value + 1)}
    secondaryLabel="退出并重新登录"
    secondaryAction={resetToLogin}
  />;
  if (!cloud) return <AuthCard title="正在连接正式服务器" subtitle="正在恢复您的公司和员工权限…" />;
  return children(cloud);
}

function AuthCard({ title, subtitle, error, action, actionLabel = '重新连接', secondaryAction, secondaryLabel }: {
  title: string;
  subtitle?: string;
  error?: string;
  action?: () => void;
  actionLabel?: string;
  secondaryAction?: () => void | Promise<void>;
  secondaryLabel?: string;
}) {
  return <div className="auth-screen"><div className="auth-card">
    <div className="auth-logo">Z&G</div><h1>{title}</h1>
    {subtitle && <p>{subtitle}</p>}{error && <p className="auth-error">{error}</p>}
    {action && <button className="primary" onClick={action}>{actionLabel}</button>}
    {secondaryAction && <button onClick={() => void secondaryAction()}>{secondaryLabel}</button>}
  </div></div>;
}
