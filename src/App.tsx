import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowClockwise, ArrowRight, ChartBar, Cpu, Folder, HardDrives, ListBullets, Network, SidebarSimple as PanelLeft, Pause, Play, ShieldCheck, SquaresFour, WarningCircle } from '@phosphor-icons/react';
import { ACCESS_REQUIRED_EVENT, ACCESS_REQUIRED_MESSAGE, AccessRequiredError, bytes, duration, get, percent } from './api';
import { HistoryChart, Spark } from './charts';
import { InstallApp } from './InstallApp';
import { AccountControls } from './Auth';
const FileManager = lazy(() => import('./FileManager').then(module => ({ default: module.FileManager })));
import type { Metrics, ProcessInfo, Route, Service, Services, Tab } from './types';

const tabs = [{ id: 'overview', name: 'Overview', Icon: ChartBar }, { id: 'resources', name: 'Resources', Icon: Cpu }, { id: 'processes', name: 'Processes', Icon: ListBullets }, { id: 'services', name: 'Services', Icon: SquaresFour }, { id: 'files', name: 'Files', Icon: Folder }] as const;
function readRoute(): Route {
  const [tab, query] = window.location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  return { tab: tabs.some(x => x.id === tab) ? tab as Tab : 'overview', root: params.get('root') || undefined, path: params.get('path') || '', file: params.get('file') || undefined };
}
const serviceName = (s: Service) => ({ 'todo.service': 'Todo', 'memex-reader.service': 'Memex reader', 'codex-meter-web.service': 'Meter', 'canopy.service': 'Canopy' }[s.name] || s.name.replace(/\.service$/, ''));
function ServiceState({ service }: { service: Service }) { const good = service.active === 'active'; return <span className={`service-state ${good ? 'good' : service.active === 'failed' ? 'bad' : ''}`}><i className={`dot ${good ? 'green' : service.active === 'failed' ? 'red' : 'gray'}`} />{service.state === 'running' ? 'Running' : service.active === 'active' ? 'Active' : service.active === 'failed' ? 'Failed' : service.active === 'inactive' ? 'Inactive' : service.active}</span>; }

function MetricStrip({ metrics, loading = false }: { metrics: Metrics | null; loading?: boolean }) {
  const disk = metrics?.disks.find(x => x.mount === '/');
  const net = metrics && metrics.network.rx != null && metrics.network.tx != null ? metrics.network.rx + metrics.network.tx : null;
  const memoryScale = metrics ? Math.max(0, Math.min(4, Math.floor(Math.log(Math.max(1, metrics.memory.total)) / Math.log(1024)))) : 0;
  const memoryUsed = metrics ? (metrics.memory.used / 1024 ** memoryScale).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—';
  return <div className={`metric-strip ${loading ? 'is-loading' : ''}`}>
    <div className="metric"><span className="metric-label">CPU</span><strong>{percent(metrics?.cpu)}</strong>{metrics ? <Spark data={metrics.history} field="cpu" color="#23805e" /> : <span className="metric-sub">Collecting…</span>}</div>
    <div className="metric"><span className="metric-label">Memory</span><strong className="memory-number">{metrics ? `${memoryUsed} / ${bytes(metrics.memory.total)}` : '—'}</strong>{metrics && <Spark data={metrics.history} field="memory" color="#377bd2" />}</div>
    <div className="metric"><span className="metric-label">Disk</span><strong>{percent(disk?.percent)}</strong><span className="metric-sub">{disk ? `${bytes(disk.available)} available` : 'Reading volumes…'}</span></div>
    <div className="metric"><span className="metric-label">Network</span><strong className="network-number">{net == null ? '—' : `${bytes(net, 0)}/s`}</strong><span className="metric-sub">Total throughput</span></div>
  </div>;
}

