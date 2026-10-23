import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Plugin } from 'vite';

// Auto-start the FastAPI ECG/ML server during `npm run dev`, so the dashboard
// can call /api/v1/ecg/analyze without a second terminal. Dev only.
//
//   PYTHON     python interpreter to use            (default: python3)
//   ML_PORT    port for uvicorn                     (default: 8000)
//   VITE_ML_BASE_URL  if set to a non-local host, spawning is skipped

const PORT = process.env.ML_PORT ?? '8000';

async function alreadyRunning(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 600);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export function mlServer(): Plugin {
  let child: ChildProcess | null = null;

  return {
    name: 'anebilin-ml-server',
    apply: 'serve',

    async configureServer(server) {
      const log = server.config.logger;
      const base = `http://localhost:${PORT}`;

      const configured = process.env.VITE_ML_BASE_URL;
      if (configured && !/localhost|127\.0\.0\.1/.test(configured)) {
        log.info(`[ml] VITE_ML_BASE_URL=${configured} — not starting a local server`);
        return;
      }
      if (await alreadyRunning(`${base}/health`)) {
        log.info(`[ml] already running at ${base}`);
        return;
      }

      const cwd = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ml_server');
      const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');

      child = spawn(
        python,
        ['-m', 'uvicorn', 'api_server:app', '--host', '127.0.0.1', '--port', PORT],
        { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      child.stdout?.on('data', (d) => process.stdout.write(`[ml] ${d}`));
      child.stderr?.on('data', (d) => process.stderr.write(`[ml] ${d}`));
      child.on('error', (err) => {
        log.warn(
          `[ml] could not start ${python}: ${err.message}\n` +
          `[ml] install deps:  cd dashboard/ml_server && pip install -r requirements.txt`,
        );
        child = null;
      });
      child.on('exit', (code) => {
        if (code && code !== 0) log.warn(`[ml] server exited (code ${code})`);
        child = null;
      });

      log.info(`[ml] starting FastAPI analyzer at ${base}`);

      const cleanup = () => {
        if (child && !child.killed) child.kill('SIGTERM');
        child = null;
      };
      // Vite emits 'close' on the http server when the dev process exits (Ctrl-C).
      server.httpServer?.once('close', cleanup);
      process.once('exit', cleanup);
    },
  };
}