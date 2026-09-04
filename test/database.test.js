const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDatabase } = require('../src/database');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'strike-bot-db-'));
}

test('database persists state after reopening', () => {
  const directory = tempDir();
  const first = createDatabase(directory);
  first.save('guilds', { guild: { permissions: { staff: ['strike'] } } });
  first.close();
  const second = createDatabase(directory);
  assert.deepEqual(second.load('guilds'), { guild: { permissions: { staff: ['strike'] } } });
  second.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('database imports legacy JSON without changing the source file', () => {
  const directory = tempDir();
  const legacyPath = path.join(directory, 'guilds.json');
  const legacy = { guild: { staffRoleId: 'role-id', strikes: {} } };
  fs.writeFileSync(legacyPath, JSON.stringify(legacy));
  const database = createDatabase(directory);
  assert.deepEqual(database.load('guilds', legacyPath), legacy);
  assert.equal(fs.readFileSync(legacyPath, 'utf8'), JSON.stringify(legacy));
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
