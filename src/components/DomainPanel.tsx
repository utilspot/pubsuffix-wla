import { useMemo, useState } from 'react';
import { domainInfo } from '../api';
import type { DomainInfoRequest, DomainInfoResponse, SuffixType } from '../types';
import { SAMPLE_COOKIE_PAIRS, SAMPLE_DOMAINS, SUFFIX_TYPE_META, defaultSuffixTypes } from '../lib/psl';
import { JsonView } from './JsonView';
import { CopyButton } from './CopyButton';

const EMPTY = '—';

function formatFileTime(seconds: number | undefined): string {
  if (seconds === undefined) return EMPTY;
  return new Date(seconds * 1000).toISOString();
}

interface RowProps {
  label: string;
  /** Pre-formatted display text; pass EMPTY ("—") for "not filled in yet". */
  value: string;
}

/** One dt/dd row — always rendered as part of the table, filled in once a response lands. Every
 * row shares the same plain style and gets a copy button once it has a real value. The button
 * slot always takes up space (just hidden while empty) so a row's height never jumps when it fills in. */
function Row({ label, value }: RowProps) {
  const isEmpty = value === EMPTY;
  return (
    <div className="components__row">
      <dt>{label}</dt>
      <dd>
        <span className={isEmpty ? 'muted' : undefined}>{value}</span>
        <span style={isEmpty ? { visibility: 'hidden' } : undefined}>
          <CopyButton text={value} />
        </span>
      </dd>
    </div>
  );
}

export function DomainPanel() {
  // The sample picker is a development aid; production builds start empty and
  // lean on the input placeholder instead.
  const [domain, setDomain] = useState(import.meta.env.DEV ? SAMPLE_DOMAINS[0] : '');
  const [types, setTypes] = useState<SuffixType[]>(defaultSuffixTypes());
  const [encoding, setEncoding] = useState('');
  const [cookieDomain, setCookieDomain] = useState('');
  const [cookieSampleIndex, setCookieSampleIndex] = useState(0);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<DomainInfoResponse | null>(null);

  const request = useMemo<DomainInfoRequest>(() => {
    const req: DomainInfoRequest = { domain, types };
    if (encoding.trim()) req.encoding = encoding.trim();
    if (cookieDomain.trim()) req.cookie_domain = cookieDomain.trim();
    return req;
  }, [domain, types, encoding, cookieDomain]);

  function toggleType(key: SuffixType) {
    setTypes((prev) => (prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]));
  }

  function tryCookieExample() {
    const next = (cookieSampleIndex + 1) % SAMPLE_COOKIE_PAIRS.length;
    setCookieSampleIndex(next);
    setDomain(SAMPLE_COOKIE_PAIRS[next].hostname);
    setCookieDomain(SAMPLE_COOKIE_PAIRS[next].cookieDomain);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      setResponse(await domainInfo(request));
    } catch (err) {
      setResponse(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="tool">
      <div className="card">
        <form onSubmit={submit}>
          <label className="field">
            <span className="field__label">Domain</span>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="www.example.com"
              required
            />
          </label>

          {import.meta.env.DEV && (
            <div className="examples">
              <span>Try an example:</span>
              {SAMPLE_DOMAINS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => setDomain(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <details className="options">
            <summary>Optional arguments</summary>

            <div className="options__body options__body--row">
              <fieldset>
                <legend>Suffix types</legend>
                <div className="checks">
                  {SUFFIX_TYPE_META.map((meta) => (
                    <label key={meta.key} className="check" title={meta.hint}>
                      <input
                        type="checkbox"
                        checked={types.includes(meta.key)}
                        onChange={() => toggleType(meta.key)}
                      />
                      <span>{meta.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="options__col">
                <label className="field">
                  <span className="field__label">Cookie domain</span>
                  <input
                    type="text"
                    value={cookieDomain}
                    onChange={(e) => setCookieDomain(e.target.value)}
                    placeholder="example.com"
                  />
                </label>

                <label className="field">
                  <span className="field__label">Encoding</span>
                  <input
                    type="text"
                    value={encoding}
                    onChange={(e) => setEncoding(e.target.value)}
                    placeholder="Optional — leave blank to assume UTF-8"
                  />
                </label>

                {import.meta.env.DEV && (
                  <div className="examples">
                    <button type="button" className="chip" onClick={tryCookieExample}>
                      Try a cookie example
                    </button>
                  </div>
                )}
              </div>
            </div>
          </details>

          {error && <p className="alert">{error}</p>}

          <dl className="components">
            <Row label="Normalized" value={response?.normalized ?? EMPTY} />
            <Row label="Public suffix" value={response ? String(response.is_public_suffix) : EMPTY} />
            <Row
              label="Registrable domain"
              value={response ? (response.registrable_domain ?? 'Not registrable') : EMPTY}
            />
            <Row
              label="Suffix part"
              value={response ? (response.unregistrable_domain ?? 'No public suffix found') : EMPTY}
            />
            <Row label="Cookie domain" value={response?.cookie_domain ?? EMPTY} />
            <Row
              label="Cookie acceptable"
              value={
                response?.cookie_domain_acceptable === undefined
                  ? EMPTY
                  : String(response.cookie_domain_acceptable)
              }
            />
            <Row label="Version" value={response?.version ?? EMPTY} />
            <Row label="Suffix count" value={response ? String(response.suffix_count) : EMPTY} />
            <Row
              label="Exception count"
              value={response ? String(response.suffix_exception_count) : EMPTY}
            />
            <Row
              label="Wildcard count"
              value={response ? String(response.suffix_wildcard_count) : EMPTY}
            />
            <Row label="Built-in file time" value={formatFileTime(response?.builtin_file_time)} />
            <Row label="Built-in SHA-1" value={response?.builtin_sha1sum ?? EMPTY} />
            <Row label="Built-in filename" value={response?.builtin_filename ?? EMPTY} />
            <Row label="Dist filename" value={response?.dist_filename ?? EMPTY} />
            <Row label="Built-in outdated" value={response ? String(response.builtin_outdated) : EMPTY} />
          </dl>

          {response && <JsonView value={response} />}

          <button type="submit" className="btn btn--primary" disabled={pending || !domain.trim()}>
            {pending ? 'Looking up…' : 'Look up domain'}
          </button>
        </form>
      </div>
    </section>
  );
}
