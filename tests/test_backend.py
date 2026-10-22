import os
import time

from fastapi.testclient import TestClient
import pytest

from backend.app import create_app
from backend.auth import AuthStore, COOKIE, record, write_private
from backend.files import FileBrowser, Location, MAX_PREVIEW
from backend.metrics import Collector, read_services


@pytest.fixture
def setup(tmp_path):
    root = tmp_path / "approved"
    root.mkdir()
    (root / "src").mkdir()
    (root / "src" / "sample.py").write_text('def health():\n    return "ok"\n')
    (root / "README.md").write_text("# Read-only observatory\n")
    (root / ".hidden.txt").write_text("An ordinary hidden file.")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "outside.txt").write_text("Outside the approved root")
    browser = FileBrowser([Location("test", "Test", str(root), "/approved")])
    auth_path = tmp_path / 'auth.json'
    write_private(auth_path, record('fixture correct password', False))
    auth = AuthStore(auth_path)
    client = TestClient(create_app(browser, collect=False, auth=auth), base_url='https://testserver')
    client.cookies.set(COOKIE, auth.login('owner', 'fixture correct password'))
    return root, outside, browser, client


def test_listing_and_text_reads(setup):
    root, outside, browser, client = setup
    response = client.get('/api/files', params={'root': 'test'})
    assert response.status_code == 200
    assert response.json()['entries'][0]['name'] == 'src'
    assert '.hidden.txt' not in [e['name'] for e in response.json()['entries']]
    assert '.hidden.txt' in [e['name'] for e in client.get('/api/files', params={'root': 'test', 'hidden': True}).json()['entries']]
    response = client.get('/api/file', params={'root': 'test', 'path': 'src/sample.py'})
    assert response.status_code == 200
    assert response.json()['content'].startswith('def health():')
    assert response.headers['cache-control'] == 'no-store'
    assert not response.json()['truncated']


@pytest.mark.parametrize('path', ['../outside/outside.txt', '/etc/passwd', 'src/../../outside', 'src\\..\\outside', '\x00bad'])
def test_traversal_rejected(setup, path):
    response = setup[3].get('/api/file', params={'root': 'test', 'path': path})
    assert response.status_code in (400, 403)


@pytest.mark.parametrize('name', ['.env', '.env.production', 'server.env', '.envrc', 'credentials.json', 'id_rsa', 'private.key', 'auth.json', '.npmrc'])
def test_private_names_blocked(setup, name):
    root, outside, browser, client = setup
    (root / name).write_text('private fixture')
    response = client.get('/api/file', params={'root': 'test', 'path': name})
    assert response.status_code == 403
    assert 'private fixture' not in response.text


def test_links_never_followed(setup):
    root, outside, browser, client = setup
    (root / 'linked-dir').symlink_to(outside, target_is_directory=True)
    (root / 'linked-file.txt').symlink_to(outside / 'outside.txt')
    for path in ('linked-dir/outside.txt', 'linked-file.txt'):
        assert client.get('/api/file', params={'root': 'test', 'path': path}).status_code == 403
    listing = client.get('/api/files', params={'root': 'test'}).json()
    assert all(e['protected'] for e in listing['entries'] if e['kind'] == 'link')


def test_directory_swap_cannot_escape_pinned_descriptor(setup, monkeypatch):
    root, outside, browser, client = setup
    original_open = os.open
    def open_with_swap(path, flags, *args, **kwargs):
        if path == 'sample.py' and kwargs.get('dir_fd') is not None:
            (root / 'src').rename(root / 'old-src')
            (root / 'src').symlink_to(outside, target_is_directory=True)
        return original_open(path, flags, *args, **kwargs)
    monkeypatch.setattr(os, 'open', open_with_swap)
    response = client.get('/api/file', params={'root': 'test', 'path': 'src/sample.py'})
    assert response.status_code == 200
    assert response.json()['content'].startswith('def health():')


def test_special_and_binary_files_are_not_read(setup):
    root, outside, browser, client = setup
    os.mkfifo(root / 'pipe')
    (root / 'binary.bin').write_bytes(b'\x00\xff\x01')
    (root / 'other-encoding.txt').write_bytes(b'\xff\xfeabc')
    for name in ('pipe', 'binary.bin', 'other-encoding.txt'):
        assert client.get('/api/file', params={'root': 'test', 'path': name}).status_code == 415


