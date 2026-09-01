function ensureGuildGodmode(godmodeDb, guildId) {
  const guildState = godmodeDb[guildId] ||= { users: {}, roles: {} };
  guildState.users ||= {};
  guildState.roles ||= {};
  return guildState;
}

function hasGodmode(godmodeDb, guildId, userId) {
  if (!guildId || !userId) return false;
  const state = ensureGuildGodmode(godmodeDb, guildId);
  return Boolean(state.users[userId]?.enabled);
}

function setGodmodeForUser(godmodeDb, guildId, userId, payload = {}) {
  const state = ensureGuildGodmode(godmodeDb, guildId);
  const safeRoleIds = Array.isArray(payload.roleIds) ? [...new Set(payload.roleIds.filter(Boolean))] : [];
  state.users[userId] = {
    enabled: true,
    grantedBy: payload.grantedBy || userId,
    source: payload.source || 'manual',
    grantedAt: payload.grantedAt || new Date().toISOString(),
    roleIds: safeRoleIds,
  };
  return state.users[userId];
}

function removeGodmodeForUser(godmodeDb, guildId, userId) {
  const state = ensureGuildGodmode(godmodeDb, guildId);
  if (!state.users[userId]) return false;
  delete state.users[userId];
  return true;
}

function grantRoleGodmode(godmodeDb, guildId, roleId, grantedBy) {
  const state = ensureGuildGodmode(godmodeDb, guildId);
  state.roles[roleId] = {
    by: grantedBy,
    grantedAt: new Date().toISOString(),
  };
  return state.roles[roleId];
}

function getRoleGodmodeMembers(godmodeDb, guildId, roleId) {
  const state = ensureGuildGodmode(godmodeDb, guildId);
  return state.roles[roleId] ? Object.keys(state.users).filter(userId => state.users[userId]?.roleIds?.includes(roleId)) : [];
}

function applyRoleGodmodeToMember(godmodeDb, guildId, userId, roleId, grantedBy) {
  const state = ensureGuildGodmode(godmodeDb, guildId);
  const entry = state.users[userId] ||= { enabled: true, grantedBy, source: 'role', grantedAt: new Date().toISOString(), roleIds: [] };
  entry.enabled = true;
  entry.grantedBy = grantedBy || entry.grantedBy || userId;
  entry.source = 'role';
  entry.grantedAt ||= new Date().toISOString();
  entry.roleIds = [...new Set([...(entry.roleIds || []), roleId].filter(Boolean))];
  return entry;
}

module.exports = {
  ensureGuildGodmode,
  hasGodmode,
  setGodmodeForUser,
  removeGodmodeForUser,
  grantRoleGodmode,
  getRoleGodmodeMembers,
  applyRoleGodmodeToMember,
};
