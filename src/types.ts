// Wire types shared between the UI and the JSON API.
// These mirror libpsl's public entry points (see build/package/include/libpsl.h).
// Served by a single POST endpoint that does exactly one thing — no `method`
// field, since there is nothing left to discriminate between.

export interface EmulationMeta {
  server: 'libpsl-emulation';
  endpoint: string;
  mode: 'preset' | 'custom';
  presetId: string | null;
  receivedRequest: unknown;
}

export interface ApiError {
  error: string;
}

/* ------------------------------------------------------------------ domain_info */

/** PSL_TYPE_* names accepted by psl_is_public_suffix2's bitmask. */
export type SuffixType = 'icann' | 'private' | 'no_star_rule';

/**
 * The request body for the endpoint's one and only operation. Normalizes a
 * domain (psl_str_to_utf8lower), then checks its suffix status and splits it
 * into its registrable/suffix parts — all against the normalized form, in one
 * round trip. An optional `cookie_domain` folds in a cookie-acceptability
 * check against the same (normalized) domain as hostname. Every response
 * also carries the compiled-in suffix list's own metadata (version, rule
 * counts, built-in table info) — that costs nothing extra to compute, so it
 * is always included.
 */
export interface DomainInfoRequest {
  domain: string;
  /** Omitted or empty = libpsl's own default (icann + private). */
  types?: SuffixType[];
  /** Source encoding of `domain`; omitted assumes it is already UTF-8. */
  encoding?: string;
  /** When given, also checks whether a cookie scoped to this domain may be set for `domain`. */
  cookie_domain?: string;
}

export interface DomainInfoResponse {
  domain: string;
  normalized: string;
  is_public_suffix: boolean;
  /** Absent if domain is not registrable at all (e.g. it is already a public suffix). */
  registrable_domain?: string;
  /** Absent if no public suffix part was found. */
  unregistrable_domain?: string;
  /** Present only when `cookie_domain` was given in the request. */
  cookie_domain?: string;
  cookie_domain_acceptable?: boolean;
  /** The compiled-in suffix list's own version/metadata — present on every response. */
  version: string;
  suffix_count: number;
  suffix_exception_count: number;
  suffix_wildcard_count: number;
  /** Unix seconds; absent if unavailable. */
  builtin_file_time?: number;
  builtin_sha1sum?: string;
  builtin_filename?: string;
  dist_filename?: string;
  builtin_outdated: boolean;
  _emulation?: EmulationMeta;
}
