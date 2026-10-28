// "Look for harm first": checks of a pull request that run before any agent reads it. Any finding
// holds the PR for the maintainer; the agent's review is still written, but never says "looks good".

// Paths whose change always needs the maintainer: CI and release, packaging and installers,
// dependencies and build settings, app permissions and signing, and credential handling.
export const PATH_RULES = [
  ['ci-or-release', /^\.github\//],
  ['build-or-release-script', /(^|\/)(Makefile|Dockerfile|install\.sh|install\.ps1)$|^packaging\/|^scripts\//],
  ['dependencies', /(^|\/)(go\.mod|go\.sum|package\.json|package-lock\.json|Cargo\.toml|Cargo\.lock|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|libs\.versions\.toml|gradle-wrapper\.properties|Package\.resolved|Podfile(\.lock)?)$/],
  ['app-permissions-or-signing', /(^|\/)(Info\.plist|[^/]+\.entitlements|PrivacyInfo\.xcprivacy|AndroidManifest\.xml|project\.pbxproj|ExportOptions\.plist|tauri\.conf\.json)$|(^|\/)capabilities\//],
  // Code only: a doc about pairing is fine.
  ['credentials-or-pairing', /(pairing|auth|keychain|secret|credential|token|keystore|signing).*\.(go|swift|kts?|java|tsx?|m?js|rs|mm?|h|c|cpp|sh|py)$/i],
  ['site-deploy', /(^|\/)(astro\.config\.mjs|CNAME)$/],
];

const DEFAULT_HOSTS = ['github.com', 'mymob.dev', 'dl.mymob.dev', 'localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'example.org'];

// Patterns in added lines.
export const LINE_RULES = [
  ['download-or-shell-out', /\b(curl|wget)\s|Invoke-WebRequest|\/dev\/tcp\/|\bnc\s+-/],
  ['code-execution', /\beval\s*\(|new Function\s*\(|child_process|\bexec\.Command(Context)?\s*\(|Runtime\.getRuntime\(\)\.exec|ProcessBuilder\s*\(|\bNSTask\b|Process\(\)\.run/],
  ['install-hook', /"(pre|post)install"\s*:/],
  ['encoded-blob', /[A-Za-z0-9+/=]{200,}|(\\x[0-9a-fA-F]{2}){40,}/],
  ['secret', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9-]{20,})|-----BEGIN [A-Z ]*PRIVATE KEY/],
  ['hidden-characters', /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/],
];

const URL = /https?:\/\/([a-z0-9.-]+)/gi;
// Lock files are full of registry URLs; the dependencies rule holds them already.
const LOCK = /(^|\/)(package-lock\.json|Cargo\.lock|go\.sum|Package\.resolved|Podfile\.lock|yarn\.lock|pnpm-lock\.yaml)$/;

function hostAllowed(host, allowed) {
  host = host.toLowerCase();
  return allowed.some(a => host === a || host.endsWith(`.${a}`));
}

/**
 * files: [{filename, status, patch?, additions, deletions}] from the pulls/files API.
 * Returns findings: [{rule, file, line?, text}].
 */
export function harmCheck(files, { hosts = [] } = {}) {
  const allowed = [...DEFAULT_HOSTS, ...hosts];
  const out = [];
  for (const f of files) {
    for (const [rule, re] of PATH_RULES) if (re.test(f.filename)) out.push({ rule, file: f.filename, text: `changes ${f.filename}` });
    if (f.patch === undefined && (f.additions || f.deletions || f.status === 'added')) {
      out.push({ rule: 'binary-or-unreviewable', file: f.filename, text: 'no text diff (binary or too large)' });
      continue;
    }
    let line = 0;
    for (const raw of (f.patch ?? '').split('\n')) {
      const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunk) { line = Number(hunk[1]) - 1; continue; }
      if (raw.startsWith('-')) continue;
      line++;
      if (!raw.startsWith('+')) continue;
      const text = raw.slice(1);
      for (const [rule, re] of LINE_RULES) if (re.test(text)) out.push({ rule, file: f.filename, line, text: text.trim().slice(0, 160) });
      if (!LOCK.test(f.filename)) for (const m of text.matchAll(URL)) {
        if (!hostAllowed(m[1], allowed)) out.push({ rule: 'new-network-address', file: f.filename, line, text: m[0] });
      }
    }
  }
  return out;
}
