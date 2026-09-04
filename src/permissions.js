const LEVELS = { moderator: 1, staff: 2, admin: 3 };
const storageKey = level => level === 'staff' ? 'staff' : `${level}s`;

function ensurePermissions(data) {
  const permissions = data.permissions ||= {
    configured: false,
    moderators: { roles: [], users: [], commands: [] },
    staff: { roles: [], users: [], commands: [] },
    admins: { roles: [], users: [] },
    paid: [],
  };
  permissions.configured = Boolean(permissions.configured);
  for (const level of ['moderators', 'staff', 'admins']) {
    permissions[level] ||= {};
    permissions[level].roles ||= [];
    permissions[level].users ||= [];
    if (level !== 'admins') permissions[level].commands ||= [];
  }
  permissions.paid ||= [];
  return permissions;
}

function hasIdentity(member, level) {
  const roles = typeof member.roles.cache.some === 'function'
    ? member.roles.cache
    : [...member.roles.cache.values()];
  return Boolean(level.users.includes(member.id) || roles.some(role => level.roles.includes(role.id)));
}

function getLevel(data, member) {
  if (!member?.guild || member.guild.ownerId === member.id) return 'owner';
  const permissions = ensurePermissions(data);
  for (const level of ['admins', 'staff', 'moderators']) {
    if (hasIdentity(member, permissions[level])) return level === 'admins' ? 'admin' : level === 'moderators' ? 'moderator' : 'staff';
  }
  return null;
}

function canUseCommand(data, member, commandName) {
  const effective = getEffectivePermissions(data, member);
  if (effective.levels.includes('owner') || effective.levels.includes('admin')) return true;
  if (effective.commands.includes(commandName)) return true;
  return false;
}

function getEffectivePermissions(data, member) {
  const permissions = ensurePermissions(data);
  const commands = new Set();
  const sources = {};
  const levels = member?.guild?.ownerId === member?.id ? ['owner'] : [];
  for (const [key, label] of [['admins', 'admin'], ['staff', 'staff'], ['moderators', 'moderator']]) {
    if (hasIdentity(member, permissions[key])) levels.push(label);
  }
  if (levels.includes('owner') || levels.includes('admin')) return { levels: [...new Set(levels)], commands: [], sources, fullAccess: true };
  for (const candidate of ['staff', 'moderator']) {
    if (levels.includes(candidate)) {
      for (const command of permissions[storageKey(candidate)].commands) { commands.add(command); sources[command] ||= `${candidate} configuration`; }
    }
  }
  for (const entry of permissions.paid) {
    const matches = entry.targetType === 'user' ? entry.targetId === member?.id : member?.roles?.cache?.has(entry.targetId);
    if (!matches) continue;
    levels.push('paid');
    for (const command of entry.commands || []) { commands.add(command); sources[command] ||= entry.targetType === 'role' ? 'Paid role' : 'Direct paid user'; }
  }
  return { levels: [...new Set(levels)], commands: [...commands], sources, fullAccess: false };
}

function getHierarchy(data) {
  const permissions = ensurePermissions(data);
  return {
    owner: true,
    admin: permissions.admins,
    staff: permissions.staff,
    moderator: permissions.moderators,
    paid: permissions.paid,
  };
}

function configurePaid(data, targetType, targetId, commands, actorId, now = new Date().toISOString()) {
  const permissions = ensurePermissions(data);
  const existing = permissions.paid.find(entry => entry.targetType === targetType && entry.targetId === targetId);
  const record = existing || { guildId: data.guildId || null, targetType, targetId, commands: [], configuredBy: actorId, createdAt: now };
  record.commands = [...new Set(commands.filter(Boolean))];
  record.configuredBy ||= actorId;
  record.updatedAt = now;
  if (!existing) permissions.paid.push(record);
  permissions.configured = true;
  return record;
}

function removePaid(data, targetType, targetId) {
  const permissions = ensurePermissions(data);
  const before = permissions.paid.length;
  permissions.paid = permissions.paid.filter(entry => !(entry.targetType === targetType && entry.targetId === targetId));
  return before !== permissions.paid.length;
}

function configureLevel(data, level, targetType, targetId) {
  const permissions = ensurePermissions(data);
  const key = targetType === 'role' ? 'roles' : 'users';
  const list = permissions[storageKey(level)][key];
  if (!list.includes(targetId)) list.push(targetId);
  permissions.configured = true;
  return permissions;
}

function setCommands(data, level, commands) {
  const permissions = ensurePermissions(data);
  if (level === 'admin') return permissions;
  permissions[storageKey(level)].commands = [...new Set(commands.filter(Boolean))];
  permissions.configured = true;
  return permissions;
}

module.exports = { LEVELS, ensurePermissions, getLevel, canUseCommand, getEffectivePermissions, getHierarchy, configureLevel, setCommands, configurePaid, removePaid };
