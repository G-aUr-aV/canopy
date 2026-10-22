"""Bounded, descriptor-relative reads. Symlinks are never followed."""
from __future__ import annotations

import codecs
from contextlib import contextmanager
from dataclasses import dataclass
import errno
import os
from pathlib import PurePosixPath
import re
import stat
import time


class FileProblem(Exception):
    def __init__(self, message: str, status: int = 403):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class Location:
    id: str
    name: str
    path: str
    display_path: str
    description: str = ""


BLOCKED = {".git", ".ssh", ".aws", ".codex", ".config", ".gnupg", ".local",
           ".npmrc", ".pypirc", ".netrc", ".git-credentials", "auth.json",
           "shadow", "gshadow", "shadow-", "gshadow-", "private", "credstore",
           "credstore.encrypted", "letsencrypt", "auth.conf", "auth.conf.d"}
SKIP_SEARCH = {"node_modules", ".venv", "venv", ".cache", "dist", "build", "__pycache__"}
SENSITIVE_NAME = re.compile(r"((?:^|\.)env(?:[._-]|rc|$)|(?:^|[._-])(?:credentials?|secrets?|passwords?|initial-login|id_rsa|id_ed25519)(?:[._-]|$)|\.(?:pem|key|p12|pfx|kdbx)$)", re.I)
SECRET = re.compile(r"-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{28,}\b|(?im:^\s*[\"']?(?:[\w-]*(?:api[_-]?key|secret|password|access[_-]?token)[\w-]*)[\"']?\s*[:=]\s*[\"']?[A-Za-z0-9/+_=.-]{20,})")
MAX_PREVIEW = 256 * 1024
MAX_DIRECTORY = 5000


def protected(name: str) -> bool:
    return name.lower() in BLOCKED or bool(SENSITIVE_NAME.search(name))


def parts_for(path: str) -> tuple[str, ...]:
    if "\\" in path or any(ord(c) < 32 for c in path) or len(path) > 4096:
        raise FileProblem("This path is not supported.", 400)
    if path.startswith("/") or ".." in path.split("/"):
        raise FileProblem("Paths must stay inside the selected location.")
    parts = tuple(p for p in PurePosixPath(path).parts if p != ".")
    if any(protected(p) for p in parts):
        raise FileProblem("This file or directory is protected by the read-only browsing policy.")
    return parts


