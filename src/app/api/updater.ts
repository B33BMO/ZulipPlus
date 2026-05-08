// Lightweight update check.
//
// Hits GitHub's public Releases API for the configured repo, compares the
// latest release tag against the current bundled version (injected at
// build time from package.json), and returns the newer release if one
// exists. Renderer-only — no Electron-specific code, so this ports to
// Tauri verbatim.

const REPO = 'b33bmo/zulipplus';
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;

export interface UpdateInfo {
  /** Release tag, normalized (no leading 'v'). */
  version: string;
  /** Human-facing release page URL — what the Download button opens. */
  htmlUrl: string;
  /** Release notes (markdown). May be empty. */
  notes: string;
}

// Compare two semver-ish strings ("1.2.3" or "v1.2.3-beta.1"). Returns
// >0 if a > b, <0 if a < b, 0 if equal. Tolerates leading 'v' and ignores
// pre-release suffixes for the comparison (so 1.2.3-beta and 1.2.3 are
// treated as equal — close enough for an "is there a newer build?" check).
function compareVersions(a: string, b: string): number {
  const norm = (s: string) =>
    s.trim().replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const av = norm(a);
  const bv = norm(b);
  const len = Math.max(av.length, bv.length);
  for (let i = 0; i < len; i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export const CURRENT_VERSION: string = (typeof __APP_VERSION__ !== 'undefined'
  ? __APP_VERSION__
  : '0.0.0');

export async function checkForUpdate(signal?: AbortSignal): Promise<UpdateInfo | null> {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      draft?: boolean;
      prerelease?: boolean;
    };
    if (!data.tag_name || data.draft || data.prerelease) return null;
    const latest = data.tag_name.replace(/^v/i, '');
    if (compareVersions(latest, CURRENT_VERSION) <= 0) return null;
    return {
      version: latest,
      htmlUrl: data.html_url ?? `https://github.com/${REPO}/releases/latest`,
      notes: data.body ?? '',
    };
  } catch {
    // Network failure / rate-limit / abort — silently skip the check.
    // The user will get prompted on a future launch.
    return null;
  }
}

const DISMISSED_KEY = 'zulipplus_update_dismissed';

/** True if this exact version has already been dismissed by the user. */
export function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}

export function dismissVersion(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // ignore
  }
}
