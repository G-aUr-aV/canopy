#!/usr/bin/env python3
"""Expose only the password-protected Canopy origin through the supported helper."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit
from urllib.request import urlopen
from urllib.error import HTTPError


ORIGIN = 'http://127.0.0.1:4319'
HELPER = '/home/ubuntu/.agents/skills/public-endpoint/scripts/quick_tunnel.py'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['start', 'status', 'stop'])
    args = parser.parse_args()
    command = ['/usr/bin/python3', HELPER, args.action, ORIGIN]
    if args.action == 'start':
        with urlopen(ORIGIN + '/readyz', timeout=5) as response:
            ready = json.load(response)
        if ready.get('authentication') != 'password' or ready.get('auth_configured') is not True:
            raise SystemExit('A configured password gate is required before public access.')
        try:
            with urlopen(ORIGIN + '/api/metrics', timeout=5):
                raise SystemExit('Refusing public access: anonymous system data was readable.')
        except HTTPError as error:
            if error.code != 401:
                raise SystemExit('The anonymous API denial check failed.')
    env = {**os.environ, 'PATH': '/opt/canopy/tools:' + os.environ.get('PATH', '')}
    result = subprocess.run(command, env=env, capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(result.stderr or 'The scoped tunnel command failed.')
    data = json.loads(result.stdout)
    if args.action == 'start':
        host = urlsplit(data.get('url', '')).hostname or ''
        if not re.fullmatch(r'[a-z0-9-]+\.trycloudflare\.com', host):
            raise SystemExit('The helper did not return a valid Quick Tunnel hostname.')
        # systemd reads the root-owned runtime override before dropping privileges.
        payload = ('CANOPY_PUBLIC_HOST=' + host + '\n').encode()
        subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/tee', '/run/canopy-public-origin.env'], input=payload, stdout=subprocess.DEVNULL, check=True)
        subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/chmod', '600', '/run/canopy-public-origin.env'], check=True)
        subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/mkdir', '-p', '/run/systemd/system/canopy.service.d'], check=True)
        subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/tee', '/run/systemd/system/canopy.service.d/90-public-origin.conf'], input=b'[Service]\nEnvironmentFile=/run/canopy-public-origin.env\n', stdout=subprocess.DEVNULL, check=True)
        subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/systemctl', 'daemon-reload'], check=True)
        subprocess.run(['/usr/bin/sudo', '-n', '/usr/bin/systemctl', 'restart', 'canopy.service'], check=True)
    print(json.dumps(data, indent=2))


if __name__ == '__main__':
    main()
