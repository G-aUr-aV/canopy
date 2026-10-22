from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from backend.app import create_app
from backend.auth import AuthStore, COOKIE, TTL, bootstrap, record, write_private

PASSWORD = 'a test-only memorable password'
NEW = 'another test-only long password'
ORIGIN = {'Origin': 'https://testserver'}

@pytest.fixture
def configured(tmp_path):
    path = tmp_path / 'auth.json'
    write_private(path, record(PASSWORD, False))
    clock = [100.0]
    store = AuthStore(path, clock=lambda: clock[0])
    client = TestClient(create_app(collect=False, auth=store), base_url='https://testserver')
    return store, client, clock

def login(client, password=PASSWORD):
    return client.post('/api/auth/login', json={'username': 'owner', 'password': password}, headers=ORIGIN)

def test_every_private_read_is_gated(configured):
    _, client, _ = configured
    for path in ['/api/metrics', '/api/services', '/api/locations', '/api/files?root=repos', '/api/file?root=system&path=passwd', '/api/search?root=repos&q=a']:
        response = client.get(path)
        assert response.status_code == 401
        assert response.json() == {'detail': 'Sign in to continue.'}
        assert response.headers['cache-control'] == 'no-store'
    assert client.get('/readyz').json()['auth_configured'] is True
    assert client.get('/api/auth/session').json()['authenticated'] is False
    assert client.post('/api/files').status_code == 405

def test_session_cookie_absolute_expiry_and_logout(configured):
    store, client, clock = configured
    response = login(client)
    assert response.status_code == 200
    cookie = response.headers['set-cookie']
    for flag in ['Secure', 'HttpOnly', 'SameSite=strict', 'Max-Age=86400', 'Path=/']:
        assert flag in cookie
    assert 'Domain=' not in cookie
    csrf = response.json()['csrf']
    token = client.cookies.get(COOKIE)
    assert client.get('/api/locations').status_code == 200
    clock[0] += TTL - 1
    assert client.get('/api/auth/session').json()['authenticated'] is True
    clock[0] += 2
    assert client.get('/api/locations').status_code == 401
    assert client.get('/api/auth/session').json()['authenticated'] is False
    response = login(client)
    csrf = response.json()['csrf']
    token = client.cookies.get(COOKIE)
    assert client.post('/api/auth/logout', json={}, headers={**ORIGIN, 'X-CSRF-Token': csrf}).status_code == 200
    assert store.session(token) is None
    assert client.get('/api/locations').status_code == 401

def test_first_login_requires_password_change_and_revokes_other_sessions(tmp_path):
    bootstrap(tmp_path)
    secret = (tmp_path / 'initial-login.txt').read_text().split('Temporary password: ')[1].splitlines()[0]
    store = AuthStore(tmp_path / 'auth.json')
    client = TestClient(create_app(collect=False, auth=store), base_url='https://testserver')
    result = login(client, secret).json()
    assert result['must_change_password'] is True
    assert client.get('/api/locations').status_code == 428
    other = store.login('owner', secret)
    headers = {**ORIGIN, 'X-CSRF-Token': result['csrf']}
    assert client.post('/api/auth/password', json={'current': secret, 'new': 'short'}, headers=headers).status_code == 400
    assert client.post('/api/auth/password', json={'current': secret, 'new': secret}, headers=headers).status_code == 400
    response = client.post('/api/auth/password', json={'current': secret, 'new': NEW}, headers=headers)
    assert response.status_code == 200 and response.json()['must_change_password'] is False
    assert store.session(other) is None
    assert not (tmp_path / 'initial-login.txt').exists()
    assert client.get('/api/locations').status_code == 200
    assert login(client, secret).status_code == 401
    assert login(client, NEW).status_code == 200
    assert NEW not in store.path.read_text() and secret not in store.path.read_text()
    assert store.path.stat().st_mode & 0o777 == 0o600
    assert AuthStore(store.path).config['must_change_password'] is False

def test_origin_csrf_and_body_limits(configured):
    _, client, _ = configured
    for headers in [{}, {'Origin': 'https://attacker.example'}, {**ORIGIN, 'Sec-Fetch-Site': 'cross-site'}]:
        assert client.post('/api/auth/login', json={'username': 'owner', 'password': PASSWORD}, headers=headers).status_code == 403
    assert client.post('/api/auth/login', content='{}', headers=ORIGIN).status_code == 415
    assert client.post('/api/auth/login', content='x' * 5000, headers={**ORIGIN, 'Content-Type': 'application/json'}).status_code == 413
    for value in [[], {'password': 1}, {'password': 'x' * 1025}]:
        assert client.post('/api/auth/login', json=value, headers=ORIGIN).status_code == 400
    assert login(client).status_code == 200
    for path in ['/api/auth/password', '/api/auth/logout']:
        assert client.post(path, json={}, headers=ORIGIN).status_code == 403
        assert client.post(path, json={}, headers={**ORIGIN, 'X-CSRF-Token': 'wrong'}).status_code == 403

def test_rate_limit_is_not_bypassed_by_forwarded_address(configured):
    _, client, clock = configured
    for i in range(8):
        response = client.post('/api/auth/login', json={'username': 'wrong', 'password': 'wrong'}, headers={**ORIGIN, 'X-Forwarded-For': f'192.0.2.{i}'})
        assert response.status_code == 401
    assert login(client).status_code == 429
    clock[0] += 61
    assert login(client).status_code == 200

def test_configuration_fails_closed_and_restart_drops_sessions(tmp_path):
    for content in ['bad json', '{}', '[]']:
        p = tmp_path / 'auth.json'
        p.write_text(content); p.chmod(0o600)
        client = TestClient(create_app(collect=False, auth=AuthStore(p)), base_url='https://testserver')
        assert client.get('/api/auth/session').status_code == 503
        assert client.get('/api/locations').status_code == 401
        assert login(client).status_code == 503
    write_private(p, record(PASSWORD, False))
    store = AuthStore(p)
    token = store.login('owner', PASSWORD)
    assert AuthStore(p).session(token) is None
    p.chmod(0o644)
    assert AuthStore(p).config is None
    p.chmod(0o600)
    link = tmp_path / 'linked.json'; link.symlink_to(p)
    assert AuthStore(link).config is None

def test_public_host_requires_https_origin(configured, monkeypatch):
    _, client, _ = configured
    monkeypatch.setenv('CANOPY_PUBLIC_HOST', 'app.example.com')
    for origin, expected in [('http://app.example.com', 403), ('https://app.example.com', 200)]:
        response = client.post('/api/auth/login', json={'username':'owner','password':PASSWORD}, headers={'Host':'app.example.com', 'Origin':origin})
        assert response.status_code == expected
    assert client.get('/api/auth/session', headers={'Host': 'evil.example'}).status_code == 421
