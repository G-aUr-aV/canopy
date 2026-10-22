"""Single-owner password authentication; hashes on disk, bounded sessions in RAM."""
from __future__ import annotations

from collections import deque
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import stat
import threading
import time

from fastapi import HTTPException

COOKIE = "__Host-canopy_session"
TTL = 24 * 60 * 60


def digest(password: str, salt: str) -> str:
    # OWASP scrypt baseline, serialized by the store lock to bound memory usage.
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**17,
                          r=8, p=1, maxmem=192 * 1024 * 1024, dklen=64).hex()


def record(password: str, bootstrap: bool) -> dict:
    salt = secrets.token_hex(24)
    return {"version": 1, "username": "owner", "salt": salt,
            "hash": digest(password, salt), "must_change_password": bootstrap}


def write_private(path: Path, value: dict):
    temporary = path.with_name(".auth-" + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def bootstrap(directory: Path):
    directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    if (directory / "auth.json").exists():
        return
    password = secrets.token_urlsafe(24)
    # Exclusive creation preserves an unfinished setup for operator inspection.
    fd = os.open(directory / "initial-login.txt", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write("Username: owner\nTemporary password: " + password + "\nChange this password at first sign-in.\n")
    write_private(directory / "auth.json", record(password, True))


class AuthStore:
    def __init__(self, path: Path, clock=time.monotonic):
        self.path, self.clock = path, clock
        self.lock = threading.RLock()
        self.sessions: dict[str, dict] = {}
        self.attempts: deque[float] = deque()
        self.config = None
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd) as handle:
                info = os.fstat(handle.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 4096:
                    raise ValueError("Private credential file required")
                config = json.load(handle)
            if (config["version"] != 1 or config["username"] != "owner"
                    or len(bytes.fromhex(config["salt"])) != 24
                    or len(bytes.fromhex(config["hash"])) != 64
                    or type(config["must_change_password"]) is not bool):
                raise ValueError("Invalid credential format")
            self.config = config
        except (OSError, ValueError, KeyError, TypeError):
            pass  # Missing or invalid credentials fail closed; never auto-initialize a web request.

    def ready(self):
        if self.config is None:
            raise HTTPException(503, "Sign-in is unavailable. The server needs its private login configuration.")

    def session(self, token: str | None):
        with self.lock:
            now = self.clock()
            self.sessions = {k: v for k, v in self.sessions.items() if v["deadline"] > now}
            return self.sessions.get(token or "")

    def issue(self):
        self.session(None)
        if len(self.sessions) >= 32:
            self.sessions.pop(next(iter(self.sessions)))
        token = secrets.token_urlsafe(32)
        self.sessions[token] = {"csrf": secrets.token_urlsafe(32), "deadline": self.clock() + TTL,
                                "must_change_password": self.config["must_change_password"]}
        return token

    def limit(self):
        now = self.clock()
        while self.attempts and self.attempts[0] <= now - 3600:
            self.attempts.popleft()
        if sum(t > now - 60 for t in self.attempts) >= 8 or len(self.attempts) >= 60:
            raise HTTPException(429, "Too many sign-in attempts. Wait a minute and try again.", headers={"Retry-After": "60"})
        self.attempts.append(now)

    def verify(self, username: str, password: str):
        valid = hmac.compare_digest(digest(password, self.config["salt"]), self.config["hash"])
        return valid and username == "owner"

    def login(self, username: str, password: str):
        with self.lock:
            self.ready()
            self.limit()
            if not self.verify(username, password):
                raise HTTPException(401, "The username or password is incorrect.")
            return self.issue()

    def authorize(self, token: str | None, csrf: str):
        session = self.session(token)
        if not session:
            raise HTTPException(401, "Sign in to continue.")
        if not csrf or not hmac.compare_digest(session["csrf"], csrf):
            raise HTTPException(403, "Refresh the page before trying this action again.")
        return session

    def change(self, token: str | None, csrf: str, current: str, new: str):
        with self.lock:
            self.ready()
            self.authorize(token, csrf)
            self.limit()
            if not self.verify("owner", current):
                raise HTTPException(401, "The current password is incorrect.")
            if len(new) < 15:
                raise HTTPException(400, "Use at least 15 characters for your new password.")
            if current == new:
                raise HTTPException(400, "Choose a different password from your current one.")
            updated = record(new, False)
            try:
                write_private(self.path, updated)
            except OSError:
                raise HTTPException(503, "The password could not be saved. Your current password still works.") from None
            self.config = updated
            self.sessions.clear()
            # This file is only an initial handoff; the old password is now invalid.
            try:
                (self.path.parent / "initial-login.txt").unlink(missing_ok=True)
            except OSError:
                pass
            return self.issue()

    def logout(self, token: str | None, csrf: str):
        with self.lock:
            self.authorize(token, csrf)
            self.sessions.pop(token, None)
