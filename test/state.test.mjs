import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKER } from '../lib/output.mjs';
import { needsTriage } from '../lib/state.mjs';

const owner = 'xrdavies';
const mine = c => c.body.includes(MARKER);
const c = (login, body = 'text') => ({ user: { login }, body });
const opts = (record, comments, headSha) => ({ record, comments, owner, mine, headSha, max: 3 });

test('new items are triaged; quiet ones are not', () => {
  assert.equal(needsTriage({}, opts(undefined, [])).go, true);
  assert.equal(needsTriage({}, opts({ count: 1 }, [c(owner, MARKER)])).go, false);
});

test('a reply from the reporter triggers again; the maintainer stepping in stops it', () => {
  assert.equal(needsTriage({}, opts({ count: 1 }, [c(owner, MARKER), c('alice')])).why, 'new comment');
  assert.equal(needsTriage({}, opts({ count: 1 }, [c(owner, MARKER), c('alice'), c(owner)])).go, false);
});

test('new commits on a PR trigger again, up to the maximum', () => {
  assert.equal(needsTriage({}, opts({ count: 1, headSha: 'a' }, [c(owner, MARKER)], 'b')).why, 'new commits');
  assert.equal(needsTriage({}, opts({ count: 3, headSha: 'a' }, [c(owner, MARKER), c('alice')], 'b')).go, false);
});
