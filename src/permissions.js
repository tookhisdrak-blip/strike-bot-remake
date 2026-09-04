const LEVELS = { moderator: 1, staff: 2, admin: 3 };
const storageKey = level => level === 'staff' ? 'staff' : `${level}s`;

function ensurePermissions(data) {
  const permissions = data.permissions ||= {
    configured: false,
    moderators: { roles: [], users: [], commands: [] },
    staff: { roles: [], users: [], commands: [] },
    admins: { roles: [], users: [] },
  };
  permissions.configured = Boolean(permissions.configured);
  for (const level of ['moderators', 'staff', 'admins']) {
    permissions[level] ||= {};
    permissions[level].roles ||= [];
    permissions[level].users ||= [];
    if (level !== 'admins') permissions[level].commands ||= [];
  }
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
  const level = getLevel(data, member);
  if (level === 'owner' || level === 'admin') return true;
  if (!level) return false;
  return ensurePermissions(data)[storageKey(level)].commands.includes(commandName);
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

module.exports = { LEVELS, ensurePermissions, getLevel, canUseCommand, configureLevel, setCommands };
