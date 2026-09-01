const { PermissionFlagsBits } = require('discord.js');

const PROTECTION_ROLE_FLAGS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.MoveMembers,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageNicknames,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ManageEmojisAndStickers,
  PermissionFlagsBits.ViewAuditLog,
  PermissionFlagsBits.MentionEveryone,
].reduce((total, flag) => total | BigInt(flag), 0n);

function isPermissionRole(role) {
  if (!role || !role.permissions || typeof role.permissions.any !== 'function') return false;
  return role.permissions.any(PROTECTION_ROLE_FLAGS);
}

function collectProtectedRoleIds(data, memberId, currentRoleIds = [], previousRoleIds = []) {
  const protectedIds = new Set([...(currentRoleIds || []), ...(previousRoleIds || [])].filter(Boolean));
  const protectedUser = data?.protectedUsers?.[memberId];
  if (protectedUser?.roles) {
    for (const roleId of protectedUser.roles) protectedIds.add(roleId);
  }
  for (const roleId of [...protectedIds]) {
    if (data?.protectedRoles?.[roleId]) protectedIds.add(roleId);
  }
  return protectedIds;
}

function getProtectedRoleTargetsForMember(data, memberId, roleIds = []) {
  const protectedIds = new Set((roleIds || []).filter(Boolean));
  const protectedUser = data?.protectedUsers?.[memberId];
  if (protectedUser?.roles) {
    for (const roleId of protectedUser.roles) protectedIds.add(roleId);
  }
  for (const roleId of [...protectedIds]) {
    if (data?.protectedRoles?.[roleId]) protectedIds.add(roleId);
  }
  return [...protectedIds];
}

function canRemoveProtectedRole(protectedRoleEntry, actorId) {
  if (!protectedRoleEntry) return true;
  return protectedRoleEntry.by === actorId;
}

module.exports = {
  PROTECTION_ROLE_FLAGS,
  isPermissionRole,
  collectProtectedRoleIds,
  getProtectedRoleTargetsForMember,
  canRemoveProtectedRole,
};
