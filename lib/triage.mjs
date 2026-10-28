// One pass over the repositories, and the triage of one issue or pull request.
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fill, runCodex } from './agent.mjs';
import { harmCheck } from './harm.mjs';
import { issueLabels, MARKER, parseIssueVerdict, parsePrVerdict, prLabels, safeComment } from './output.mjs';
import { needsTriage } from './state.mjs';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');

export function log(...args) { console.log(new Date().toISOString(), ...args); }

/** Fresh read-only material for the agent: each repo's default branch, never a PR's code. */
export async function checkout(cfg, repo) {
  const dir = join(cfg.dataDir, 'repos', repo);
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(join(cfg.dataDir, 'repos'), { recursive: true });
    await run('git', ['clone', '-q', '--depth', '50', `https://github.com/${cfg.owner}/${repo}.git`, dir], { env });
  } else {
    await run('git', ['-C', dir, 'fetch', '-q', '--depth', '50', 'origin'], { env });
    await run('git', ['-C', dir, 'reset', '-q', '--hard', 'origin/HEAD'], { env });
    await run('git', ['-C', dir, 'clean', '-qfdx'], { env });
  }
  return dir;
}

async function notify(title, text) {
  if (process.platform !== 'darwin') return;
  const q = s => JSON.stringify(String(s).slice(0, 200));
  await run('osascript', ['-e', `display notification ${q(text)} with title ${q(title)}`]).catch(() => {});
}

function render(item, comments) {
  const lines = [
    `#${item.number} ${item.title}`,
    `Author: ${item.user.login} (${item.author_association})`,
    `Labels: ${item.labels.map(l => l.name).join(', ') || 'none'}`,
    '', item.body || '(no description)',
  ];
  for (const c of comments) lines.push('', `--- comment by ${c.user.login} (${c.author_association}) ---`, c.body ?? '');
  return lines.join('\n');
}

function report(cfg, repo, n, text) {
  const dir = join(cfg.dataDir, 'reports', repo);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${n}.md`);
  appendFileSync(path, `\n\n# ${new Date().toISOString()}\n\n${text}\n`);
  return path;
}

const HEADING = '**Automated first look** (the maintainer will follow up; this is not a decision)';

