// E2E harness: runs the REAL desktop stack, not a dev server.
//
// The Tauri app loads two things at runtime: the production static export
// (frontend/out, served into the webview) and the Python backend sidecar on
// 127.0.0.1:43888 (the frontend's hardcoded API_URL). This module boots BOTH
// exactly that way, so the Playwright flows exercise the same bytes and the
// same API the packaged desktop app uses, identically on Linux and Windows.
//
// The only parts NOT covered are the thin Tauri shell commands (updater,
// PDF print fallback, native context menu). Those are Rust-side and are
// covered by `cargo check` + manual release testing, documented in TESTING.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import net from "node:net";

const FRONTEND_DIR = join(__dirname, "..", "..");
const BACKEND_DIR = join(FRONTEND_DIR, "..", "backend");
const OUT_DIR = join(FRONTEND_DIR, "out");

// Must match lib/api.ts (API_URL) and the CORS allowlist in main.py.
export const API_PORT = 43888;
export const WEB_PORT = 3000;
export const BASE_URL = `http://localhost:${WEB_PORT}`;

let backendProc: ChildProcess | null = null;
let staticServer: Server | null = null;

function pythonExecutable(): string {
  // Cross-platform venv lookup: bin/python on Linux/macOS, Scripts/python.exe
  // on Windows. Falls back to plain "python" if no venv is present.
  const candidates =
    process.platform === "win32"
      ? [join(BACKEND_DIR, "venv", "Scripts", "python.exe"), "python"]
      : [join(BACKEND_DIR, "venv", "bin", "python"), "python3", "python"];
  for (const c of candidates) {
    if (c === "python" || c === "python3") return c;
    if (existsSync(c)) return c;
  }
  return "python";
}

async function waitForPort(port: number, host: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = net.connect({ port, host }, () => {
        sock.end();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${host}:${port}`);
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Minimal static server that resolves Next export's clean URLs: /dashboard ->
// out/dashboard/index.html, /toda/BATODA -> out/toda/BATODA/index.html.
function serveStatic(root: string, port: number): Server {
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      let filePath = normalize(join(root, urlPath));
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end();
        return;
      }
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, "index.html");
      } else if (!existsSync(filePath)) {
        // Try clean-URL folder form, then .html, then SPA fallback.
        const asIndex = join(root, urlPath, "index.html");
        const asHtml = join(root, `${urlPath}.html`);
        if (existsSync(asIndex)) filePath = asIndex;
        else if (existsSync(asHtml)) filePath = asHtml;
        else filePath = join(root, "404.html");
      }
      if (!existsSync(filePath)) {
        res.writeHead(404).end("Not found");
        return;
      }
      const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      res.end(readFileSync(filePath));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

export async function startStack(): Promise<void> {
  if (!existsSync(OUT_DIR)) {
    throw new Error(
      `Production export not found at ${OUT_DIR}. Run \`npm run build\` first: the E2E tests the real static export the desktop app loads, not a dev server.`
    );
  }

  // Isolated data dir so a test run never touches the real office database,
  // and never rescues an old on-disk DB (database.py honours PASADA_DATA_DIR).
  const dataDir = join(require("node:os").tmpdir(), `pasada-e2e-${Date.now()}`);

  backendProc = spawn(
    pythonExecutable(),
    ["-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(API_PORT), "--log-level", "warning"],
    {
      cwd: BACKEND_DIR,
      env: {
        ...process.env,
        PASADA_DATA_DIR: dataDir,
        PASADA_API_HOST: "127.0.0.1",
        PASADA_HTTP_ACCESS_LOG: "0",
      },
      stdio: "inherit",
    }
  );

  await waitForHttp(`http://127.0.0.1:${API_PORT}/health`, 60000);

  staticServer = serveStatic(OUT_DIR, WEB_PORT);
  await waitForPort(WEB_PORT, "127.0.0.1", 15000);
}

export async function stopStack(): Promise<void> {
  if (backendProc) {
    backendProc.kill("SIGTERM");
    backendProc = null;
  }
  if (staticServer) {
    await new Promise<void>((resolve) => staticServer!.close(() => resolve()));
    staticServer = null;
  }
}
