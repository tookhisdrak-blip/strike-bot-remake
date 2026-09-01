const test = require('node:test');
const assert = require('node:assert/strict');
const { isPermissionRole, collectProtectedRoleIds, getProtectedRoleTargetsForMember, canRemoveProtectedRole } = require('../src/protection');

test('permission roles are detected correctly', () => {
  const role = { id: '1', permissions: { any: (flags) => {
    const normalized = typeof flags === 'bigint' ? Number(flags & 8n) : (flags & 8);
    return normalized === 8;
  } } };
  assert.equal(isPermissionRole(role), true);
});

test('protected members and protected roles keep their expected role ids', () => {
  const data = {
    protectedUsers: {
      memberA: { by: 'protector1', roles: ['keep-role', 'admin-role'] },
    },
    protectedRoles: {
      protectedRole: { by: 'protector2' },
    },
  };

  const result = collectProtectedRoleIds(data, 'memberA', ['keep-role', 'protectedRole']);
  assert.deepEqual(result, new Set(['keep-role', 'admin-role', 'protectedRole']));
});

test('only a role protector can remove that protected role from someone else', () => {
  const protectedRole = { by: 'protector1' };
  assert.equal(canRemoveProtectedRole(protectedRole, 'protector1'), true);
  assert.equal(canRemoveProtectedRole(protectedRole, 'other-user'), false);
});

test('protected roles should apply to any member who currently has that role', () => {
  const data = {
    protectedRoles: {
      roleA: { by: 'protector1' },
    },
    protectedUsers: {},
  };

  const result = getProtectedRoleTargetsForMember(data, 'memberX', ['roleB', 'roleA']);
  assert.deepEqual(result.includes('roleA'), true);
  assert.deepEqual(result.includes('roleB'), true);
});
