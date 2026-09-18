import type { SuffixType } from '../types';

export interface SuffixTypeMeta {
  key: SuffixType;
  label: string;
  hint: string;
}

/** PSL_TYPE_* bits, in the order libpsl.h declares them. */
export const SUFFIX_TYPE_META: SuffixTypeMeta[] = [
  { key: 'icann', label: 'ICANN', hint: 'Suffixes delegated by ICANN (PSL_TYPE_ICANN)' },
  { key: 'private', label: 'Private', hint: 'Privately submitted suffixes, e.g. github.io (PSL_TYPE_PRIVATE)' },
  { key: 'no_star_rule', label: 'No star rule', hint: 'Exclude the wildcard-derived "*.tld" placeholder rule (PSL_TYPE_NO_STAR_RULE)' },
];

/** libpsl's own default when no types are given: ICANN + PRIVATE. */
export function defaultSuffixTypes(): SuffixType[] {
  return ['icann', 'private'];
}

export const SAMPLE_DOMAINS: string[] = [
  'www.example.com',
  'example.co.uk',
  'sub.example.github.io',
  'münchen.de',
  'a.b.ck',
  'localhost',
];

export const SAMPLE_COOKIE_PAIRS: { hostname: string; cookieDomain: string }[] = [
  { hostname: 'www.example.com', cookieDomain: 'example.com' },
  { hostname: 'www.example.com', cookieDomain: '.com' },
  { hostname: 'a.b.example.github.io', cookieDomain: 'example.github.io' },
];