/** Triages one issue or PR; returns what it did. force: ignore the state (manual review). */
export async function triageOne(cfg, deps, { repo, item, force = false, post }) {
  const { github, state } = deps;
  const full = `${cfg.owner}/${repo}`;
  const key = `${repo}#${item.number}`;
  const isPr = Boolean(item.pull_request);
  const comments = await github.comments(full, item.number);
  const mine = c => (c.body ?? '').includes(MARKER);
  const pull = isPr ? await github.pull(full, item.number) : null;

  if (!force) {
    if (item.user.login === cfg.owner) return { key, skipped: 'opened by the maintainer' };
    if ((state.item(key)?.failures ?? 0) >= 3) return { key, skipped: 'failed 3 times; run review to retry' };
    const decision = needsTriage(item, { record: state.item(key), comments, owner: cfg.owner, mine, headSha: pull?.head?.sha, max: cfg.maxRetriagePerItem });
    if (!decision.go) return { key, skipped: decision.why };
  }

  const cwd = await (deps.checkout ?? checkout)(cfg, repo);
  const base = { repo: full, policy: read('rules/policy.md'), item: render(item, comments.filter(c => !mine(c))) };
  let verdict, labels, comment, findings = [];

  if (!isPr) {
    const open = (await github.updated(full)).filter(i => !i.pull_request && i.number !== item.number).map(i => `${i.number}: ${i.title}`).join('\n');
    verdict = parseIssueVerdict(await runCodex({ prompt: fill(read('prompts/issue.md'), { ...base, open: open || 'none' }), schema: join(root, 'prompts/issue.schema.json'), cwd, extraArgs: cfg.codexArgs, timeoutMinutes: cfg.agentTimeoutMinutes, bin: cfg.codexBin }));
    labels = issueLabels(verdict);
    const reply = verdict.kind === 'security'
      ? `Thanks for the report. Please don't post details of security problems here: email ${cfg.securityEmail} instead, and the maintainer will follow up privately.`
      : verdict.reply;
    comment = safeComment(reply, { author: item.user.login, hosts: cfg.linkHosts, heading: HEADING });
  } else {
    const files = await github.files(full, item.number);
    findings = harmCheck(files, { hosts: cfg.linkHosts });
    let diff = await github.diff(full, item.number);
    if (Buffer.byteLength(diff) > cfg.maxDiffBytes) {
      findings.push({ rule: 'too-large', file: '', text: `diff is ${Buffer.byteLength(diff)} bytes; only the first ${cfg.maxDiffBytes} were reviewed` });
      diff = diff.slice(0, cfg.maxDiffBytes);
    }
    const listed = findings.map(f => `- ${f.rule}: ${f.file}${f.line ? `:${f.line}` : ''} ${f.text}`).join('\n') || 'none';
    const prItem = `${base.item}\n\nBase: ${pull.base.ref}  Head: ${pull.head.label} @ ${pull.head.sha}\nFiles: ${files.map(f => `${f.filename} (+${f.additions} -${f.deletions})`).join(', ')}`;
    verdict = parsePrVerdict(await runCodex({ prompt: fill(read('prompts/pr.md'), { ...base, item: prItem, findings: listed, diff }), schema: join(root, 'prompts/pr.schema.json'), cwd, extraArgs: cfg.codexArgs, timeoutMinutes: cfg.agentTimeoutMinutes, bin: cfg.codexBin }));
    const held = findings.length > 0 || verdict.harm.length > 0 || verdict.recommendation === 'needs_maintainer';
    labels = prLabels(verdict, held);
    // Publicly: which files hold it and why, in a few words; the agent's reasoning stays in the report.
    const byFile = new Map();
    for (const f of findings) byFile.set(f.file || '(diff)', new Set([...(byFile.get(f.file || '(diff)') ?? []), f.rule.replaceAll('-', ' ')]));
    for (const h of verdict.harm) if (!byFile.has(h.file)) byFile.set(h.file || '(diff)', new Set(['flagged in review']));
    const harmNote = held && byFile.size
      ? `\n\n**Held for the maintainer** because of:\n${[...byFile].slice(0, 12).map(([file, why]) => `- \`${file}\`: ${[...why].join(', ')}`).join('\n')}${byFile.size > 12 ? `\n- and ${byFile.size - 12} more files` : ''}`
      : '';
    comment = safeComment(verdict.reply + harmNote, { author: item.user.login, hosts: cfg.linkHosts, heading: HEADING });
  }

  const posting = post ?? cfg.mode === 'post';
  const path = report(cfg, repo, item.number, [
    `${isPr ? 'PR' : 'Issue'} ${full}#${item.number}: ${item.title} (${item.html_url})`,
    `Mode: ${posting ? 'posted' : 'draft, nothing posted'}`,
    `Labels: ${labels.join(', ')}`,
    findings.length ? `Harm check:\n${findings.map(f => `- ${f.rule} ${f.file}${f.line ? `:${f.line}` : ''} ${f.text}`).join('\n')}` : 'Harm check: nothing found',
    `## Verdict\n\n\`\`\`json\n${JSON.stringify(verdict, null, 2)}\n\`\`\``,
    `## Comment\n\n${comment}`,
  ].join('\n\n'));

  if (posting) {
    if (labels.length) await github.addLabels(full, item.number, labels);
    await github.comment(full, item.number, comment);
  }
  const record = state.item(key);
  state.setItem(key, { failures: 0, count: (record?.count ?? 0) + 1, at: new Date().toISOString(), headSha: pull?.head?.sha, summary: verdict.summary, posted: posting });
  state.save();
  if (!deps.quiet) await notify(`Mob triage: ${key}`, `${posting ? 'Posted' : 'Draft ready'}: ${verdict.summary}`);
  return { key, posted: posting, labels, report: path, summary: verdict.summary };
}

/** One pass over every repo: items updated since the last pass. */
export async function pass(cfg, deps) {
  const { github, state } = deps;
  for (const repo of cfg.repos) {
    const full = `${cfg.owner}/${repo}`;
    const started = new Date().toISOString();
    let items;
    try { items = await github.updated(full, state.since(repo)); } catch (err) { log(`${full}: list failed: ${err.message}`); continue; }
    let ok = true;
    // The agent may read the other repos too (../): refresh them once per pass.
    if (items.length) for (const r of cfg.repos) await (deps.checkout ?? checkout)(cfg, r).catch(err => log(`${r}: checkout failed: ${err.message}`));
    for (const item of items) {
      try {
        const r = await triageOne(cfg, deps, { repo, item });
        if (r.skipped) log(`${r.key}: skipped (${r.skipped})`); else log(`${r.key}: ${r.posted ? 'posted' : 'draft'} [${r.labels.join(', ')}] ${r.summary}`);
      } catch (err) {
        ok = false;
        const key = `${repo}#${item.number}`;
        state.setItem(key, { failures: (state.item(key)?.failures ?? 0) + 1, lastError: err.message.slice(0, 500) });
        state.save();
        log(`${key}: failed: ${err.message}`);
      }
    }
    // A failed item is tried again next pass: keep the window open until every item went through.
    if (ok) { state.setSince(repo, started); state.save(); }
  }
}
