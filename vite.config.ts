import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync('./package.json', 'utf8')) as {
  name: string;
  version: string;
  description: string;
  homepage: string;
};

/**
 * Display name of the app, shared by the browser tab and the manifest entry.
 * index.html carries it as the %APP_TITLE% placeholder; the description it
 * carries as %APP_DESCRIPTION% comes straight from package.json.
 */
const APP_TITLE = 'Suffix Explorer';

const MIME: Record<string, string> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/**
 * Resolves the `--base-url` option for `npm run build` and `npm run dev`:
 *
 *   npm run build --base-url=/app/
 *   npm run dev   --base-url=/app/
 *
 * npm turns a flag written *before* the script's own `--` into config, which it
 * passes down as `npm_config_base_url`. It has to be written that way: after a
 * `--` the flag is forwarded to Vite's CLI instead, which rejects options it
 * does not know before this config is ever loaded.
 *
 * Unset (or empty) keeps the relative default, which lets the built page work
 * from a file server root or under any path the host serves it from.
 */
function resolveBaseUrl(): string {
  const raw = process.env.npm_config_base_url?.trim();

  // npm sets the config to the string "true" for a bare `--base-url`.
  if (!raw || raw === 'true') return './';

  // Explicitly relative, or an absolute URL: pass through, trailing slash only.
  if (raw === '.' || raw === './') return './';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw.endsWith('/') ? raw : `${raw}/`;

  // Otherwise a server-absolute path, which Vite wants bounded by slashes.
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return path.endsWith('/') ? path : `${path}/`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Substitutes %NAME% placeholders in index.html, so the page and the manifest
 * are filled from the same values instead of drifting apart. Runs in dev and
 * build alike.
 */
function htmlVariables(variables: Record<string, string>): Plugin {
  return {
    name: 'pubsuffix-wla:html-variables',
    transformIndexHtml(html) {
      return Object.entries(variables).reduce(
        // A function replacement, so $-sequences in a value stay literal.
        (out, [name, value]) => out.replace(new RegExp(`%${name}%`, 'g'), () => escapeHtml(value)),
        html,
      );
    },
  };
}

/**
 * The path every manifest URL is prefixed with. libnetq's WebManifest reads the
 * "base" key but never applies it (see WebManifest.c), so each `files[].url`
 * has to be the final URL the server will answer on.
 */
function manifestUrlBase(base: string): string {
  if (base.startsWith('.')) return '/';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) return new URL(base).pathname;
  return base;
}

/**
 * The URL index.html is answered on: the `--base-url` path exactly as given, so
 * `--base-url=/123` serves the page on /123 rather than /123/. Unset or
 * relative falls back to the manifest base.
 */
function manifestIndexUrl(urlBase: string): string {
  const raw = process.env.npm_config_base_url?.trim();
  if (!raw || raw === 'true' || raw.startsWith('.')) return urlBase;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return new URL(raw).pathname;
  return raw.startsWith('/') ? raw : `/${raw}`;
}

/**
 * Writes dist/manifest.json for libnetq's WebManifest executor. It has to be
 * generated rather than checked in: `emptyOutDir` clears dist/ on every build,
 * and the URLs have to track whatever `--base-url` resolved to.
 */
function webManifest(base: string, title: string): Plugin {
  return {
    name: 'pubsuffix-wla:web-manifest',
    apply: 'build',
    // writeBundle, not generateBundle: index.html and the stylesheet are only
    // added to the bundle by Vite's own hooks, which run after this plugin's.
    writeBundle(options, bundle) {
      const urlBase = manifestUrlBase(base);
      const indexUrl = manifestIndexUrl(urlBase);

      // Bundled output plus anything copied verbatim out of public/.
      const names = [
        ...Object.keys(bundle),
        ...readdirSync('public', { withFileTypes: true })
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name),
      ].sort();

      const files = names.map((name) =>
        name === 'index.html'
          ? { url: indexUrl, file: name, type: MIME['.html'] }
          : {
              url: `${urlBase}${name}`,
              file: name,
              type: MIME[extname(name)] ?? 'application/octet-stream',
            },
      );

      const icons = ['light', 'dark'].map((colorScheme) => ({
        url: `${urlBase}favicon.svg`,
        colorScheme,
      }));

      // Card art the host's main page presents the module with.
      const screenshots = ['light', 'dark'].map((colorScheme) => ({
        url: `${urlBase}logo_wla.svg`,
        colorScheme,
      }));

      const manifest = {
        name: pkg.name,
        base: urlBase,
        entries: [
          {
            title,
            version: pkg.version,
            description: pkg.description,
            main: indexUrl,
            icons,
            screenshots,
          },
        ],
        files,
      };

      writeFileSync(
        join(options.dir ?? 'dist', 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    },
  };
}

const base = resolveBaseUrl();

// Standard Vite build, tuned so `dist/` contains exactly four client files
// plus the generated manifest:
//   index.html, app.js, app.css, favicon.svg, manifest.json
export default defineConfig({
  // Prefixes every generated asset URL, in both `vite build` and `vite dev`.
  base,
  // Compile-time constants from package.json, declared in src/vite-env.d.ts.
  define: {
    __HOMEPAGE__: JSON.stringify(pkg.homepage),
  },
  plugins: [
    react(),
    htmlVariables({ APP_TITLE, APP_DESCRIPTION: pkg.description }),
    webManifest(base, APP_TITLE),
  ],
  server: {
    port: 5173,
    watch: {
      // bitmake unpacks every bundled dependency under build/ — tens of
      // thousands of files that have nothing to do with the client, and that
      // otherwise exhaust the inotify watch limit (ENOSPC) on startup.
      ignored: ['**/build/**', '**/dist/**'],
    },
    // During `npm run dev` the UI runs on :5173 and the emulation server on
    // :3001 — proxy the JSON API across so the browser stays same-origin.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Keep the favicon (and any other asset) as a real file, never inlined.
    assetsInlineLimit: 0,
    // One stylesheet, not per-chunk CSS.
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks: undefined,
        entryFileNames: 'app.js',
        chunkFileNames: 'app-[name].js',
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith('.css')) return 'app.css';
          return '[name][extname]';
        },
      },
    },
  },
});
