import test from 'node:test';
import assert from 'node:assert/strict';
import { issueLabels, MARKER, parseIssueVerdict, parsePrVerdict, prLabels, safeComment } from '../lib/output.mjs';

const hosts = ['github.com', 'mymob.dev'];

test('verdicts with unknown values are refused', () => {
  assert.throws(() => parseIssueVerdict({ kind: 'merge-now', real: 'yes', should_fix: 'yes', summary: '', analysis: '', reply: '' }), /kind/);
  assert.throws(() => parsePrVerdict({ kind: 'bugfix', harm: [], recommendation: 'merge', summary: '', analysis: '', reply: '' }), /recommendation/);
});

test('labels: needs info, security and harm go to the maintainer', () => {
  const v = parseIssueVerdict({ kind: 'bug', real: 'unclear', should_fix: 'maybe', needs_info: ['mobd --version'], duplicate_of: null, summary: 's', analysis: 'a', fix_plan: '', reply: 'r' });
  assert.deepEqual(issueLabels(v), ['bug', 'triage: needs info', 'triage: needs maintainer']);
  const pr = parsePrVerdict({ kind: 'docs', harm: [], recommendation: 'looks_good', summary: 's', analysis: 'a', reply: 'r' });
  assert.deepEqual(prLabels(pr, false), ['documentation', 'triage: looks good']);
  assert.deepEqual(prLabels(pr, true), ['documentation', 'triage: needs maintainer']);
});

test('comments: marker, no secrets, only the author mentioned, only known links', () => {
  const c = safeComment('Hi @alice, cc @bob. See https://mymob.dev/faq/ and https://phish.example.net/login <!-- x -->', { author: 'alice', hosts, heading: 'H' });
  assert.ok(c.startsWith(MARKER));
  assert.match(c, /Hi @alice/);
  assert.match(c, /`@bob`/);
  assert.match(c, /https:\/\/mymob\.dev\/faq\//);
  assert.match(c, /`phish\.example\.net\/login` \(link removed\)/);
  assert.doesNotMatch(c, /<!-- x/);
  assert.throws(() => safeComment('token ghp_' + 'a'.repeat(30), { author: 'a', hosts, heading: 'H' }), /secret/);
});
