import { createContext, useContext, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeSlash, Key, LockSimple, ShieldCheck, SignOut } from '@phosphor-icons/react';
import { App } from './App';
import { ACCESS_REQUIRED_EVENT } from './api';

type Session = { authenticated: boolean; username?: string; must_change_password?: boolean; csrf?: string };
class AuthFailure extends Error { constructor(message: string, public status: number) { super(message); } }
const Account = createContext({ change: () => {}, logout: () => {} });

async function authRequest(path: string, body?: Record<string, string>, csrf?: string): Promise<Session> {
  let response: Response;
  try {
    response = await fetch('/api/auth/' + path, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: body ? { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) } : {},
      body: body ? JSON.stringify(body) : undefined });
  } catch { throw new Error('Couldn’t reach your server. Check your connection and try again.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Sign-in is temporarily unavailable. Please try again.');
  const result = await response.json();
  if (!response.ok) throw new AuthFailure(result.detail || 'Sign-in could not be completed.', response.status);
  return result;
}

function PasswordField({ label, name, newPassword = false }: { label: string; name: string; newPassword?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <label className="auth-label">{label}<span className="auth-password"><input name={name} type={visible ? 'text' : 'password'} autoComplete={newPassword ? 'new-password' : 'current-password'} required minLength={newPassword ? 15 : 1} maxLength={256} /><button type="button" aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? <EyeSlash size={20} /> : <Eye size={20} />}</button></span></label>;
}

function Login({ session, message, onSession, onCancel }: { session: Session; message: string; onSession: (s: Session) => void; onCancel?: () => void }) {
  const changing = session.authenticated;
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); document.getElementById('auth-title')?.focus({preventScroll:true}); }, [changing]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, fields = new FormData(form);
    if (changing && fields.get('new') !== fields.get('confirm')) { setError('Your new passwords don’t match.'); return; }
    setBusy(true); setError('');
    try {
      const next = changing
        ? await authRequest('password', { current: String(fields.get('current')), new: String(fields.get('new')) }, session.csrf)
        : await authRequest('login', { username: String(fields.get('username')), password: String(fields.get('password')) });
      form.reset(); onSession(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="auth-shell"><header className="auth-header"><a href="/" className="brand"><img src="/brand/canopy.png" alt="" />Canopy</a><span><ShieldCheck size={18} />Private observatory</span></header>
    <main className="auth-layout" id="sign-in"><section className="auth-intro"><p className="eyebrow">A LITTLE CLARITY FOR YOUR CLOUD</p><h1>Your server.<br />A clearer view.</h1><p>From a quick health check to a closer look at your code. Everything you need, in one quiet place.</p><div className="auth-features"><span><i className="dot green" />Live system insights</span><span><ShieldCheck size={18} />Read-only file browsing</span></div><div className="auth-intro-bottom">Made for your desktop.<br />Just as at home on your phone.</div></section>
    <section className="auth-card" aria-labelledby="auth-title"><div className="auth-lock">{changing ? <Key size={24} /> : <LockSimple size={24} />}</div><h2 id="auth-title" tabIndex={-1}>{changing ? session.must_change_password ? 'Make yourself at home.' : 'A fresh password.' : 'Welcome to Canopy.'}</h2><p className="auth-description">{changing ? session.must_change_password ? 'Set your own password before opening your server. Your temporary password will stop working.' : 'Changing your password signs out your other devices.' : 'Sign in to see how your server is doing.'}</p>
    {message && <p className="auth-message" role="status">{message}</p>}
    <form onSubmit={submit} aria-label={changing ? 'Change password' : 'Sign in'}>
      <label className={`auth-label ${changing ? 'auth-username-hidden' : ''}`}>Username<input name="username" autoComplete="username" defaultValue="owner" required readOnly={changing} /></label>
      {changing ? <><PasswordField label="Current password" name="current" /><PasswordField label="New password" name="new" newPassword /><p className="auth-hint">At least 15 characters. A few memorable words work well.</p><PasswordField label="Confirm new password" name="confirm" newPassword /></> : <PasswordField label="Password" name="password" />}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? 'Please wait…' : changing ? 'Save password & continue' : 'Sign in'}{!busy && <ArrowRight size={19} />}</button>
      {onCancel && <button type="button" className="text-button auth-cancel" onClick={onCancel}>Back to your server</button>}
    </form><p className="auth-assurance"><LockSimple size={14} />{changing ? 'Your password stays private.' : 'Stay signed in for 24 hours on this device.'}</p></section></main><footer className="auth-footer">A window into your server. Everything stays read only.</footer></div>;
}

export function AccountControls() {
  const account = useContext(Account);
  return <div className="account-controls"><button onClick={account.change}><Key size={16} />Password</button><button onClick={account.logout}><SignOut size={16} />Sign out</button></div>;
}

export function AuthGate() {
  const [session, setSession] = useState<Session | null>(null), [message, setMessage] = useState('');
  const [changing, setChanging] = useState(false), [retry, setRetry] = useState(0);
  const generation = useRef(0);
  function accept(next: Session) { generation.current++; setSession(next); setMessage(''); setChanging(false); }
  useEffect(() => {
    let active = true;
    async function check() {
      if (document.hidden) return;
      const current = generation.current;
      try {
        const value = await authRequest('session');
        if (active && current === generation.current) setSession(value);
      } catch (e) { if (active && current === generation.current) setMessage(e instanceof Error ? e.message : 'Please try again.'); }
    }
    const expired = () => { generation.current++; setSession({ authenticated: false }); setChanging(false); setMessage('Your session ended. Sign in to pick up where you left off.'); };
    check();
    const timer = setInterval(check, 60000);
    window.addEventListener(ACCESS_REQUIRED_EVENT, expired);
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', check);
    return () => { active = false; clearInterval(timer); window.removeEventListener(ACCESS_REQUIRED_EVENT, expired); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [retry]);
  async function logout() {
    try { await authRequest('logout', {}, session?.csrf); accept({ authenticated: false }); }
    catch (e) { if (e instanceof AuthFailure && e.status === 401) accept({authenticated:false}); else { setMessage(e instanceof Error ? e.message : 'Please try again.'); setChanging(true); } }
  }
  if (!session) return <div className="auth-loading"><div className="brand"><img src="/brand/canopy.png" alt="" />Canopy</div><p role="status">{message || 'Opening your observatory…'}</p>{message && <button className="primary-button" onClick={() => setRetry(v => v + 1)}>Try again</button>}</div>;
  if (!session.authenticated || session.must_change_password || changing) return <Login key={`${session.authenticated}-${changing}`} session={session} message={message} onSession={accept} onCancel={session.authenticated && !session.must_change_password ? () => { setChanging(false); setMessage(''); } : undefined} />;
  return <Account.Provider value={{ change: () => setChanging(true), logout }}><App /></Account.Provider>;
}
