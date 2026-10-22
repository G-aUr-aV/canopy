from __future__ import annotations

from contextlib import asynccontextmanager
import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from .auth import AuthStore, COOKIE, TTL

from .files import FileBrowser, FileProblem, Location
from .metrics import Collector, read_services


BASE = Path(__file__).resolve().parent.parent
DEFAULT_LOCATIONS = [
    Location("repos", "Repositories", "/home/ubuntu/workspace/repos", "/home/ubuntu/workspace/repos", "Project code and applications"),
    Location("ops", "Operations", "/home/ubuntu/workspace/ops", "/home/ubuntu/workspace/ops", "Runbooks and service definitions"),
    Location("vaults", "Vaults", "/home/ubuntu/vaults", "/home/ubuntu/vaults", "Notes and knowledge"),
    Location("system", "System files", "/etc", "/etc", "Readable system configuration"),
]


def create_app(browser: FileBrowser | None = None, collect: bool = True, auth: AuthStore | None = None):
    if browser is None:
        raw = os.environ.get("CANOPY_ROOTS_JSON")
        browser = FileBrowser([Location(**x) for x in json.loads(raw)] if raw else DEFAULT_LOCATIONS)
    collector = Collector()
    auth = auth or AuthStore(Path(os.getenv("CANOPY_AUTH_FILE", "/var/lib/canopy/auth.json")))

    @asynccontextmanager
    async def lifespan(app):
        if collect:
            collector.start()
        yield
        if collect:
            collector.stop()

    app = FastAPI(title="Canopy", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.collector = collector
    app.state.browser = browser
    app.state.auth = auth

    @app.middleware("http")
    async def boundary(request: Request, call_next):
        # App sessions protect all private reads, including requests over the HTTPS tunnel.
        # Exact Host checks also prevent DNS rebinding; only auth endpoints accept writes.
        host = request.headers.get("host", "").lower()
        allowed = {"localhost:4319", "127.0.0.1:4319", "localhost:4320", "127.0.0.1:4320"}
        if not collect:
            allowed.add("testserver")
        configured = os.getenv("CANOPY_PUBLIC_HOST", "").strip().lower()
        if configured:
            allowed.add(configured)
        auth_writes = {"/api/auth/login", "/api/auth/password", "/api/auth/logout"}
        write = request.method == "POST" and request.url.path in auth_writes
        expected_origin = ("https://" if host == configured else request.url.scheme + "://") + host
        if host not in allowed:
            response = JSONResponse({"detail": "This host is not configured for Canopy."}, status_code=421)
        elif request.method not in ("GET", "HEAD") and not write:
            response = JSONResponse({"detail": "Canopy is read only."}, status_code=405, headers={"Allow": "GET, HEAD"})
        elif request.headers.get("sec-fetch-site") == "cross-site" and not (
            request.url.path == "/" and request.headers.get("sec-fetch-mode") == "navigate"
            and request.headers.get("sec-fetch-dest") == "document"
        ):
            response = JSONResponse({"detail": "Cross-site resource requests are not allowed."}, status_code=403)
        elif write and request.headers.get("origin") != expected_origin:
            response = JSONResponse({"detail": "Use this app's own sign-in form."}, status_code=403)
        elif request.url.path.startswith("/api/") and not request.url.path.startswith("/api/auth/"):
            session = auth.session(request.cookies.get(COOKIE))
            if not session:
                response = JSONResponse({"detail": "Sign in to continue."}, status_code=401)
            elif session["must_change_password"]:
                response = JSONResponse({"detail": "Set your own password to continue."}, status_code=428)
            else:
                response = await call_next(request)
        else:
            response = await call_next(request)
        response.headers.update({
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        })
        return response

    @app.exception_handler(FileProblem)
    async def file_error(request, exc):
        return JSONResponse({"detail": str(exc)}, status_code=exc.status)

    @app.get("/readyz")
    def readiness():
        return {"status": "ok", "app": "canopy", "read_only": True, "authentication": "password", "auth_configured": auth.config is not None}

    def session_payload(token):
        session = auth.session(token)
        return {"authenticated": bool(session), "username": "owner" if session else None,
                "must_change_password": bool(session and session["must_change_password"]),
                "csrf": session["csrf"] if session else None, "session_hours": 24}

    def signed_in(token):
        response = JSONResponse(session_payload(token))
        response.set_cookie(COOKIE, token, max_age=TTL, secure=True, httponly=True,
                            samesite="strict", path="/")
        return response

    async def payload(request):
        if request.headers.get("content-type", "").split(";")[0] != "application/json":
            raise HTTPException(415, "Send a JSON sign-in request.")
        data = bytearray()
        async for chunk in request.stream():
            if len(data) + len(chunk) > 4096:
                raise HTTPException(413, "The sign-in request is too large.")
            data.extend(chunk)
        try:
            value = json.loads(data)
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, "Invalid sign-in request.") from None
        if not isinstance(value, dict):
            raise HTTPException(400, "Invalid sign-in request.")
        for text in value.values():
            if not isinstance(text, str) or len(text.encode()) > 1024:
                raise HTTPException(400, "Each sign-in field must be text of at most 1024 bytes.")
        return value

    @app.get("/api/auth/session")
    def auth_session(request: Request):
        auth.ready()
        return session_payload(request.cookies.get(COOKIE))

    @app.post("/api/auth/login")
    async def login(request: Request):
        value = await payload(request)
        token = await run_in_threadpool(auth.login, value.get("username", ""), value.get("password", ""))
        return signed_in(token)

    @app.post("/api/auth/password")
    async def change_password(request: Request):
        value = await payload(request)
        token = await run_in_threadpool(auth.change, request.cookies.get(COOKIE),
                                       request.headers.get("x-csrf-token", ""),
                                       value.get("current", ""), value.get("new", ""))
        return signed_in(token)

    @app.post("/api/auth/logout")
    def logout(request: Request):
        auth.logout(request.cookies.get(COOKIE), request.headers.get("x-csrf-token", ""))
        response = JSONResponse({"authenticated": False})
        response.delete_cookie(COOKIE, secure=True, httponly=True, samesite="strict", path="/")
        return response

    @app.get("/api/metrics")
    def metrics(minutes: int = Query(15, ge=1, le=60)):
        data = collector.get(minutes)
        if data is None:
            return JSONResponse({"detail": "Collecting the first system snapshot."}, status_code=503)
        return data

    @app.get("/api/services")
    def services():
        return read_services()

    @app.get("/api/locations")
    def locations():
        return [{"id": x.id, "name": x.name, "path": x.display_path, "description": x.description}
                for x in browser.locations.values()]

    @app.get("/api/files")
    def files(root: str, path: str = "", hidden: bool = False):
        return browser.entries(root, path, hidden)

    @app.get("/api/file")
    def file(root: str, path: str):
        return browser.read(root, path)

    @app.get("/api/search")
    def search(root: str, q: str, path: str = "", hidden: bool = False):
        return browser.search(root, q, path, hidden)

    static = BASE / "dist/client"
    if static.exists():
        app.mount("/assets", StaticFiles(directory=static / "assets"), name="assets")
        app.mount("/brand", StaticFiles(directory=static / "brand"), name="brand")

        @app.get("/manifest.webmanifest")
        def manifest():
            return FileResponse(static / "manifest.webmanifest", media_type="application/manifest+json")

        @app.get("/")
        def index():
            return FileResponse(static / "index.html")

    return app


app = create_app()
