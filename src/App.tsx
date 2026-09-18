import { DomainPanel } from './components/DomainPanel';

/**
 * The app is served from the site root unless it was built with an explicit
 * `--base-url`; only then is there somewhere else to go "home" to. Vite's
 * default (relative `./`) counts as root: the page could be anywhere.
 */
const BASE_URL = import.meta.env.BASE_URL;
const SHOW_HOME = BASE_URL !== '/' && BASE_URL !== './';

// The page is served at the base URL without its trailing slash ("/123"; see
// manifestIndexUrl in vite.config.ts), except for the site root and a relative
// build, which stay as they are.
const MAIN_URL = SHOW_HOME ? BASE_URL.slice(0, -1) : BASE_URL;

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="header-start">
          <a className="brand" href={MAIN_URL}>
            <img src={`${BASE_URL}favicon.svg`} alt="" width={28} height={28} />
            <span>Suffix Explorer</span>
          </a>
          {SHOW_HOME && (
            <a className="header-link" href="/">
              Home
            </a>
          )}
        </div>
      </header>

      <main className="container">
        <DomainPanel />
      </main>

      <footer className="site-footer">
        <span>
          Copyright © 2026 · MIT · <a href={__HOMEPAGE__}>GitHub</a>
        </span>
      </footer>
    </div>
  );
}