class FileBrowser:
    def __init__(self, locations: list[Location]):
        self.locations = {x.id: x for x in locations}

    def location(self, root: str) -> Location:
        if root not in self.locations:
            raise FileProblem("Choose a browsing location.", 404)
        return self.locations[root]

    @contextmanager
    def directory(self, root: str, path: str):
        location = self.location(root)
        parts = parts_for(path)
        fd = -1
        try:
            fd = os.open(location.path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
            for part in parts:
                next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                os.close(fd)
                fd = next_fd
            yield fd
        except OSError as exc:
            if exc.errno == errno.ENOENT:
                raise FileProblem("This item no longer exists. Refresh its parent folder.", 404) from None
            raise FileProblem("This directory cannot be read. Links and protected directories are not followed.") from None
        finally:
            if fd >= 0:
                os.close(fd)

    def entries(self, root: str, path: str = "", hidden: bool = False):
        parts_for(path)
        result = []
        scanned = 0
        truncated = False
        with self.directory(root, path) as fd:
            with os.scandir(fd) as entries:
                for entry in entries:
                    scanned += 1
                    if scanned > MAX_DIRECTORY:
                        truncated = True
                        break
                    if not hidden and entry.name.startswith("."):
                        continue
                    try:
                        info = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    is_dir = stat.S_ISDIR(info.st_mode)
                    is_link = stat.S_ISLNK(info.st_mode)
                    blocked = protected(entry.name) or is_link or not (is_dir or stat.S_ISREG(info.st_mode))
                    result.append({"name": entry.name, "path": str(PurePosixPath(path, entry.name)),
                                   "kind": "directory" if is_dir else "link" if is_link else "file",
                                   "size": info.st_size, "modified": info.st_mtime,
                                   "permissions": stat.filemode(info.st_mode), "protected": blocked})
        result.sort(key=lambda x: (x["kind"] != "directory", x["name"].casefold()))
        return {"root": root, "path": path, "entries": result, "truncated": truncated,
                "limit": MAX_DIRECTORY}

    def read(self, root: str, path: str):
        parts = parts_for(path)
        if not parts:
            raise FileProblem("Select a file to read.", 400)
        parent = str(PurePosixPath(*parts[:-1])) if len(parts) > 1 else ""
        with self.directory(root, parent) as parent_fd:
            fd = -1
            try:
                fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent_fd)
                info = os.fstat(fd)
                if not stat.S_ISREG(info.st_mode):
                    raise FileProblem("Only regular text files can be previewed.", 415)
                chunks = []
                remaining = MAX_PREVIEW + 1
                while remaining:
                    chunk = os.read(fd, min(65536, remaining))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    remaining -= len(chunk)
                data = b"".join(chunks)
                truncated = len(data) > MAX_PREVIEW or info.st_size > MAX_PREVIEW
                data = data[:MAX_PREVIEW]
                if b"\0" in data:
                    raise FileProblem("This is a binary file. A text preview is not available.", 415)
                try:
                    text = codecs.getincrementaldecoder("utf-8")("strict").decode(data, final=not truncated)
                except UnicodeDecodeError:
                    raise FileProblem("This file is not UTF-8 text. A preview is not available.", 415) from None
                if SECRET.search(text):
                    raise FileProblem("This file may contain credentials, so its contents are protected.")
                return {"root": root, "path": path, "name": parts[-1], "content": text,
                        "size": info.st_size, "modified": info.st_mtime,
                        "permissions": stat.filemode(info.st_mode), "truncated": truncated,
                        "preview_bytes": len(data), "encoding": "UTF-8"}
            except OSError as exc:
                raise FileProblem("This file cannot be read. It may have moved, be a link, or require additional permissions.",
                                  404 if exc.errno == errno.ENOENT else 403) from None
            finally:
                if fd >= 0:
                    os.close(fd)

    def search(self, root: str, query: str, path: str = "", hidden: bool = False):
        parts_for(path)
        query = query.casefold().strip()
        if not 2 <= len(query) <= 120:
            raise FileProblem("Search for 2–120 characters in a filename.", 400)
        pending = [(path, 0)]
        found = []
        visited = 0
        deadline = time.monotonic() + 1.5
        while pending and visited < MAX_DIRECTORY and len(found) < 100 and time.monotonic() < deadline:
            current, depth = pending.pop()
            try:
                with self.directory(root, current) as fd:
                    with os.scandir(fd) as entries:
                        for entry in entries:
                            visited += 1
                            if visited > MAX_DIRECTORY or time.monotonic() >= deadline or len(found) >= 100:
                                break
                            if protected(entry.name) or entry.name in SKIP_SEARCH or (entry.name.startswith(".") and not hidden):
                                continue
                            try:
                                info = entry.stat(follow_symlinks=False)
                            except OSError:
                                continue
                            is_dir = stat.S_ISDIR(info.st_mode)
                            if not (is_dir or stat.S_ISREG(info.st_mode)):
                                continue
                            child = str(PurePosixPath(current, entry.name))
                            if query in entry.name.casefold():
                                found.append({"name": entry.name, "path": child,
                                              "kind": "directory" if is_dir else "file", "size": info.st_size,
                                              "modified": info.st_mtime, "permissions": stat.filemode(info.st_mode), "protected": False})
                            if is_dir and depth < 6:
                                pending.append((child, depth + 1))
            except FileProblem:
                continue
        return {"entries": found, "visited": visited,
                "limited": bool(pending) or visited >= MAX_DIRECTORY or len(found) >= 100 or time.monotonic() >= deadline,
                "scope": path, "depth_limit": 6}
