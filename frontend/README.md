# PASADA — frontend

This is the **frontend of the PASADA desktop app**, a Tauri v2 project. It is
**not a standalone web app**: at runtime the Tauri shell loads this Next.js
build (the static export in `out/`) into a WebView and talks to the bundled
Python backend on `http://127.0.0.1:43888`.

- Do **not** deploy this to Vercel or treat it as a site. The real product is the
  desktop app built by `npm run tauri build`.
- Backend: `../backend/main.py` (FastAPI + SQLite).
- Docs live in `../docs/` and the project root:
  - `../README.md` — the main product + development guide
  - `../docs/TESTING_ON_LINUX.md` — running and testing on Linux (incl. the
    black-window WebKit workaround)
  - `../docs/FULL_AUDIT.md` — current full-stack audit and gap list
  - `../docs/THREAT_MODEL.md`, `../docs/SYNC_PROTOCOL.md`, `../docs/ISO25010_COMPLIANCE.md`

## Commands

```bash
npm install
npm run dev        # dev server on localhost:3000 (needs the backend running separately)
npm run build      # production static export -> out/ (this is what the webview loads)
npm test           # vitest unit tests
npx playwright test  # E2E against the real desktop stack (run `npm run build` first)
npm run tauri dev  # full desktop app (backend sidecar + webview)
```

The E2E harness (`e2e/support/servers.ts`) boots the real backend on an isolated
`PASADA_DATA_DIR` and serves the production `out/` build, so the flows are tested
against the same bytes and API the packaged app uses — identically on Linux and
Windows.
