# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Canopy product decisions

- The owner selected the first light/forest-green overview design. References are in `docs/design/`.
- Provide a desktop sidebar hide/show control that expands the content area. Preserve its preference only in browser local storage.
- This is one responsive web app for desktop and mobile browsers, with bottom navigation on phones and a full-width code reader. Do not add a simulated device frame.
- Use live EC2 measurements. Never replace production data with mock charts or fake service states.
- Server filesystem access is read-only, scoped, bounded, and descriptor-relative. Never add terminal, restart, upload, editing, or deletion endpoints.
- No application database or durable metrics history. The owner authorized a private password hash file for authentication; ask before adding other persistence.
- The owner replaced the unreliable email OTP gate with app-managed password login on 20 October 2026. Use a plain random Cloudflare Quick Tunnel only after verifying the app denies anonymous private API reads.
- Keep the origin on loopback. The app enforces authentication on every private API, with a private scrypt hash file and bounded in-memory 24-hour sessions. Never trust client identity headers or persist session tokens in browser storage.
- Production runs on EC2 with FastAPI. A static Sites deployment alone cannot supply the host data.
- The protected web manifest must use `crossorigin="use-credentials"`, standard 192px/512px icons and explicit scope. Keep an actionable browser-specific installation fallback when the native prompt is unavailable. Do not add offline caching of private data.
- Treat API 401/428 and unexpected auth redirects as access-required. Unmount private views and polling, show password login and preserve the hash route. Keep offline/gateway failures distinct. Never roll back to a pre-auth release while a plain tunnel is running.
