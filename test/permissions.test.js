const test = require('node:test');
const assert = require('node:assert/strict');
const { ensurePermissions, getLevel, canUseCommand, configureLevel, setCommands } = require('../src/permissions');

function member(id, ownerId, roles = []) {
  return { id, guild: { ownerId }, roles: { cache: new Map(roles.map(roleId => [roleId, { id: roleId }])) } };
}

test('permission hierarchy defaults to owner only and prefers higher levels', () => {
  const data = { staffRoleId: 'legacy-staff' };
  assert.equal(getLevel(data, member('owner', 'owner')), 'owner');
  assert.equal(getLevel(data, member('user', 'owner')), null);
  assert.equal(getLevel(data, member('legacy', 'owner', ['legacy-staff'])), null);
  configureLevel(data, 'moderator', 'role', 'mod-role');
  configureLevel(data, 'staff', 'user', 'user');
  configureLevel(data, 'admin', 'role', 'admin-role');
  assert.equal(getLevel(data, member('user', 'owner', ['mod-role'])), 'staff');
  assert.equal(getLevel(data, member('other', 'owner', ['admin-role', 'mod-role'])), 'admin');
});

test('lower hierarchy levels require explicit command grants', () => {
  const data = {};
  configureLevel(data, 'moderator', 'user', 'mod');
  setCommands(data, 'moderator', ['strike']);
  assert.equal(canUseCommand(data, member('mod', 'owner'), 'strike'), true);
  assert.equal(canUseCommand(data, member('mod', 'owner'), 'vc'), false);
  assert.equal(canUseCommand(data, member('owner', 'owner'), 'vc'), true);
  assert.equal(ensurePermissions(data).admins.commands, undefined);
});
