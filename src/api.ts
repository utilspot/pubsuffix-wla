import type { DomainInfoRequest, DomainInfoResponse } from './types';

/** Same-origin by default; override with VITE_API_BASE for split dev servers. */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

/**
 * Mirrors PUBSUFFIX_PSL_URL (CMakeLists.txt / config.h.in), which module.c
 * registers as `${PUBSUFFIX_ROOT_URL}psl`. CMake passes the same base to the
 * build as `--base-url`, which Vite exposes as BASE_URL (always slash-terminated).
 */
const API_PATH = `${import.meta.env.BASE_URL}psl`;

async function postJSON<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Could not reach the API at "${API_BASE || location.origin}${path}". ` +
        `Is the emulation server running (npm run server)?`,
    );
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Expected JSON from ${path} but got (${res.status}): ${text.slice(0, 200)}`,
      );
    }
  }

  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : res.statusText || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data as TRes;
}

export function domainInfo(req: DomainInfoRequest): Promise<DomainInfoResponse> {
  return postJSON<DomainInfoRequest, DomainInfoResponse>(API_PATH, req);
}
