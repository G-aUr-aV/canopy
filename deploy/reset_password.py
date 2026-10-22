#!/usr/bin/env python3
"""Operator recovery: run as canopy while canopy.service is stopped, then start it."""
import argparse
import os
from pathlib import Path
import secrets
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.auth import record, write_private


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reset', action='store_true', required=True,
                        help='Replace the owner password with a new temporary password.')
    parser.parse_args()
    state = Path('/var/lib/canopy')
    if os.geteuid() != state.stat().st_uid or state.is_symlink():
        raise SystemExit('Run as the Canopy service account against its private state directory.')
    password = secrets.token_urlsafe(24)
    pending = state / 'initial-login.next'
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as handle:
        handle.write('Username: owner\nTemporary password: ' + password + '\nChange this password at first sign-in.\n')
        handle.flush(); os.fsync(handle.fileno())
    write_private(state / 'auth.json', record(password, True))
    pending.replace(state / 'initial-login.txt')
    print('Temporary login written privately to /var/lib/canopy/initial-login.txt. Start canopy.service to invalidate prior sessions.')


if __name__ == '__main__':
    main()
