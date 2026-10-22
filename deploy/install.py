#!/usr/bin/env python3
"""Install only Canopy's dedicated services; retain previous releases."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import pwd
import shutil
import subprocess
import time


def run(*args):
    subprocess.run(args, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--wheels', required=True, type=Path)
    parser.add_argument('--connector', required=True, type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run through the approved root installation command.')
    source = args.source.resolve()
    if not (source / 'dist/client/index.html').is_file() or not (source / 'backend/app.py').is_file():
        raise SystemExit('A built Canopy source tree is required.')
    expected = '3bfc539f45d2620c71debb7a86be0efa737ed5ccbad9eb85c787116900e5c586'
    if hashlib.sha256(args.connector.read_bytes()).hexdigest() != expected:
        raise SystemExit('The connector does not match the official 2026.10.1 release checksum.')
    try:
        account = pwd.getpwnam('canopy')
        if account.pw_dir != '/nonexistent' or account.pw_shell not in ('/usr/sbin/nologin', '/sbin/nologin'):
            raise SystemExit('An unrelated canopy account exists; refusing to reuse it.')
    except KeyError:
        run('/usr/sbin/useradd', '--system', '--user-group', '--no-create-home', '--home-dir', '/nonexistent', '--shell', '/usr/sbin/nologin', 'canopy')
    base = Path('/opt/canopy')
    release = base / 'releases' / time.strftime('%Y%m%dT%H%M%S', time.gmtime())
    release.mkdir(parents=True, mode=0o755)
    for name in ['backend', 'dist/client', 'deploy']:
        shutil.copytree(source / name, release / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    shutil.copy2(source / 'requirements.lock', release / 'requirements.lock')
    for parent, directories, files in os.walk(release):
        os.chmod(parent, 0o755)
        for name in files:
            os.chmod(Path(parent) / name, 0o644)
    if not (base / 'venv/bin/python').exists():
        run('/usr/bin/python3', '-m', 'venv', str(base / 'venv'))
    run(str(base / 'venv/bin/python'), '-m', 'pip', 'install', '--no-index', '--find-links', str(args.wheels), '-r', str(release / 'requirements.lock'))
    # Credential operations run as the app account, never as root against app-owned files.
    state = Path('/var/lib/canopy')
    if state.is_symlink():
        raise SystemExit('The private state directory cannot be a symlink.')
    state.mkdir(mode=0o700, exist_ok=True)
    state.chmod(0o700)
    account = pwd.getpwnam('canopy')
    os.chown(state, account.pw_uid, account.pw_gid)
    run('/usr/sbin/runuser', '-u', 'canopy', '--', str(base / 'venv/bin/python'), '-c',
        'import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); from backend.auth import bootstrap, AuthStore; p=Path(sys.argv[2]); bootstrap(p); AuthStore(p / "auth.json").ready()',
        str(release), str(state))
    tools = base / 'tools'
    tools.mkdir(exist_ok=True)
    binary = tools / 'cloudflared-2026.10.1'
    if not binary.exists():
        shutil.copyfile(args.connector, binary)
        binary.chmod(0o755)
    link = tools / 'cloudflared'
    if not link.exists():
        link.symlink_to(binary.name)
    config = Path('/etc/canopy')
    config.mkdir(mode=0o700, exist_ok=True)
    roots = [
        {'id': 'repos', 'name': 'Repositories', 'path': '/srv/canopy/roots/repos', 'display_path': '/home/ubuntu/workspace/repos', 'description': 'Project code and applications'},
        {'id': 'ops', 'name': 'Operations', 'path': '/srv/canopy/roots/ops', 'display_path': '/home/ubuntu/workspace/ops', 'description': 'Runbooks and service definitions'},
        {'id': 'vaults', 'name': 'Vaults', 'path': '/srv/canopy/roots/vaults', 'display_path': '/home/ubuntu/vaults', 'description': 'Notes and knowledge'},
        {'id': 'system', 'name': 'System files', 'path': '/etc', 'display_path': '/etc', 'description': 'Readable system configuration'},
    ]
    env = config / 'server.env'
    if not env.exists():
        env.write_text('CANOPY_LABEL=example-host\nCANOPY_REGION=ap-south-1\nCANOPY_SERVICES_FILE=/run/canopy-services/services.json\nCANOPY_ROOTS_JSON=' + "'" + json.dumps(roots) + "'\n")
        env.chmod(0o600)
    Path('/srv/canopy/roots').mkdir(parents=True, exist_ok=True)
    current = base / 'current'
    if current.exists() and not current.is_symlink():
        raise SystemExit('The current runtime path is not an owned release symlink.')
    previous = current.resolve() if current.is_symlink() else None
    if previous and not previous.is_relative_to(base / 'releases'):
        raise SystemExit('An unrelated runtime symlink exists.')
    temp = base / 'next'
    if temp.exists() or temp.is_symlink():
        raise SystemExit('An unfinished release switch exists; inspect before continuing.')
    temp.symlink_to(release)
    temp.replace(current)
    for name in ['canopy.service', 'canopy-services.service']:
        destination = Path('/etc/systemd/system') / name
        if destination.exists() and 'Canopy read-only' not in destination.read_text():
            raise SystemExit('An unrelated service has the same name: ' + name)
        shutil.copy2(source / 'deploy' / name, destination)
        destination.chmod(0o644)
    run('/usr/bin/systemd-analyze', 'verify', '/etc/systemd/system/canopy.service', '/etc/systemd/system/canopy-services.service')
    run('/usr/bin/systemctl', 'daemon-reload')
    run('/usr/bin/systemctl', 'enable', '--now', 'canopy-services.service', 'canopy.service')
    run('/usr/bin/systemctl', 'restart', 'canopy-services.service', 'canopy.service')
    print(json.dumps({'release': str(release), 'previous_release': str(previous) if previous else None, 'origin': 'http://127.0.0.1:4319'}))


if __name__ == '__main__':
    main()
