# Canopy

A read-only Linux and EC2 observatory with resource metrics, process and service views, and a bounded source/Markdown reader. Uses React, TypeScript, Vite, FastAPI and psutil. No metrics database is required.

## Develop and verify

```sh
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock
npm run typecheck
npm run test:backend
npm run build
```

`npm run test:local` runs a disposable local integration environment. Browser fixtures contain invented data. Review the templates under `deploy/` for your own service user, filesystem mounts and approved roots before installing. The provided Linux account paths are deployment examples, not runtime data.

Keep the application on loopback and configure an exact public HTTPS host when forwarding it. Authentication uses a private scrypt hash file and bounded in-memory sessions; initial sign-in requires replacing the generated password. Credentials belong outside the repository. System and file APIs stay read-only and deny unauthenticated access. No terminal or file-write endpoint is included.

See [product scope](docs/PRODUCT.md) and [password operations](docs/PASSWORD_LOGIN.md). Sites packaging supports the frontend scaffold; a static deployment alone cannot provide host data.
