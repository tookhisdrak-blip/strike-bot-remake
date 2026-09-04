const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureVoice, addHistory, setFollow, removeFollow, setChain } = require('../src/voice');

test('voice state is persistent and history is bounded', () => {
  const data = {};
  setFollow(data, 'follower', 'target');
  setChain(data, 'owner', ['one', 'two', 'one']);
  addHistory(data, 'target', { event: 'join', channelId: 'vc' });
  assert.equal(ensureVoice(data).follows.follower, 'target');
  assert.deepEqual(ensureVoice(data).chains.owner, ['one', 'two']);
  assert.equal(ensureVoice(data).history.target.length, 1);
  removeFollow(data, 'follower');
  assert.equal(ensureVoice(data).follows.follower, undefined);
});