def test_preview_is_bounded_and_utf8_safe(setup):
    root, outside, browser, client = setup
    (root / 'large.txt').write_text('€' * (MAX_PREVIEW // 3 + 100))
    data = client.get('/api/file', params={'root': 'test', 'path': 'large.txt'}).json()
    assert data['truncated']
    assert len(data['content'].encode()) <= MAX_PREVIEW
    assert '\ufffd' not in data['content']
    assert data['size'] > data['preview_bytes']


def test_obvious_credentials_never_leave_preview(setup):
    root, outside, browser, client = setup
    (root / 'unexpected.txt').write_text('sk-' + 'x' * 40)
    (root / 'settings.json').write_text('{\n"api_key": "' + 'x' * 40 + '"\n}')
    for name in ('unexpected.txt', 'settings.json'):
        assert client.get('/api/file', params={'root': 'test', 'path': name}).status_code == 403


def test_filename_search_is_scoped_and_skips_protected_trees(setup):
    root, outside, browser, client = setup
    (root / '.git').mkdir()
    (root / '.git' / 'sample.py').write_text('ignored')
    data = client.get('/api/search', params={'root': 'test', 'q': 'sample', 'hidden': True}).json()
    assert [e['path'] for e in data['entries']] == ['src/sample.py']
    assert client.get('/api/search', params={'root': 'test', 'q': 'a'}).status_code == 400


@pytest.mark.parametrize('method', ['post', 'put', 'patch', 'delete', 'options'])
def test_all_mutation_methods_are_rejected(setup, method):
    root, outside, browser, client = setup
    before = (root / 'README.md').read_bytes()
    response = getattr(client, method)('/api/file?root=test&path=README.md')
    assert response.status_code == 405
    assert (root / 'README.md').read_bytes() == before


def test_host_and_cross_site_boundary(setup):
    client = setup[3]
    assert client.get('/api/locations', headers={'Host': 'attacker.example'}).status_code == 421
    assert client.get('/api/locations', headers={'Sec-Fetch-Site': 'cross-site'}).status_code == 403
    assert client.get('/api/locations', headers={'Sec-Fetch-Site': 'same-origin'}).status_code == 200
    assert client.get('/api/locations').headers['x-frame-options'] == 'DENY'
    assert client.get('/api/file', params={'root': 'unknown', 'path': 'README.md'}).status_code == 404


def test_no_descriptor_leak_on_rejected_reads(setup):
    root, outside, browser, client = setup
    (root / 'link.txt').symlink_to(outside / 'outside.txt')
    before = len(os.listdir('/proc/self/fd'))
    for _ in range(30):
        assert client.get('/api/file', params={'root': 'test', 'path': 'link.txt'}).status_code == 403
    assert len(os.listdir('/proc/self/fd')) <= before + 2


def test_service_observer_staleness(tmp_path, monkeypatch):
    file = tmp_path / 'services.json'
    monkeypatch.setenv('CANOPY_SERVICES_FILE', str(file))
    assert read_services()['stale']
    file.write_text('{"timestamp": 1, "services": []}')
    assert read_services()['stale']
    file.write_text('{"timestamp": ' + str(time.time()) + ', "services": []}')
    assert not read_services()['stale']


def test_collector_uses_real_samples_and_keeps_history_bounded():
    collector = Collector()
    collector.sample()
    first = collector.get()
    assert first['cpu'] is None
    assert first['network']['rx'] is None
    assert first['memory']['total'] > 0
    assert first['memory']['used'] + first['memory']['available'] == first['memory']['total']
    collector.sample()
    second = collector.get()
    assert 0 <= second['cpu'] <= 100
    assert len(second['history']) == 2
    assert collector.history.maxlen == 1800
    assert 'cmdline' not in str(second['processes'][0].keys())
    assert 'environ' not in str(second['processes'][0].keys())


def test_service_observer_uses_only_read_methods(monkeypatch):
    import json
    from types import SimpleNamespace
    from backend.services_probe import probe
    commands = []
    def run(command, **kwargs):
        commands.append(command)
        if 'ListUnits' in command:
            rows = [['example.service', 'Example', 'loaded', 'active', 'running', '', '/unit/example', 0, '', '/'],
                    ['example.timer', 'Timer', 'loaded', 'active', 'waiting', '', '/unit/timer', 0, '', '/']]
            return SimpleNamespace(stdout=json.dumps({'data': [rows]}))
        assert 'get-property' in command
        return SimpleNamespace(stdout=json.dumps({'data': int((time.monotonic() - 60) * 1_000_000)}))
    monkeypatch.setattr('backend.services_probe.subprocess.run', run)
    data = probe()
    assert len(data['services']) == 1
    assert 59 < data['services'][0]['uptime'] < 62
    assert all('--address=unix:path=/run/user/1000/bus' in command for command in commands)
    assert not any('systemd/private' in argument for command in commands for argument in command)
