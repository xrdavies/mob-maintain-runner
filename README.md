# mob-maintain-runner

A local service that gives community issues and pull requests in the Mob repositories
([mobd](https://github.com/xrdavies/mobd), [mob](https://github.com/xrdavies/mob),
[mob-ios](https://github.com/xrdavies/mob-ios), [mob-android](https://github.com/xrdavies/mob-android),
[mob-site](https://github.com/xrdavies/mob-site)) a first look with a local agent (Codex).
It proposes; the maintainer decides, merges and closes.

## What it does

Every hour it lists open issues and PRs updated since the last pass (through `gh`, logged
in as the maintainer), and for each new one, or one with a new comment or new commits:

- **Issue:** the agent reads it against the repo's code and docs and decides the kind (bug,
  feature, question, docs, duplicate, security…), whether it is real and worth fixing, what
  information is missing, and a fix plan. The runner labels it and replies (missing details,
  duplicate link, answer, or "the maintainer will follow up"). A security report only gets
  "please email". The analysis and fix plan stay private, in the reports.
- **Pull request:** a fixed **harm check** runs first (CI, release and install scripts,
  dependencies, app permissions and signing, credentials and pairing code, downloads and
  `exec`, encoded blobs, secrets, hidden characters, new network addresses). Then the agent
  classifies (bugfix, feature, docs, site, refactor) and reviews it. Anything the harm check or
  the agent flags is labelled **triage: needs maintainer**; otherwise **triage: looks good** or
  **triage: changes requested**, with a comment. It never approves, merges or closes.

It skips the maintainer's own issues and PRs, and stops replying on an item once the maintainer
has commented after it.

## Safety

- The agent runs `codex exec --sandbox read-only` (no writes, no network), with a minimal
  environment (no `GH_TOKEN`), in a checkout of the default branch. A PR's code is never on
  disk; the agent gets its diff as text and is told not to run anything.
- Issue and PR text is wrapped as untrusted, and `rules/policy.md` tells the agent to ignore
  instructions in it.
- The agent only returns JSON matching `prompts/*.schema.json`; the runner checks it and does
  every GitHub call itself. Replies are checked before posting: no secrets, only the author
  mentioned, links only to allowed hosts, a marker so the runner knows its own comments.
- Reports, state and checkouts live in `~/.mob-maintain-runner`, not in this public repo.

## Use

Requirements: macOS, Node.js 24+, `gh` logged in as the owner, `codex` logged in.

```bash
node bin/runner.mjs setup            # checks the gh login, creates the triage: labels
node bin/runner.mjs review mob 3     # one issue or PR now, as a draft (nothing posted)
node bin/runner.mjs review mob 3 --post
node bin/runner.mjs once             # one pass over all repos
node bin/runner.mjs status
make install                         # run it as a LaunchAgent (make uninstall, make logs)
```

**Draft mode** (the default in `config.json`) posts nothing: each triage writes
`~/.mob-maintain-runner/reports/<repo>/<n>.md` and shows a notification. Put
`{"mode": "post"}` in `config.local.json` to post labels and comments.

## Files

| Path | What |
| --- | --- |
| `config.json` | repos, mode, poll interval, allowed link hosts; `config.local.json` overrides |
| `rules/policy.md` | what the agent checks and how it replies (the project's conventions are here) |
| `prompts/` | the issue and PR prompts and their JSON schemas |
| `lib/harm.mjs` | the fixed harm check |
| `lib/output.mjs` | verdict parsing, labels, the checks on what is posted |
| `lib/triage.mjs` | one pass and one item |
| `lib/agent.mjs` | runs Codex |
