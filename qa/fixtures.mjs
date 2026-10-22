// Invented browser-only data. Production always reads the EC2 host.
const GiB = 1024 ** 3;
export const sampleCode = `from fastapi import FastAPI\nfrom fastapi.responses import JSONResponse\nimport psutil\n\napp = FastAPI(\n    title="Server overview",\n    version="1.0.0",\n)\n\n\n@app.get("/health")\ndef health():\n    return {"status": "ok"}\n\n\n@app.get("/metrics")\ndef metrics():\n    memory = psutil.virtual_memory()\n    disk = psutil.disk_usage("/")\n\n    return JSONResponse({\n        "cpu_percent": psutil.cpu_percent(),\n        "memory": {\n            "total": memory.total,\n            "available": memory.available,\n            "percent": memory.percent,\n        },\n        "disk": {\n            "total": disk.total,\n            "used": disk.used,\n            "free": disk.free,\n        },\n    })\n\n# A deliberately long comment for testing horizontal code scrolling and word wrapping without changing the read-only document.\n`;
export function metrics(minutes = 15) {
  const now = Math.floor(Date.now() / 1000);
  const history = Array.from({length: 91}, (_, i) => ({timestamp: now - minutes * 60 + i * minutes * 60 / 90, cpu: 12 + 2 * Math.sin(i * 1.7) + (i === 24 ? 20 : i === 70 ? 15 : 0), memory: 19.7 + .9 * Math.sin(i), rx: 180 * 1024, tx: 68 * 1024, disk_read: 5000, disk_write: 16000}));
  return {timestamp: now, hostname: 'example-host', os: 'Ubuntu 26.04 LTS', kernel: '6.17.0', architecture: 'x86_64', region: 'ap-south-1', uptime: 280320, cpu: 12.4, cores: [10.2, 14.6], logical_cpus: 2, physical_cpus: 1, load: [.24, .32, .19], memory: {total: 7.6 * GiB, used: 1.5 * GiB, available: 6.1 * GiB, percent: 19.7, cached: 2 * GiB, buffers: 128 * 1024 ** 2}, swap: {total: 0, used: 0, percent: 0}, disks: [{mount: '/', device: '/dev/nvme0n1p1', filesystem: 'ext4', total: 48.5 * GiB, used: 15.5 * GiB, available: 33 * GiB, percent: 32, inodes_total: 3000000, inodes_used: 480000, inodes_percent: 16}], interfaces: [{name: 'ens5', received: 1e9, sent: 2e8, rx: 180 * 1024, tx: 68 * 1024, errors: 0, drops: 0}], network: {rx: 180 * 1024, tx: 68 * 1024}, disk_io: {read: 5000, write: 16000}, processes: [{pid: 410, name: 'python', user: 'canopy', status: 'sleeping', cpu: 4.5, memory: 64 * 1024 ** 2, memory_percent: 1}, {pid: 220, name: 'node', user: 'app', status: 'sleeping', cpu: 1.2, memory: 128 * 1024 ** 2, memory_percent: 2}, {pid: 115, name: 'cloudflared', user: 'connector', status: 'sleeping', cpu: .5, memory: 32 * 1024 ** 2, memory_percent: .5}], process_count: 3, processes_limited: false, history, collection_error: null, history_seconds: minutes * 60};
}
export const services = {timestamp: Math.floor(Date.now() / 1000), stale: false, services: [{name: 'todo.service', description: 'Personal task manager', active: 'active', state: 'running', loaded: 'loaded', uptime: 281520}, {name: 'memex-reader.service', description: 'Knowledge reader', active: 'active', state: 'running', loaded: 'loaded', uptime: 102300}, {name: 'codex-meter-web.service', description: 'Codex usage dashboard', active: 'active', state: 'running', loaded: 'loaded', uptime: 38880}, {name: 'fixture-stopped.service', description: 'An intentionally stopped fixture', active: 'inactive', state: 'dead', loaded: 'loaded', uptime: null}]};
export const locations = [{id: 'repos', name: 'Projects', path: '/workspace/repos', description: 'Source code and repositories'}, {id: 'ops', name: 'Operations', path: '/workspace/ops', description: 'Service definitions and runbooks'}, {id: 'vaults', name: 'Notes', path: '/vaults', description: 'Your knowledge and notes'}, {id: 'etc', name: 'System', path: '/etc', description: 'Readable system configuration'}];
const entry = (name, kind = 'file', path = name, size = 1300) => ({name, path, kind, size, modified: 1792486800, permissions: kind === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--', protected: false});
export function directory(path, hidden) {
  let entries = path === '' ? [entry('observatory', 'directory'), entry('README.md'), {...entry('.env'), protected: true}] : [entry('src', 'directory', 'observatory/src'), entry('main.py', 'file', 'observatory/main.py', sampleCode.length), entry('README.md', 'file', 'observatory/README.md'), entry('empty', 'directory', 'observatory/empty')];
  if (path === 'observatory/empty') entries = [];
  if (path === 'observatory/src') entries = [entry('settings.json', 'file', path + '/settings.json')];
  if (hidden) entries.push(entry('.gitignore', 'file', [path, '.gitignore'].filter(Boolean).join('/')));
  return {root: 'repos', path, entries, truncated: false, limit: 5000};
}
export function file(path) {
  const content = path.endsWith('.md') ? '# Observatory\n\nA **read-only** server dashboard.\n\n```python\nprint("hello")\n```\n\n![remote image](https://example.invalid/tracking.png)\n\n<script>window.fixtureUnsafe = true</script>\n' : path.endsWith('.json') ? '{\n  "refresh_seconds": 2,\n  "read_only": true\n}\n' : sampleCode;
  return {root: 'repos', path, name: path.split('/').at(-1), content, size: new TextEncoder().encode(content).length, modified: 1792486800, permissions: '-rw-r--r--', truncated: false, preview_bytes: content.length, encoding: 'UTF-8'};
}
export async function fixtureRoutes(page) {
  const state = {metricsError: false, authExpired: false, authRedirect: false, servicesAuthRedirect: false, networkError: false, gatewayError: false, fileError: false, truncated: false, memoryUsed: null, metricCalls: 0, requests: []};
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    state.requests.push(url.pathname + url.search);
    let body;
    if (url.pathname === '/api/auth/session' || url.pathname === '/api/auth/login') body = {authenticated: true, username: 'owner', csrf: 'fixture-only', must_change_password: false};
    else if (url.pathname === '/api/metrics') {
      state.metricCalls++;
      if (state.authRedirect) return route.fulfill({status: 302, headers: {location: 'https://app.example.com/authorize'}});
      if (state.networkError) return route.abort('internetdisconnected');
      if (state.gatewayError) return route.fulfill({status: 502, contentType: 'text/html', body: '<h1>Gateway unavailable</h1>'});
      if (state.authExpired) return route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>Sign in</title>'});
      if (state.metricsError) return route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({detail: 'Connection lost. Reconnecting…'})});
      body = metrics(Number(url.searchParams.get('minutes') || 15));
      if (state.memoryUsed !== null) body.memory.used = state.memoryUsed;
    } else if (url.pathname === '/api/services') {
      if (state.servicesAuthRedirect) return route.fulfill({status: 302, headers: {location: 'https://app.example.com/authorize'}});
      body = services;
    }
    else if (url.pathname === '/api/locations') body = locations;
    else if (url.pathname === '/api/files') body = directory(url.searchParams.get('path') || '', url.searchParams.get('hidden') === 'true');
    else if (url.pathname === '/api/file') {
      if (state.fileError) return route.fulfill({status: 403, contentType: 'application/json', body: JSON.stringify({detail: 'Protected by browsing policy'})});
      body = {...file(url.searchParams.get('path')), truncated: state.truncated};
    } else if (url.pathname === '/api/search') body = {entries: [entry('main.py', 'file', 'observatory/main.py', sampleCode.length)], limited: true};
    else return route.continue();
    await route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(body)});
  });
  return state;
}
