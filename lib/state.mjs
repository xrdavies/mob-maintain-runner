// What the runner has handled, in a JSON file in the data directory (outside the public repo).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class State {
  constructor(path) {
    this.path = path;
    try { this.data = JSON.parse(readFileSync(path, 'utf8')); } catch { this.data = { repos: {}, items: {} }; }
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.data, null, 2));
    renameSync(`${this.path}.tmp`, this.path);
  }
  since(repo) { return this.data.repos[repo]?.since; }
  setSince(repo, iso) { (this.data.repos[repo] ??= {}).since = iso; }
  item(key) { return this.data.items[key]; }
  setItem(key, value) { this.data.items[key] = { ...this.data.items[key], ...value }; }
}

/**
 * Whether an item needs (re)triage. comments: oldest first; mine(comment) tells the runner's own.
 * Triage again only after new activity by someone other than the owner and the runner, at most
 * `max` times, and never once the owner has stepped in after the runner.
 */
export function needsTriage(item, { record, comments, owner, mine, headSha, max }) {
  if (!record) return { go: true, why: 'new' };
  if (record.count >= max) return { go: false, why: 'triaged the maximum number of times' };
  const lastMine = comments.findLastIndex(mine);
  const after = lastMine < 0 ? comments : comments.slice(lastMine + 1);
  if (after.some(c => c.user?.login === owner)) return { go: false, why: 'the maintainer has taken over' };
  if (after.some(c => c.user?.login !== owner && !mine(c))) return { go: true, why: 'new comment' };
  if (headSha && record.headSha && headSha !== record.headSha) return { go: true, why: 'new commits' };
  return { go: false, why: 'no new activity' };
}
