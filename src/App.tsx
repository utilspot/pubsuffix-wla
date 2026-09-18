import { DomainPanel } from './components/DomainPanel';

/**
 * The app is served from the site root unless it was built with an explicit
 * `--base-url`; only then is there somewhere else to go "home" to. Vite's
 * default (relative `./`) counts as root: the page could be anywhere.
 */
const BASE_URL = import.meta.env.BASE_URL;
const SHOW_HOME = BASE_URL !== '/' && BASE_URL !== './';

export function App() {
  return (
    <div className="app">
      <header className="hero">
        {SHOW_HOME && (
          <a className="home-link" href="/" aria-label="Home">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5 10v10h5v-6h4v6h5V10" />
            </svg>
            <span>Home</span>
          </a>
        )}
        <div className="hero__inner">
          <h1 className="brand">
            <img src={`${BASE_URL}favicon.svg`} width={40} height={40} alt="" />
            <span>Suffix Explorer</span>
          </h1>
          <p>
            Look up a domain against the Public Suffix List — its registrable
            domain, whether it is a suffix under ICANN or a privately
            submitted rule, and whether a cookie domain is even allowed to be
            set for it.
          </p>
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
