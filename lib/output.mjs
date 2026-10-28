// What the agent writes is untrusted (an issue can try to steer it). Nothing reaches GitHub
// without passing these checks: a known shape, allowed labels, no secrets, no stray links or
// mentions, and a marker so the runner recognises its own comments.

export const MARKER = '<!-- mob-maintain-runner -->';

export const TRIAGE_LABELS = {
  'triage: needs info': { color: 'fbca04', description: 'Waiting for details from the reporter' },
  'triage: needs maintainer': { color: 'd93f0b', description: 'Held for the maintainer (harm check or a decision)' },
  'triage: looks good': { color: '0e8a16', description: 'Reviewed by the triage agent; the maintainer decides' },
  'triage: changes requested': { color: 'e99695', description: 'The triage agent asked for changes' },
};

const KIND_LABEL = { bug: 'bug', bugfix: 'bug', feature: 'enhancement', docs: 'documentation', site: 'documentation', question: 'question', support: 'question', duplicate: 'duplicate' };
const RECOMMENDATION_LABEL = { looks_good: 'triage: looks good', changes_requested: 'triage: changes requested', needs_maintainer: 'triage: needs maintainer', close_suggested: 'triage: needs maintainer' };

const SECRET = /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9-]{20,})|-----BEGIN [A-Z ]*PRIVATE KEY/;
const MAX_REPLY = 6000;

const one = (v, list, name) => {
  if (!list.includes(v)) throw Error(`invalid ${name}: ${JSON.stringify(v)}`);
  return v;
};
const text = (v, name, max = 20000) => {
  if (typeof v !== 'string') throw Error(`missing ${name}`);
  return v.slice(0, max);
};

export function parseIssueVerdict(v) {
  if (!v || typeof v !== 'object') throw Error('verdict is not an object');
  return {
    kind: one(v.kind, ['bug', 'feature', 'question', 'docs', 'duplicate', 'support', 'security', 'spam', 'other'], 'kind'),
    real: one(v.real, ['yes', 'no', 'unclear'], 'real'),
    shouldFix: one(v.should_fix, ['yes', 'no', 'maybe'], 'should_fix'),
    needsInfo: Array.isArray(v.needs_info) ? v.needs_info.filter(s => typeof s === 'string').slice(0, 8) : [],
    duplicateOf: Number.isInteger(v.duplicate_of) && v.duplicate_of > 0 ? v.duplicate_of : null,
    summary: text(v.summary, 'summary', 500),
    analysis: text(v.analysis, 'analysis'),
    fixPlan: text(v.fix_plan ?? '', 'fix_plan'),
    reply: text(v.reply, 'reply'),
  };
}

export function parsePrVerdict(v) {
  if (!v || typeof v !== 'object') throw Error('verdict is not an object');
  return {
    kind: one(v.kind, ['bugfix', 'feature', 'docs', 'site', 'refactor', 'other'], 'kind'),
    harm: Array.isArray(v.harm) ? v.harm.filter(h => h && typeof h.reason === 'string').map(h => ({ file: String(h.file ?? ''), reason: h.reason.slice(0, 300) })).slice(0, 20) : [],
    recommendation: one(v.recommendation, ['looks_good', 'changes_requested', 'needs_maintainer', 'close_suggested'], 'recommendation'),
    summary: text(v.summary, 'summary', 500),
    analysis: text(v.analysis, 'analysis'),
    reply: text(v.reply, 'reply'),
  };
}

/** Labels for an issue verdict. */
export function issueLabels(v) {
  const labels = [];
  if (KIND_LABEL[v.kind]) labels.push(KIND_LABEL[v.kind]);
  if (v.needsInfo.length) labels.push('triage: needs info');
  if (v.kind === 'security' || v.shouldFix === 'maybe' || v.real === 'unclear' && !v.needsInfo.length) labels.push('triage: needs maintainer');
  return labels;
}

/** Labels for a PR verdict; any harm finding forces needs maintainer. */
export function prLabels(v, held) {
  const labels = [];
  if (KIND_LABEL[v.kind]) labels.push(KIND_LABEL[v.kind]);
  labels.push(held ? 'triage: needs maintainer' : RECOMMENDATION_LABEL[v.recommendation]);
  return labels;
}

/**
 * Turns the agent's reply into a comment that is safe to post, or throws.
 * author: the issue/PR author, the only account the reply may mention.
 */
export function safeComment(reply, { author, hosts, heading }) {
  if (SECRET.test(reply)) throw Error('the reply contains something that looks like a secret; not posted');
  let body = reply.replaceAll('<!--', '&lt;!--').trim();
  // Mentions notify people: only the author may be mentioned.
  body = body.replace(/(^|[^\w`])@([A-Za-z0-9-]{1,39})\b/g, (m, pre, login) => login.toLowerCase() === author.toLowerCase() ? m : `${pre}\`@${login}\``);
  // Links only to known hosts; others become plain text.
  body = body.replace(/https?:\/\/([a-z0-9.-]+)[^\s)\]>"]*/gi, (url, host) =>
    hosts.some(h => host.toLowerCase() === h || host.toLowerCase().endsWith(`.${h}`)) ? url : `\`${url.replace(/^https?:\/\//, '')}\` (link removed)`);
  if (body.length > MAX_REPLY) body = `${body.slice(0, MAX_REPLY)}\n\n…`;
  return `${MARKER}\n${heading}\n\n${body}`;
}
