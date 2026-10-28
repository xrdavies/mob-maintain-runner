#!/usr/bin/env node
// mob-maintain-runner: triages community issues and PRs of the Mob repositories with a local agent.
//   run                 poll every pollMinutes (the launchd service runs this)
//   once                one pass, then exit
//   review REPO N       triage one issue or PR now, whatever the state [--post]
//   setup               check the gh login and create the triage labels in every repo
//   status             what was handled
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { github } from '../lib/github.mjs';
import { TRIAGE_LABELS } from '../lib/output.mjs';
import { State } from '../lib/state.mjs';
import { log, pass, triageOne } from '../lib/triage.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

export function loadConfig() {
  const cfg = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  const local = join(root, 'config.local.json');
  if (existsSync(local)) Object.assign(cfg, JSON.parse(readFileSync(local, 'utf8')));
  cfg.dataDir = cfg.dataDir.replace(/^~(?=\/|$)/, homedir());
  if (!['draft', 'post'].includes(cfg.mode)) throw Error(`mode must be draft or post, not ${cfg.mode}`);
  return cfg;
}

async function main([command = 'run', ...args]) {
  const cfg = loadConfig();
  const state = new State(join(cfg.dataDir, 'state.json'));
  const deps = { github, state };
  switch (command) {
    case 'run': {
      log(`watching ${cfg.repos.join(', ')} every ${cfg.pollMinutes} min, mode ${cfg.mode}`);
      for (;;) {
        await pass(cfg, deps).catch(err => log(`pass failed: ${err.message}`));
        await new Promise(r => setTimeout(r, cfg.pollMinutes * 60_000));
      }
    }
    case 'once':
      return pass(cfg, deps);
    case 'review': {
      const [repo, n] = args;
      if (!cfg.repos.includes(repo) || !/^\d+$/.test(n ?? '')) throw Error(`usage: review REPO N [--post]  (REPO one of ${cfg.repos.join(', ')})`);
      const item = await github.issue(`${cfg.owner}/${repo}`, Number(n));
      const r = await triageOne(cfg, deps, { repo, item, force: true, post: args.includes('--post') });
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'setup': {
      const me = await github.viewer();
      if (me !== cfg.owner) throw Error(`gh is logged in as ${me}, not ${cfg.owner}`);
      for (const repo of cfg.repos) {
        const have = new Set((await github.labels(`${cfg.owner}/${repo}`)).map(l => l.name));
        for (const [name, spec] of Object.entries(TRIAGE_LABELS)) {
          if (have.has(name)) continue;
          await github.createLabel(`${cfg.owner}/${repo}`, name, spec);
          log(`${repo}: created label "${name}"`);
        }
      }
      log('setup done');
      return;
    }
    case 'status': {
      for (const repo of cfg.repos) console.log(`${repo}: checked up to ${state.since(repo) ?? 'never'}`);
      for (const [key, r] of Object.entries(state.data.items)) console.log(`${key}: ${r.count ?? 0}x, ${r.posted ? 'posted' : 'draft'}${r.failures ? `, ${r.failures} failures (${r.lastError})` : ''}: ${r.summary ?? ''}`);
      return;
    }
    default:
      throw Error(`unknown command ${command}; use run, once, review, setup or status`);
  }
}

main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exit(1); });