function ServiceTable({ data, compact = false }: { data: Services | null; compact?: boolean }) {
  const [filter, setFilter] = useState('');
  let rows = data?.services || [];
  if (compact) {
    const favorites = rows.filter(s => ['todo.service', 'memex-reader.service', 'codex-meter-web.service'].includes(s.name));
    rows = favorites.length ? favorites : rows.filter(s => s.active === 'active').slice(0, 3);
  } else rows = rows.filter(s => `${s.name} ${s.description} ${s.active}`.toLowerCase().includes(filter.toLowerCase()));
  return <>{!compact && <label className="search-input table-search"><input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter services…" aria-label="Filter services" /></label>}
    {(!data || data.stale || data.error) && <p className="notice" role="status">{data?.error || (data?.stale ? 'Service status is stale. Waiting for the observer.' : 'Reading service status…')}</p>}
    <div className="table-wrap"><table className={`services-table ${compact ? 'compact' : ''}`}><thead><tr><th>Name</th><th>Status</th><th className="desktop-cell">Uptime</th><th className="desktop-cell">Description</th></tr></thead><tbody>{rows.map(s => <tr key={s.name}><td><strong title={s.name}>{serviceName(s)}</strong>{!compact && <small>{s.name}</small>}</td><td><ServiceState service={s} /></td><td className="desktop-cell mono">{duration(s.uptime)}</td><td className="desktop-cell muted">{s.description}</td></tr>)}</tbody></table></div>
    {data && !data.error && !rows.length && <div className="empty-state">{filter ? 'No matching services.' : 'No services are visible to the observer.'}</div>}
  </>;
}

function Processes({ data }: { data: Metrics }) {
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<'cpu' | 'memory' | 'pid'>('cpu');
  const rows = data.processes.filter(p => `${p.name} ${p.user} ${p.pid}`.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => (b[sort] || 0) - (a[sort] || 0));
  const label = (key: 'cpu' | 'memory' | 'pid', name: string) => <th aria-sort={sort === key ? 'descending' : 'none'}><button onClick={() => setSort(key)}>{name}{sort === key ? ' ↓' : ''}</button></th>;
  return <><label className="search-input table-search"><input aria-label="Filter processes" placeholder="Filter by process, PID, or user…" value={filter} onChange={e => setFilter(e.target.value)} /></label><p className="muted table-caption">{data.process_count} visible processes · CPU uses 100% per logical core{data.processes_limited ? ' · top 400 shown' : ''}</p><div className="table-wrap"><table className="process-table"><thead><tr><th>Process</th>{label('cpu', 'CPU')}{label('memory', 'Memory')}<th className="desktop-cell">User</th><th className="desktop-cell">State</th></tr></thead><tbody>{rows.map((p: ProcessInfo) => <tr key={p.pid}><td><strong>{p.name || 'Unknown'}</strong><small className="mono">PID {p.pid}</small></td><td className="mono">{percent(p.cpu)}</td><td className="mono">{bytes(p.memory)}</td><td className="desktop-cell muted">{p.user}</td><td className="desktop-cell muted">{p.status}</td></tr>)}</tbody></table></div>{!rows.length && <div className="empty-state">No matching processes.</div>}</>;
}

function Resources({ data, minutes, setMinutes }: { data: Metrics; minutes: number; setMinutes: (n: number) => void }) {
  return <><MetricStrip metrics={data} /><HistoryChart metrics={data} minutes={minutes} onRange={setMinutes} /><div className="resource-grid">
    <section><div className="section-heading"><h2><Cpu size={22} />Compute</h2><span className="muted">{data.logical_cpus} vCPU</span></div><div className="cores">{data.cores.map((v, i) => <div className="core" key={i}><span>Core {i + 1}</span><progress max={100} value={v} /><strong>{percent(v)}</strong></div>)}</div><div className="load"><span>Load average</span>{data.load.map((v, i) => <span key={i}><strong>{v.toFixed(2)}</strong><small>{[1, 5, 15][i]} min</small></span>)}</div></section>
    <section><div className="section-heading"><h2>Memory</h2><span className="muted">{percent(data.memory.percent)} used</span></div><div className="detail-row"><span>Available</span><strong>{bytes(data.memory.available)}</strong></div><div className="detail-row"><span>Page cache</span><strong>{bytes(data.memory.cached)}</strong></div><div className="detail-row"><span>Buffers</span><strong>{bytes(data.memory.buffers)}</strong></div><div className="detail-row"><span>Swap</span><strong>{bytes(data.swap.used)} / {bytes(data.swap.total)}</strong></div><p className="muted small-note">Available memory includes reclaimable cache.</p></section>
  </div><section className="storage-section"><div className="section-heading"><h2><HardDrives size={23} />Storage</h2></div>{data.disks.map(d => <div className="volume" key={d.mount}><div className="volume-heading"><div><strong>{d.mount === '/' ? 'Root volume' : d.mount}</strong><code>{d.mount} {d.filesystem && `· ${d.filesystem}`}</code></div><strong>{percent(d.percent)}</strong></div><progress value={d.percent} max={100} className={d.percent > 85 ? 'warning-progress' : ''} /><div className="volume-details"><span>{bytes(d.used)} of {bytes(d.total)} used</span><span>{bytes(d.available)} available</span><span>Inodes {percent(d.inodes_percent)} used</span></div></div>)}</section><HistoryChart metrics={data} minutes={minutes} onRange={setMinutes} kind="disk" /><HistoryChart metrics={data} minutes={minutes} onRange={setMinutes} kind="network" /><section className="network-section"><div className="section-heading"><h2><Network size={22} />Network interfaces</h2></div>{data.interfaces.map(n => <div className="interface" key={n.name}><strong>{n.name}</strong><span>↓ {n.rx == null ? '—' : `${bytes(n.rx)}/s`}</span><span>↑ {n.tx == null ? '—' : `${bytes(n.tx)}/s`}</span><span className="muted">{n.errors} errors · {n.drops} drops</span></div>)}<p className="small-note muted">The summary excludes loopback, container bridges, and virtual tunnel interfaces to avoid counting traffic twice. Disk I/O is aggregated across devices.</p></section></>;
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('canopy-sidebar-hidden') === 'true'; } catch { return false; } });
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [services, setServices] = useState<Services | null>(null);
  const [minutes, setMinutes] = useState(15);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState('');
  const [accessRequired, setAccessRequired] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [retry, setRetry] = useState(0);
  useEffect(() => { const update = () => setRoute(readRoute()); window.addEventListener('hashchange', update); return () => window.removeEventListener('hashchange', update); }, []);
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(interval); }, []);
  useEffect(() => {
    const expired = () => { setAccessRequired(true); setError(ACCESS_REQUIRED_MESSAGE); };
    window.addEventListener(ACCESS_REQUIRED_EVENT, expired);
    return () => window.removeEventListener(ACCESS_REQUIRED_EVENT, expired);
  }, []);
  useEffect(() => {
    const resume = () => { if (!document.hidden && !paused && !accessRequired) setRetry(value => value + 1); };
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('online', resume); window.removeEventListener('focus', resume); document.removeEventListener('visibilitychange', resume); };
  }, [paused, accessRequired]);
  useEffect(() => { try { localStorage.setItem('canopy-sidebar-hidden', String(collapsed)); } catch { /* Private browsing can disable storage. */ } }, [collapsed]);
  useEffect(() => {
    if (paused || accessRequired) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      if (!document.hidden) {
        try { const data = await get<Metrics>(`/api/metrics?minutes=${minutes}`, abort.signal); if (!abort.signal.aborted) { setMetrics(data); setError(data.collection_error || ''); } }
        catch (e) { if (!abort.signal.aborted) { if (e instanceof AccessRequiredError) setAccessRequired(true); setError(e instanceof Error ? e.message : 'Connection lost. Reconnecting…'); } }
      }
      if (!abort.signal.aborted) timer = setTimeout(poll, 2000);
    }
    poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [minutes, paused, retry, accessRequired]);
  useEffect(() => {
    if (paused || accessRequired) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { try { const value = await get<Services>('/api/services', abort.signal); if (!abort.signal.aborted) setServices(value); } catch { /* Metrics banner reports network errors. */ } if (!abort.signal.aborted) timer = setTimeout(poll, 6000); }
    poll();
    return () => { abort.abort(); clearTimeout(timer); };
  }, [paused, retry, accessRequired]);
  const navigate = (next: Route) => { const params = new URLSearchParams(); for (const k of ['root', 'path', 'file'] as const) if (next[k]) params.set(k, next[k]!); window.location.hash = `${next.tab}${params.size ? `?${params}` : ''}`; window.scrollTo({ top: 0 }); };
  const age = metrics ? Math.max(0, Math.floor((now / 1000) - metrics.timestamp)) : 0;
  const stale = Boolean(metrics && age > 12);
  const reading = route.tab === 'files' && !!route.file;
  const heading = route.tab === 'overview' ? 'Your server, at a glance.' : route.tab === 'resources' ? 'Every resource, in view.' : route.tab === 'processes' ? 'What’s running.' : 'Your services, at a glance.';
  const status = accessRequired ? 'Sign in required' : paused ? 'Paused' : stale || error ? 'Reconnecting' : metrics ? 'Online' : 'Connecting';
  const visibleError = accessRequired ? ACCESS_REQUIRED_MESSAGE : error;
  return <div className={`app ${collapsed ? 'sidebar-hidden' : ''} ${reading ? 'reading-file' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={e => { e.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    {!collapsed && <aside className="sidebar" id="sidebar"><div className="sidebar-brand"><div className="brand"><img src="/brand/canopy.png" alt="" />Canopy</div><button className="icon-button" aria-label="Hide sidebar" title="Hide sidebar" aria-expanded={!collapsed} aria-controls="sidebar" onClick={() => setCollapsed(true)}><PanelLeft size={20} /></button></div><p className="sidebar-host">{metrics?.hostname || 'Your EC2'}</p><nav aria-label="Main navigation">{tabs.map(({ id, name, Icon }) => <button key={id} aria-current={route.tab === id ? 'page' : undefined} className={route.tab === id ? 'active' : ''} onClick={() => navigate({ tab: id })}><Icon size={23} /><span>{name}</span></button>)}</nav><div className="sidebar-footer"><ShieldCheck size={22} /><span>Read-only access</span></div></aside>}
    <div className="mobile-top"><div className="brand"><img src="/brand/canopy.png" alt="" />Canopy</div><div className="mobile-live"><i className={`dot ${status === 'Online' ? 'green' : 'amber'}`} /><span>{status}</span><button className="icon-button pause-button" aria-label={paused ? 'Resume live updates' : 'Pause live updates'} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button></div></div>
    <main id="main-content" tabIndex={-1}>
      <div className="desktop-utility">{collapsed && <button className="secondary-button" aria-label="Show sidebar" title="Show sidebar" aria-expanded={false} onClick={() => setCollapsed(false)}><PanelLeft size={19} /><span>Show sidebar</span></button>}<span className="utility-host">{collapsed ? metrics?.hostname : ''}</span>{route.tab === 'files' && <span className="read-label"><ShieldCheck size={17} />Read only</span>}</div>
      {visibleError && <div className="connection-banner" role="status"><WarningCircle size={20} /><span>{visibleError}</span><div className="connection-actions"><button onClick={() => { if (accessRequired) window.location.reload(); else setRetry(value => value + 1); }}><ArrowClockwise size={17} />{accessRequired ? 'Sign in again' : 'Retry'}</button>{!accessRequired && <button onClick={() => window.location.reload()}>Reload</button>}</div></div>}
      {route.tab !== 'files' && <><header className="page-header"><div className="page-intro"><p className="eyebrow desktop-eyebrow">{route.tab.toUpperCase()}</p><p className="mobile-host">{metrics?.hostname || 'Your EC2'}</p><h1>{route.tab === 'overview' ? <>Your server,<br className="mobile-title-break" />{' '}at a glance.</> : heading}</h1><p className="subtitle">{metrics ? <>{metrics.os.replace(' LTS', '')}<span className="desktop-architecture"> · {metrics.architecture}</span>{metrics.region ? ` · ${metrics.region}` : ''}</> : 'Connecting to your machine…'}</p></div><div className="header-actions"><div className="desktop-live"><span><i className={`dot ${status === 'Online' ? 'green' : 'amber'}`} />{status}</span><button className="icon-button" aria-label={paused ? 'Resume live updates' : 'Pause live updates'} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Play size={18} /> : <Pause size={18} />}</button><span className="muted">{metrics ? `Updated ${age}s ago` : 'Waiting for data'}</span></div>{route.tab === 'overview' && <button className="primary-button" onClick={() => navigate({ tab: 'files' })}><Folder size={20} />Browse files</button>}</div></header>
      {route.tab === 'overview' && <><MetricStrip metrics={metrics} loading={!metrics} />{metrics && <><HistoryChart metrics={metrics} minutes={minutes} onRange={setMinutes} /><section className="overview-services"><div className="section-heading"><h2>Services</h2><button className="text-button" onClick={() => navigate({ tab: 'services' })}>View all services<ArrowRight size={18} /></button></div><ServiceTable data={services} compact /></section></>}{!metrics && <div className="empty-state" role="status">Collecting the first system snapshot…</div>}</>}
      {route.tab === 'resources' && metrics && <Resources data={metrics} minutes={minutes} setMinutes={setMinutes} />}
      {route.tab === 'processes' && metrics && <Processes data={metrics} />}
      {route.tab === 'services' && <><p className="muted table-caption">Observed user services · status only</p><ServiceTable data={services} /></>}
      {route.tab !== 'overview' && route.tab !== 'services' && !metrics && <div className="empty-state">Waiting for system metrics…</div>}
      <footer className="page-footer"><span>{metrics ? `Uptime ${duration(metrics.uptime)} · ` : ''}{accessRequired ? 'Sign in to resume updates' : paused ? 'Updates paused' : 'Live history up to 1h'}<span className="desktop-footer-note"> · resets on collector restart</span></span><InstallApp /><AccountControls /><span>{new Date(now).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}</span></footer></>}
      {route.tab === 'files' && (accessRequired ? <div className="empty-state"><ShieldCheck size={36} /><h2>Sign in to browse files</h2><p>Your access session ended. Your current folder will reopen after sign-in.</p><button className="primary-button" onClick={() => window.location.reload()}>Sign in again</button></div> : <Suspense fallback={<div className="empty-state">Opening Explorer…</div>}><FileManager route={route} navigate={navigate} /></Suspense>)}
    </main>
    <nav className="mobile-nav" aria-label="Mobile navigation">{tabs.map(({ id, name, Icon }) => <button key={id} aria-current={route.tab === id ? 'page' : undefined} className={route.tab === id ? 'active' : ''} onClick={() => navigate({ tab: id })}><Icon size={24} weight={route.tab === id ? 'duotone' : 'regular'} /><span>{name}</span></button>)}</nav>
  </div>;
}
