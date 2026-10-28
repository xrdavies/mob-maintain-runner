// Runs the agent (Codex) on one prompt. It runs in a read-only sandbox, without network, in a
// checkout of the repo, with a minimal environment: no GitHub token or other secrets. Its only
// output that counts is the final JSON message, checked against a schema.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEEP_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'CODEX_HOME', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy'];

export function agentEnv(env = process.env) {
  return Object.fromEntries(KEEP_ENV.filter(k => env[k] !== undefined).map(k => [k, env[k]]));
}

/** Runs codex exec; resolves to the parsed final JSON. */
export function runCodex({ prompt, schema, cwd, extraArgs = [], timeoutMinutes = 20, bin = 'codex' }) {
  const dir = mkdtempSync(join(tmpdir(), 'mob-triage-'));
  const out = join(dir, 'last.json');
  const args = ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral',
    '--cd', cwd, '--output-schema', schema, '--output-last-message', out, ...extraArgs, '-'];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, env: agentEnv(), stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', d => { stderr = (stderr + d).slice(-4000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMinutes * 60_000);
    child.on('error', err => { clearTimeout(timer); rmSync(dir, { recursive: true, force: true }); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      try {
        if (code !== 0) throw Error(`codex exited ${code}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`);
        resolve(JSON.parse(readFileSync(out, 'utf8')));
      } catch (err) { reject(err); } finally { rmSync(dir, { recursive: true, force: true }); }
    });
    child.stdin.end(prompt);
  });
}

export function fill(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
}
