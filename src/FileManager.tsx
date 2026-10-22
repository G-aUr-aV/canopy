import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUp, CaretDown, CaretRight, Eye, EyeSlash, File, Folder, FolderOpen, MagnifyingGlass, ShieldCheck, X } from '@phosphor-icons/react';
import { bytes, get, query } from './api';
import { CodeReader } from './CodeReader';
import type { Directory, Entry, FileData, Location, Route } from './types';

function TreeBranch({ location, path = '', name, depth = 0, route, navigate }: { location: Location; path?: string; name: string; depth?: number; route: Route; navigate: (r: Route) => void }) {
  const [open, setOpen] = useState(depth === 0 && route.root === location.id);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    get<Directory>(query('/api/files', { root: location.id, path }), abort.signal)
      .then(data => { setEntries(data.entries.filter(e => e.kind === 'directory' && !e.protected)); setError(''); })
      .catch(error => { if (!abort.signal.aborted) setError(error.message); });
    return () => abort.abort();
  }, [open, location.id, path]);
  return <div className="tree-branch"><div className={`tree-row ${route.root === location.id && (route.path || '') === path ? 'selected' : ''}`} style={{ paddingLeft: `${8 + depth * 14}px` }}><button className="tree-expander" aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <CaretDown size={14} /> : <CaretRight size={14} />}</button><button className="tree-name" onClick={() => navigate({ tab: 'files', root: location.id, path })}>{open ? <FolderOpen size={19} /> : <Folder size={19} />}<span>{name}</span></button></div>{open && depth < 5 && <div>{error && <p className="tree-error">Unavailable</p>}{entries.slice(0, 80).map(entry => <TreeBranch key={entry.path} location={location} path={entry.path} name={entry.name} depth={depth + 1} route={route} navigate={navigate} />)}</div>}</div>;
}

