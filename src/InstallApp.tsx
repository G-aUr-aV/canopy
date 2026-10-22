import { useEffect, useRef, useState } from 'react';
import { Check, Copy, DownloadSimple, X } from '@phosphor-icons/react';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const link = useRef<HTMLInputElement>(null);
  const appLink = window.location.origin + '/';
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(navigator.userAgent);
  useEffect(() => {
    const available = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt); };
    const completed = () => { setInstalled(true); setPrompt(null); dialog.current?.close(); };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', completed);
    return () => { window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', completed); };
  }, []);
  async function install() {
    if (prompt) {
      const pending = prompt;
      setPrompt(null);
      try { await pending.prompt(); await pending.userChoice; return; }
      catch { /* Provide an actionable browser-menu path if native install fails. */ }
    }
    setCopied(false); setCopyFailed(false);
    dialog.current?.showModal();
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(appLink); setCopied(true); }
    catch { setCopyFailed(true); link.current?.focus(); link.current?.select(); }
  }
  if (installed) return null;
  return <>
    <button className="text-button install-button" onClick={install}><DownloadSimple size={17} />Install app</button>
    <dialog className="install-dialog" ref={dialog} aria-labelledby="install-title" aria-describedby="install-description">
      <button className="icon-button install-close" aria-label="Close install instructions" onClick={() => dialog.current?.close()}><X size={21} /></button>
      <img className="install-brand" src="/brand/canopy.png" alt="" />
      <h2 id="install-title">Keep Canopy close.</h2>
      <p id="install-description">Add Canopy to your home screen for a full-screen view of your server.</p>
      {ios ? <ol><li>Open this link in Safari and sign in.</li><li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</li><li>Choose <strong>Add</strong>.</li></ol> : android ? <ol><li>Open this link in Chrome and sign in.</li><li>In Chrome’s <strong>⋮ menu</strong>, choose <strong>Add to home screen</strong>, then <strong>Install</strong>.</li></ol> : <ol><li>Open Canopy in Chrome or Edge and sign in.</li><li>Use the <strong>Install</strong> button in the address bar or browser menu.</li></ol>}
      {android && <p className="install-hint">Opened from another app? Use its menu’s <strong>Open in Chrome</strong> option first, or copy the link below into Chrome.</p>}
      <label className="install-link"><span>App link</span><input ref={link} aria-label="Canopy app link" readOnly value={appLink} onFocus={e => e.currentTarget.select()} /></label>
      {copyFailed && <p role="status">Select the link above and copy it from your browser’s menu.</p>}
      <div className="install-dialog-actions"><button className="secondary-button" onClick={copyLink}>{copied ? <Check size={18} /> : <Copy size={18} />}{copied ? 'Copied' : 'Copy link'}</button><button className="primary-button" onClick={() => dialog.current?.close()}>Done</button></div>
    </dialog>
  </>;
}
