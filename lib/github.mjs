// GitHub through the gh CLI, logged in on this Mac. Only the runner calls it; the agent never does.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function gh(args, { input } = {}) {
  const child = run('gh', args, { maxBuffer: 64 << 20, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
  if (input !== undefined) { child.child.stdin.end(input); }
  const { stdout } = await child;
  return stdout;
}

const api = async (path, extra = []) => JSON.parse(await gh(['api', ...extra, path]));
const pages = async path => JSON.parse(await gh(['api', '--paginate', '--slurp', path])).flat();

export const github = {
  /** Open issues and PRs updated since `since` (ISO), oldest first. */
  updated: (repo, since) => pages(`repos/${repo}/issues?state=open&sort=updated&direction=asc&per_page=100${since ? `&since=${since}` : ''}`),
  issue: (repo, n) => api(`repos/${repo}/issues/${n}`),
  comments: (repo, n) => pages(`repos/${repo}/issues/${n}/comments?per_page=100`),
  pull: (repo, n) => api(`repos/${repo}/pulls/${n}`),
  files: (repo, n) => pages(`repos/${repo}/pulls/${n}/files?per_page=100`),
  diff: (repo, n) => gh(['api', '-H', 'Accept: application/vnd.github.diff', `repos/${repo}/pulls/${n}`]),
  labels: repo => pages(`repos/${repo}/labels?per_page=100`),
  createLabel: (repo, name, { color, description }) =>
    gh(['api', '-X', 'POST', `repos/${repo}/labels`, '-f', `name=${name}`, '-f', `color=${color}`, '-f', `description=${description}`]),
  addLabels: (repo, n, labels) =>
    gh(['api', '-X', 'POST', `repos/${repo}/issues/${n}/labels`, '--input', '-'], { input: JSON.stringify({ labels }) }),
  comment: (repo, n, body) =>
    gh(['api', '-X', 'POST', `repos/${repo}/issues/${n}/comments`, '--input', '-'], { input: JSON.stringify({ body }) }),
  viewer: async () => (await api('user')).login,
};