export function FileManager({ route, navigate }: { route: Route; navigate: (route: Route) => void }) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [listing, setListing] = useState<Directory | null>(null);
  const [file, setFile] = useState<FileData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [filter, setFilter] = useState('');
  const [recursive, setRecursive] = useState(false);
  const [searchEntries, setSearchEntries] = useState<Entry[] | null>(null);
  const [searchLimited, setSearchLimited] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [sort, setSort] = useState('name');
  const [visible, setVisible] = useState(200);
  const [revision, setRevision] = useState(0);
  useEffect(() => { const abort = new AbortController(); get<Location[]>('/api/locations', abort.signal).then(setLocations).catch(e => { if (!abort.signal.aborted) setError(e.message); }); return () => abort.abort(); }, []);
  useEffect(() => {
    if (!route.root) return;
    const abort = new AbortController();
    setLoading(true); setError(''); setFile(null); setListing(null);
    const request = route.file ? query('/api/file', { root: route.root, path: route.file }) : query('/api/files', { root: route.root, path: route.path || '', hidden });
    get<Directory | FileData>(request, abort.signal).then(data => { if (route.file) setFile(data as FileData); else setListing(data as Directory); }).catch(e => { if (!abort.signal.aborted) setError(e.message); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [route.root, route.path, route.file, hidden, revision]);
  useEffect(() => { setFilter(''); setSearchEntries(null); setRecursive(false); setVisible(200); }, [route.root, route.path]);
  useEffect(() => {
    if (!recursive || filter.trim().length < 2 || !route.root) { setSearchEntries(null); setSearching(false); setSearchError(''); return; }
    const abort = new AbortController();
    setSearching(true); setSearchError('');
    const timer = setTimeout(() => get<{ entries: Entry[]; limited: boolean }>(query('/api/search', { root: route.root, q: filter, path: route.path || '', hidden }), abort.signal)
      .then(data => { setSearchEntries(data.entries); setSearchLimited(data.limited); })
      .catch(e => { if (!abort.signal.aborted) setSearchError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setSearching(false); }), 350);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [filter, recursive, route.root, route.path, hidden]);
  const location = locations.find(x => x.id === route.root);
  const open = (entry: Entry) => { if (entry.protected) return; navigate(entry.kind === 'directory' ? { tab: 'files', root: route.root, path: entry.path } : { tab: 'files', root: route.root, path: route.path || '', file: entry.path }); };
  const back = () => navigate({ tab: 'files', root: route.root, path: route.path || '' });
  const parent = (route.path || '').split('/').slice(0, -1).join('/');
  const rows = (searchEntries || listing?.entries || []).filter(e => searchEntries || e.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1;
    if (b.kind === 'directory' && a.kind !== 'directory') return 1;
    return sort === 'size' ? b.size - a.size : sort === 'modified' ? b.modified - a.modified : a.name.localeCompare(b.name);
  });
  return <div className={`file-manager ${route.file ? 'has-reader' : ''}`}>
    {!route.root && <><div className="page-intro"><p className="eyebrow">FILES</p><h1>Your server, organized.</h1><p className="subtitle">Explore your projects, notes, and system files.</p></div><div className="location-grid">{locations.map(l => <button className="location" key={l.id} onClick={() => navigate({ tab: 'files', root: l.id, path: '' })}><Folder size={30} /><div><h2>{l.name}</h2><p>{l.description}</p><code>{l.path}</code></div><CaretRight size={20} /></button>)}</div><p className="policy-note"><ShieldCheck size={18} />Read-only browsing. Credential files and symlinks are protected.</p>{error && <div className="notice error">{error}</div>}</>}
    {route.root && <div className="file-layout"><aside className="folder-tree" aria-label="Folder tree"><div className="section-heading"><h2>Explorer</h2><button className="icon-button" aria-label="All locations" onClick={() => navigate({ tab: 'files' })}><ArrowLeft size={18} /></button></div>{locations.map(l => <TreeBranch key={l.id} location={l} name={l.name} route={route} navigate={navigate} />)}<p className="tree-caption">Protected items stay private.<br />Folders load as you open them.</p></aside><div className="file-main">
      {route.file ? <>{loading && <div className="empty-state" role="status">Opening read-only preview…</div>}{error && <div className="empty-state"><ShieldCheck size={36} /><h2>Preview unavailable</h2><p>{error}</p><button className="secondary-button" onClick={back}><ArrowLeft size={18} />Back to folder</button></div>}{file && <CodeReader file={file} onBack={back} onRefresh={() => setRevision(revision + 1)} />}</> : <>
        <div className="file-list-heading"><div><p className="eyebrow">FILES</p><h1>{location?.name || 'Files'}</h1></div><span className="read-label"><ShieldCheck size={18} />Read only</span></div>
        <nav className="breadcrumbs" aria-label="File path"><button onClick={() => navigate({ tab: 'files' })}>Locations</button><CaretRight size={12} /><button onClick={() => navigate({ tab: 'files', root: route.root, path: '' })}>{location?.name || route.root}</button>{(route.path || '').split('/').filter(Boolean).map((part, i, parts) => <span key={i}><CaretRight size={12} /><button onClick={() => navigate({ tab: 'files', root: route.root, path: parts.slice(0, i + 1).join('/') })}>{part}</button></span>)}</nav>
        <div className="file-controls"><label className="search-input"><MagnifyingGlass size={19} /><input aria-label="Filter filenames" value={filter} onChange={e => { setFilter(e.target.value); setVisible(200); }} placeholder="Find a file or folder…" />{filter && <button className="icon-button small" aria-label="Clear filter" onClick={() => setFilter('')}><X size={16} /></button>}</label><button className="secondary-button hidden-toggle" aria-pressed={hidden} onClick={() => setHidden(!hidden)}>{hidden ? <Eye size={19} /> : <EyeSlash size={19} />}<span>Hidden files</span></button><label className="sort-label"><span className="sr-only">Sort files</span><select aria-label="Sort files" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name</option><option value="modified">Modified</option><option value="size">Size</option></select></label></div>
        <label className="recursive-option"><input type="checkbox" checked={recursive} onChange={e => setRecursive(e.target.checked)} />Search subfolders <span>(filenames, up to 6 levels)</span></label>
        {route.path && <button className="parent-folder" onClick={() => navigate({ tab: 'files', root: route.root, path: parent })}><ArrowUp size={18} />Parent folder</button>}
        {(error || searchError) && <div className="notice error" role="alert">{error || searchError}<button onClick={() => setRevision(revision + 1)}>Retry</button></div>}
        {(loading || searching) && <div className="loading-line" role="status">{searching ? 'Searching filenames…' : 'Reading folder…'}</div>}
        {!loading && !searching && !error && <><div className="file-table"><div className="file-table-labels"><span>Name</span><span>Size</span><span>Modified</span></div>{rows.slice(0, visible).map(entry => <button className={`file-row ${entry.protected ? 'protected' : ''}`} key={entry.path} onClick={() => open(entry)} disabled={entry.protected} title={entry.protected ? 'Protected by browsing policy' : entry.path}><span className="file-row-name">{entry.protected ? <ShieldCheck size={21} /> : entry.kind === 'directory' ? <Folder size={22} /> : <File size={21} />}<span><strong>{entry.name}</strong>{searchEntries && <small>{entry.path}</small>}<small className="mobile-file-date">{entry.protected ? 'Protected' : entry.kind === 'link' ? 'Symbolic link' : new Date(entry.modified * 1000).toLocaleDateString()}</small></span>{entry.protected && <small className="protected-label">Protected</small>}</span><span>{entry.kind === 'directory' ? '—' : bytes(entry.size)}</span><span className="file-modified">{new Date(entry.modified * 1000).toLocaleDateString()}</span></button>)}</div>{!rows.length && <div className="empty-state"><FolderOpen size={36} /><h2>{filter ? 'No matching filenames' : 'This folder is empty'}</h2><p>{filter ? 'Try a shorter name or search subfolders.' : 'Try showing hidden files or choose another folder.'}</p></div>}{rows.length > visible && <button className="secondary-button show-more" onClick={() => setVisible(visible + 200)}>Show more files</button>}<p className="folder-summary">{rows.length.toLocaleString()} items{listing?.truncated ? ' · listing limited to 5,000 entries' : ''}{searchEntries && searchLimited ? ' · search limit reached; narrow the scope' : ''}</p></>}
      </>}
    </div></div>}
  </div>;
}
