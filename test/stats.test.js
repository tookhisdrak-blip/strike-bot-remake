const test = require('node:test');
const assert = require('node:assert/strict');
const { getVoiceStats, getMemberStats } = require('../src/stats');

test('voice stats count only channels with users inside them', () => {
  const guild = {
    channels: {
      cache: [
        { id: 'a', type: 2, members: new Map([['u1', {}]]) },
        { id: 'b', type: 2, members: new Map() },
        { id: 'c', type: 13, members: new Map([['u2', {}], ['u3', {}]]) },
        { id: 'd', type: 0, members: new Map() }
      ]
    }
  };

  const result = getVoiceStats(guild);
  assert.deepEqual(result, { channels: 2, members: 3 });
});

test('member stats split total, humans, bots, and 24h joins correctly', () => {
  const now = new Date('2026-09-01T12:00:00Z').getTime();
  const guild = {
    members: {
      cache: [
        { user: { bot: false }, joinedTimestamp: new Date('2026-08-31T12:00:00Z').getTime() },
        { user: { bot: false }, joinedTimestamp: new Date('2026-08-20T12:00:00Z').getTime() },
        { user: { bot: true }, joinedTimestamp: new Date('2026-08-31T08:00:00Z').getTime() },
        { user: { bot: false }, joinedTimestamp: new Date('2026-08-01T12:00:00Z').getTime() },
      ]
    }
  };

  const result = getMemberStats(guild, now);
  assert.deepEqual(result, { total: 4, humans: 3, bots: 1, newIn24h: 1 });
});
