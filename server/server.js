// Emulation server for the libpsl WLA UI.
//
// - Zero dependencies (Node built-ins only).
// - POST /psl performs the endpoint's one operation (domain_info — the
//   request body carries its arguments directly, no "method" field) and
//   returns *hardcoded* JSON taken from server/presets.json.
// - GET /admin.html serves an admin page that picks which preset (or a custom
//   JSON blob) each endpoint returns; it persists the choice to server/state.json.
// - Also statically serves the built client from ../dist for convenience.

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(__dirname, '..', 'dist');
const PRESETS_FILE = join(__dirname, 'presets.json');
const STATE_FILE = join(__dirname, 'state.json');
const ADMIN_FILE = join(__dirname, 'admin.html');

const PORT = Number(process.env.PORT) || 3001;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...CORS,
  });
  res.end(payload);
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolveBody, rejectBody) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        rejectBody(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rejectBody);
  });
}

/** Resolve the configured response for an endpoint (e.g. "domain_info"). */
async function resolveResponse(endpoint, receivedRequest) {
  const [presets, state] = await Promise.all([
    readJson(PRESETS_FILE),
    readJson(STATE_FILE),
  ]);
  const cfg = state[endpoint] ?? { mode: 'preset', presetId: null };

  let body;
  if (cfg.mode === 'custom') {
    try {
      body = JSON.parse(cfg.customJson);
    } catch (err) {
      const e = new Error(`Custom JSON for "${endpoint}" is invalid: ${err.message}`);
      e.status = 500;
      throw e;
    }
  } else {
    const preset = presets[endpoint]?.[cfg.presetId];
    if (!preset) {
      const e = new Error(
        `No preset "${cfg.presetId}" for "${endpoint}". Pick one in /admin.html.`,
      );
      e.status = 500;
      throw e;
    }
    body = structuredClone(preset.response);
  }

  return {
    ...body,
    _emulation: {
      server: 'libpsl-emulation',
      endpoint,
      mode: cfg.mode,
      presetId: cfg.mode === 'preset' ? cfg.presetId : null,
      receivedRequest,
    },
  };
}

async function validateAndSaveState(incoming) {
  const presets = await readJson(PRESETS_FILE);
  const next = {};
  // Every method that presets.json knows about is configurable.
  for (const endpoint of Object.keys(presets)) {
    const cfg = incoming?.[endpoint] ?? {};
    const mode = cfg.mode === 'custom' ? 'custom' : 'preset';
    const presetId = String(cfg.presetId ?? '');
    const customJson = typeof cfg.customJson === 'string' ? cfg.customJson : '';

    if (mode === 'preset' && !presets[endpoint]?.[presetId]) {
      throw new Error(`Unknown ${endpoint} preset: "${presetId}"`);
    }
    if (mode === 'custom') {
      try {
        JSON.parse(customJson);
      } catch (err) {
        throw new Error(`Invalid custom JSON for ${endpoint}: ${err.message}`);
      }
    }
    next[endpoint] = { mode, presetId, customJson };
  }
  await writeFile(STATE_FILE, JSON.stringify(next, null, 2) + '\n');
  return next;
}

async function serveStatic(res, urlPath) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const filePath = rel === '' || rel === sep ? join(DIST_DIR, 'index.html') : join(DIST_DIR, rel);

  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      'Not found.\n\nThe client is not built yet — run `npm run build`, ' +
        'or use the Vite dev server on http://localhost:5173.\n',
    );
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(500).end('Read error');
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  try {
    // ---- JSON API -------------------------------------------------------
    // The endpoint's one operation — no "method" field to dispatch on.
    if (req.method === 'POST' && pathname === '/psl') {
      const raw = await readBody(req);
      let parsed = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          return sendJson(res, 400, { error: 'Request body must be valid JSON' });
        }
      }
      const body = await resolveResponse('domain_info', parsed);
      return sendJson(res, 200, body);
    }

    if (req.method === 'GET' && pathname === '/api/presets') {
      return sendJson(res, 200, await readJson(PRESETS_FILE));
    }

    if (req.method === 'GET' && pathname === '/api/state') {
      return sendJson(res, 200, await readJson(STATE_FILE));
    }

    if (req.method === 'POST' && pathname === '/api/state') {
      const raw = await readBody(req);
      let incoming;
      try {
        incoming = JSON.parse(raw);
      } catch {
        return sendJson(res, 400, { error: 'Body must be valid JSON' });
      }
      try {
        const saved = await validateAndSaveState(incoming);
        return sendJson(res, 200, { ok: true, state: saved });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    // ---- Admin page ---------------------------------------------------
    if (req.method === 'GET' && (pathname === '/admin' || pathname === '/admin.html')) {
      const html = await readFile(ADMIN_FILE);
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(html);
    }

    // ---- Static client ----------------------------------------------
    if (req.method === 'GET') {
      return serveStatic(res, pathname);
    }

    return sendJson(res, 405, { error: `Method ${req.method} not allowed for ${pathname}` });
  } catch (err) {
    return sendJson(res, err.status ?? 500, { error: err.message ?? 'Internal error' });
  }
});

server.listen(PORT, () => {
  console.log(`libpsl emulation server → http://localhost:${PORT}`);
  console.log(`  admin page  : http://localhost:${PORT}/admin.html`);
  console.log(`  JSON API    : POST /psl`);
  console.log(
    existsSync(join(DIST_DIR, 'index.html'))
      ? `  client      : http://localhost:${PORT}/  (from dist/)`
      : `  client      : run "npm run build" then reload, or use "npm run dev"`,
  );
});
