require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder, PermissionFlagsBits,
  AuditLogEvent, ChannelType, Role
} = require('discord.js');
const {
  ensureGuildGodmode,
  hasGodmode,
  setGodmodeForUser,
  removeGodmodeForUser,
  grantRoleGodmode,
  applyRoleGodmodeToMember,
} = require('./godmode');
const { isPermissionRole, collectProtectedRoleIds, getProtectedRoleTargetsForMember, canRemoveProtectedRole } = require('./protection');
const { getVoiceStats, getMemberStats } = require('./stats');

const PREFIX = process.env.PREFIX || '-';
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'guilds.json');
const godmodeFile = path.join(dataDir, 'godmode.json');
let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
let godmodeDb = fs.existsSync(godmodeFile) ? JSON.parse(fs.readFileSync(godmodeFile, 'utf8')) : {};
const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 2));
const saveGodmode = () => fs.writeFileSync(godmodeFile, JSON.stringify(godmodeDb, null, 2));
const guildData = guild => {
  const data = db[guild.id] ||= { strikes: {}, strikeHistory: [], removedStrikes: {}, logs: {}, staffRoleId: null, protectedUsers: {}, protectedRoles: {}, protection: {}, stfu: {}, stfuHistory: [], staffBlacklistUsers: {}, staffBlacklistRoles: {}, staffBlacklistHistory: [], botProfile: {}, aliases: {} };
  data.strikeHistory ||= [];
  data.protection ||= {};
  data.stfu ||= {};
  data.stfuHistory ||= [];
  data.staffBlacklistUsers ||= {};
  data.staffBlacklistRoles ||= {};
  data.staffBlacklistHistory ||= [];
  data.botProfile ||= {};
  return data;
};
const embed = (title, description) => new EmbedBuilder().setTitle(title).setDescription(description).setFooter({ text: 'bot created by @6xwg / kutt' }).setTimestamp();
const reply = (message, title, description, extra = {}) => message.reply({ embeds: [embed(title, description)], ...extra });
const mentionChannel = (guild, id) => id ? guild.channels.cache.get(id)?.toString() || `<#${id}>` : 'not configured';
const isOwner = message => message.guild.ownerId === message.author.id;
const isStaff = message => isOwner(message) || Boolean(guildData(message.guild).staffRoleId && message.member.roles.cache.has(guildData(message.guild).staffRoleId));
const protectionConfig = data => ({ enabled: true, protectionType: 'both', automaticRestore: true, attemptThreshold: 4, attemptWindow: 30, punishment: 'strip', logChannel: data.logs.protected || null, configured: false, ...data.protection });
const protectionTypeAllows = (config, isRole) => !config.configured || config.protectionType === 'both' || (isRole ? config.protectionType === 'roles' : config.protectionType === 'users');
const isAdminRole = role => role && !role.managed && role.permissions.any(PermissionFlagsBits.Administrator | PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles | PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers);
const isStaffBlacklistRole = role => role && !role.managed && role.permissions.any(PermissionFlagsBits.Administrator | PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers | PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.MoveMembers);
const roleResolver = (guild, input) => guild.roles.cache.get(input?.replace(/[<@&>]/g, '')) || guild.roles.cache.find(role => role.name.toLowerCase() === input?.toLowerCase());
const userResolver = async (message, token) => message.mentions.users.first() || await message.client.users.fetch(token?.replace(/[<@!>]/g, '')).catch(() => null);
const parseTargetReason = async message => {
  const parts = message.content.trim().split(/\s+/);
  const token = parts[1];
  const target = await userResolver(message, token);
  const reason = parts.slice(2).join(' ').trim();
  return { target, reason };
};
const parseBlacklistTargetReason = async message => {
  const parts = message.content.trim().split(/\s+/);
  const token = parts[1];
  const target = message.mentions.roles.first() || roleResolver(message.guild, token) || message.mentions.users.first() || await userResolver(message, token);
  return { target, reason: parts.slice(2).join(' ').trim() };
};
const resolveProtectionTarget = async (message, token) => {
  const mentionMember = message.mentions.members.first();
  if (mentionMember) return mentionMember;
  const mentionRole = message.mentions.roles.first();
  if (mentionRole) return mentionRole;
  const role = roleResolver(message.guild, token);
  if (role) return role;
  const user = token && await userResolver(message, token);
  if (user) return user;
  return null;
};
const getMemberProtectedRoleIds = (guild, member, data) => {
  const protectedIds = new Set();
  const currentRoleIds = member?.roles?.cache.filter(role => role.id !== guild.id).map(role => role.id) || [];
  const previousRoleIds = data.protectedUsers[member.id]?.roles || [];
  const roleSet = collectProtectedRoleIds(data, member.id, currentRoleIds, previousRoleIds);
  for (const roleId of roleSet) {
    if (guild.roles.cache.get(roleId)) protectedIds.add(roleId);
  }
  for (const role of member?.roles?.cache.values?.() || []) {
    if (isPermissionRole(role)) protectedIds.add(role.id);
  }
  return [...protectedIds];
};
const restoreProtectedRoles = async (member, guild, data, reason = 'Protected role enforcement') => {
  const protectedRoleIds = getMemberProtectedRoleIds(guild, member, data);
  if (!protectedRoleIds.length) return false;
  const missing = protectedRoleIds.filter(roleId => roleId !== guild.id && !member.roles.cache.has(roleId));
  if (!missing.length) return false;
  await member.roles.add(missing, reason).catch(() => {});
  return true;
};
const protectMembersWithRole = async (guild, roleId, protectorId, data) => {
  const role = guild.roles.cache.get(roleId);
  if (!role) return;
  for (const member of guild.members.cache.values()) {
    if (!member.roles.cache.has(roleId)) continue;
    const existing = data.protectedUsers[member.id] || { by: protectorId, roles: [], at: new Date().toISOString() };
    const snapshot = new Set([...(existing.roles || []), ...member.roles.cache.filter(entry => entry.id !== guild.id).map(entry => entry.id)]);
    existing.by = protectorId;
    existing.roles = [...snapshot];
    existing.at = new Date().toISOString();
    data.protectedUsers[member.id] = existing;
  }
};
const registerProtectionAttempt = (guildId, offenderId, targetId) => {
  const key = `${guildId}:${offenderId}:${targetId}`;
  const now = Date.now();
  const attempts = (protectionAttempts.get(key) || []).filter(time => now - time < 30000);
  attempts.push(now);
  protectionAttempts.set(key, attempts);
  return attempts;
};
const log = async (guild, kind, title, text) => {
  const data = guildData(guild);
  const configuredChannel = kind === 'protected' ? data.protection?.logChannel || data.logs[kind] : data.logs[kind];
  const channels = [configuredChannel, data.logs.main].filter(Boolean);
  for (const id of [...new Set(channels)]) {
    const channel = guild.channels.cache.get(id);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed(title, text)] }).catch(() => {});
  }
};
const punishProtectionAttacker = async (guild, offender, config, reason) => {
  if (!offender) return 'unknown executor';
  if (config.punishment === 'ban' && guild.members.me?.permissions.has(PermissionFlagsBits.BanMembers) && offender.bannable) {
    await offender.ban({ reason }).then(() => {}).catch(() => {});
    return 'banned';
  }
  if (config.punishment === 'kick' && guild.members.me?.permissions.has(PermissionFlagsBits.KickMembers) && offender.kickable) {
    await offender.kick(reason).then(() => {}).catch(() => {});
    return 'kicked';
  }
  const botRole = guild.members.me?.roles.highest;
  const roles = offender.roles.cache.filter(role => isPermissionRole(role) && (!botRole || role.position < botRole.position)).map(role => role.id);
  if (roles.length) {
    await offender.roles.remove(roles, reason).then(() => {}).catch(() => {});
    return 'permissions stripped';
  }
  return 'action unavailable';
};
const page = (title, items, index, total, makeText, idPrefix = 'page') => {
  const start = index * 6;
  const body = items.slice(start, start + 6).map(makeText).join('\n\n') || 'Nothing to show.';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${idPrefix}:${index - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`${idPrefix}:${index + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(index >= total - 1)
  );
  return { embeds: [embed(title, `${body}\n\nPage ${index + 1}/${Math.max(total, 1)}`)], components: [row] };
};

const setupView = (ownerId, state, existing = false) => {
  const config = state.config;
  const summary = `Status: **${config.enabled ? 'Enabled' : 'Disabled'}**\nProtection: **${config.protectionType}**\nRestoration: **${config.automaticRestore ? 'Automatic' : 'Log only'}**\nAttack threshold: **${config.attemptThreshold} / ${config.attemptWindow}s**\nPunishment: **${config.punishment}**\nLog channel: **${config.logChannel ? `<#${config.logChannel}>` : 'Not configured'}**`;
  if (existing && state.step === 'existing') {
    return { embeds: [embed('Protection setup', `Protection is already configured.\n\n${summary}`)], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ps:${ownerId}:reconfigure`).setLabel('Reconfigure').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ps:${ownerId}:view`).setLabel('View Configuration').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ps:${ownerId}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    )] };
  }
  const descriptions = {
    enable: 'Enable protection for this server?',
    type: 'What would you like to protect?',
    restore: 'What should happen when a protected role is removed?',
    threshold: 'Choose the unauthorized-attempt threshold and time window.',
    punishment: 'What should happen after repeated attacks?',
    channel: 'Where should protection events be logged?',
    confirm: `Review your configuration.\n\n${summary}`,
  };
  const rows = [];
  if (state.step === 'enable') rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ps:${ownerId}:enable:yes`).setLabel('Enable Protection').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ps:${ownerId}:enable:no`).setLabel('Disable Protection').setStyle(ButtonStyle.Secondary)
  ));
  if (state.step === 'type') rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`ps:${ownerId}:type`).setPlaceholder('Select protection type').addOptions(
    { label: 'Users', value: 'users' }, { label: 'Roles', value: 'roles' }, { label: 'Both', value: 'both' }
  )));
  if (state.step === 'restore') rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ps:${ownerId}:restore:yes`).setLabel('Automatically Restore').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ps:${ownerId}:restore:no`).setLabel('Log Only').setStyle(ButtonStyle.Secondary)
  ));
  if (state.step === 'threshold') rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`ps:${ownerId}:threshold`).setPlaceholder('Select attack threshold').addOptions(
    { label: '4 attempts / 30 seconds', value: '4:30', description: 'Recommended default' },
    { label: '5 attempts / 30 seconds', value: '5:30' }, { label: '6 attempts / 60 seconds', value: '6:60' }
  )));
  if (state.step === 'punishment') rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`ps:${ownerId}:punishment`).setPlaceholder('Select punishment').addOptions(
    { label: 'Strip permissions', value: 'strip' }, { label: 'Kick', value: 'kick' }, { label: 'Ban', value: 'ban' }
  )));
  if (state.step === 'channel') rows.push(new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId(`ps:${ownerId}:channel`).setPlaceholder('Select protection log channel').setChannelTypes(ChannelType.GuildText)));
  if (state.step === 'confirm') rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ps:${ownerId}:confirm`).setLabel('Confirm Setup').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ps:${ownerId}:back`).setLabel('Back').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`ps:${ownerId}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Danger)
  ));
  if (state.step !== 'confirm') rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ps:${ownerId}:cancel`).setLabel('Cancel').setStyle(ButtonStyle.Danger)));
  return { embeds: [embed('Protection setup', descriptions[state.step])], components: rows };
};

const commandList = [
  ['-help / -commands / -cmds', 'Open the command dashboard'], ['-logs', 'Show configured log channels'], ['-setlogs <type> <channel>', 'Set strike, protected, or main logs'],
  ['-strike @user <reason>', 'Add a strike; third strike removes permission roles'], ['-st @user <reason>', 'Alias for strike'], ['-rmstrike @user <reason>', 'Remove the latest strike'],
  ['-rmst @user <reason>', 'Alias for rmstrike'], ['-clearstrikes @user <reason>', 'Clear every current strike'], ['-strikelist', 'List current strikes, six people per page'],
  ['-protect @user|role|ID', 'Protect a user or role from role removal'], ['-rmprotection @user|role|ID', 'Remove protection'], ['-plist', 'List all protected users and protected roles'], ['-view @user|role|ID', 'Show protection, strikes, roles, and tenure'],
  ['-setupprotection', 'Configure protection (owner only)'], ['-godmode enable|disable|@user|@role', 'Protect against mute, deafen, and role changes'], ['-stfu @user [reason]', 'Persistently server-mute a user'], ['-unstfu @user', 'Remove persistent server mute'],
  ['-setstaff @role|ID', 'Set the required staff role (owner only)'], ['-resetstaffrole', 'Clear the staff role so it can be reconfigured (owner only)'], ['-staffblacklist @user|role|ID <reason>', 'Blacklist staff permissions with a required reason'], ['-rmstaffblacklist @user|role|ID <reason>', 'Remove a staff blacklist with a required reason'], ['-staffblacklistlist', 'List active and removed blacklist history'], ['-avatar <image URL>', 'Change the bot avatar (owner only)'], ['-banner <image URL>', 'Change the bot banner (owner only)'], ['-bio <text>', 'Save bot bio text (owner only; Discord API limitation)'], ['-viewaliases', 'Show every command alias'], ['-botclear', 'Clear the last 20 user/bot response messages']
];
const menus = {
  moderation: [['strike', '-strike @user <reason>'], ['rmstrike', '-rmstrike @user <reason>'], ['strikelist', '-strikelist'], ['clearstrikes', '-clearstrikes @user <reason>'], ['staffblacklist', '-staffblacklist @user|role|ID <reason>'], ['rmstaffblacklist', '-rmstaffblacklist @user|role|ID <reason>'], ['staffblacklistlist', '-staffblacklistlist'], ['view', '-view @user|role|ID']],
  protection: [['setupprotection', '-setupprotection'], ['protect', '-protect @user|role|ID'], ['rmprotection', '-rmprotection @user|role|ID'], ['plist', '-plist'], ['godmode', '-godmode enable|disable|@user|@role']],
  voice: [['stfu', '-stfu @user [reason]'], ['unstfu', '-unstfu @user']],
  owner: [['setstaff', '-setstaff @role|ID'], ['resetstaffrole', '-resetstaffrole'], ['setlogs protected', '-setlogs protected #channel|ID'], ['setlogs strike', '-setlogs strike #channel|ID'], ['setlogs main', '-setlogs main #channel|ID'], ['avatar', '-avatar <image URL>'], ['banner', '-banner <image URL>'], ['bio', '-bio <text>']]
};
const dashboard = (index = 0) => {
  const total = Math.ceil(commandList.length / 6);
  const commands = commandList.slice(index * 6, index * 6 + 6).map(([usage, description]) => `**${usage}**\n${description}`).join('\n\n');
  const select = new StringSelectMenuBuilder().setCustomId('menu:commands').setPlaceholder('Choose a command group').addOptions(
    { label: 'Moderation', value: 'moderation', description: 'Strike and review staff' },
    { label: 'Protection', value: 'protection', description: 'Protect users and roles' },
    { label: 'Voice moderation', value: 'voice', description: 'Persistent server mute controls' },
    { label: 'Server owner', value: 'owner', description: 'Server-only configuration' }
  );
  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`commands:page:${index - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`commands:page:${index + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(index >= total - 1)
  );
  return { embeds: [embed('Strike bot commands', `${commands}\n\nPage ${index + 1}/${total}`)], components: [new ActionRowBuilder().addComponents(select), navigation] };
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates], partials: [Partials.GuildMember, Partials.User] });
const cooldowns = new Map();
const protectionAttempts = new Map();
const protectionRestorations = new Set();
const protectionSetups = new Map();
const godmodeProcessing = new Map();
const stfuProcessing = new Set();
const enforceStfu = async member => {
  const record = guildData(member.guild).stfu[member.id];
  if (!record?.active || !member.voice?.channel || member.voice.serverMute) return false;
  const key = `${member.guild.id}:${member.id}`;
  stfuProcessing.add(key);
  const muted = await member.voice.setMute(true, `Active STFU: ${record.reason}`).then(() => true).catch(() => false);
  if (!muted) stfuProcessing.delete(key);
  if (muted) await log(member.guild, 'protected', 'STFU enforced', `${member} was re-muted because STFU is active.`);
  return muted;
};
client.once('ready', () => {
  client.user.setPresence({ status: 'online', activities: [{ name: '.gg/intweakin', type: 0 }] });
  console.log(`Ready as ${client.user.tag}`);
  for (const guild of client.guilds.cache.values()) {
    for (const record of Object.values(guildData(guild).stfu)) {
      if (!record.active) continue;
      const member = guild.members.cache.get(record.targetId);
      if (member?.voice?.channel && !member.voice.serverMute) enforceStfu(member).catch(() => {});
    }
  }
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;
  const data = guildData(message.guild);
  if (command === 'help' || command === 'commands' || command === 'cmds') {
    if (!isStaff(message)) return reply(message, 'Access denied', 'You need the configured staff role to use this bot.');
    return message.reply(dashboard());
  }
  if (command === 'logs') {
    if (!isStaff(message)) return reply(message, 'Access denied', 'You need the configured staff role to use this bot.');
    return reply(message, 'Configured logs', `Strike: ${mentionChannel(message.guild, data.logs.strike)}\nProtected: ${mentionChannel(message.guild, data.logs.protected)}\nMain: ${mentionChannel(message.guild, data.logs.main)}`);
  }
  if (command === 'viewaliases') {
    if (!isStaff(message)) return reply(message, 'Access denied', 'You need the configured staff role to use this bot.');
    return reply(message, 'Aliases', '`-cmds` = `-commands`\n`-st` = `-strike`\n`-rmst` = `-rmstrike`');
  }
  if (command === 'setupprotection') {
    if (!isOwner(message)) return reply(message, 'Owner only', 'Only the guild owner can configure protection.');
    const config = protectionConfig(data);
    const state = { step: config.configured ? 'existing' : 'enable', config: { ...config } };
    protectionSetups.set(`${message.guild.id}:${message.author.id}`, state);
    return message.reply(setupView(message.author.id, state, config.configured));
  }
  if (command === 'vmc') {
    const voiceStats = getVoiceStats(message.guild);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .addFields(
            { name: 'vcs:', value: `${voiceStats.channels}`, inline: true },
            { name: 'members in vc:', value: `${voiceStats.members}`, inline: true }
          )
      ]
    });
  }
  if (command === 'mc') {
    const memberStats = getMemberStats(message.guild);
    return message.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865F2)
          .addFields(
            { name: 'members:', value: `${memberStats.total}`, inline: true },
            { name: 'bots:', value: `${memberStats.bots}`, inline: true },
            { name: 'recent members joined:', value: `${memberStats.newIn24h}`, inline: true }
          )
      ]
    });
  }
  const profileCommands = ['avatar', 'banner', 'bio'];
  if ([...profileCommands, 'setlogs', 'setstaff', 'resetstaffrole'].includes(command) && !isOwner(message)) return reply(message, 'Owner only', 'Only the guild owner can change bot configuration.');
  if (profileCommands.includes(command)) {
    const value = args.join(' ').trim();
    if (!value) return reply(message, 'Value required', `Usage: \'-${command} ${command === 'bio' ? '<text>' : '<image URL>'}\'`);
    if (command === 'bio') {
      data.botProfile.bio = value; save();
      return reply(message, 'Bio saved', 'The requested bio was saved. Discord does not currently expose bot bio editing through its bot API, so it cannot be applied to the public bot profile.');
    }
    let url;
    try { url = new URL(value); } catch { return reply(message, 'Invalid image URL', `Usage: \'-${command} <https image URL>\'`); }
    if (!['http:', 'https:'].includes(url.protocol)) return reply(message, 'Invalid image URL', 'The image must use an HTTP or HTTPS URL.');
    try {
      if (command === 'avatar') await client.user.setAvatar(url.toString());
      else await client.user.setBanner(url.toString());
    } catch (error) {
      return reply(message, `${command} update failed`, 'Discord rejected that image. Check the URL, image format, size, and try again.');
    }
    data.botProfile[command] = url.toString(); save();
    return reply(message, `${command} updated`, `The bot ${command} was updated successfully.`);
  }
  if (!['help', 'commands', 'cmds', 'logs', 'viewaliases', 'setupprotection', 'setlogs', 'setstaff', 'resetstaffrole', ...profileCommands].includes(command) && !isStaff(message)) return reply(message, 'Access denied', 'You need the configured staff role to use this bot.');
  if (command === 'botclear') {
    if (!message.channel.permissionsFor(message.guild.members.me).has(PermissionFlagsBits.ManageMessages)) return reply(message, 'Cleanup unavailable', 'The bot needs Manage Messages in this channel.');
    const messages = await message.channel.messages.fetch({ limit: 100 });
    const matching = messages.filter(item => item.author.id === message.author.id || item.author.id === client.user.id).first(20);
    const removable = matching.filter(item => Date.now() - item.createdTimestamp < 1209600000);
    if (removable.size) await message.channel.bulkDelete(removable, true).catch(() => {});
    return reply(message, 'Bot responses cleared', `Removed ${removable.size} recent message(s) from you and this bot.`);
  }
  if (command === 'godmode') {
    const action = args[0]?.toLowerCase();
    if (!action) return reply(message, 'Godmode usage', 'Usage: `-godmode enable`, `-godmode disable`, `-godmode @user`, or `-godmode @role`');
    if (action === 'enable') {
      setGodmodeForUser(godmodeDb, message.guild.id, message.author.id, { grantedBy: message.author.id, source: 'self', roleIds: [] });
      saveGodmode();
      return reply(message, 'Godmode enabled', 'Godmode enabled. You can no longer be server muted or deafened.');
    }
    if (action === 'disable') {
      const removed = removeGodmodeForUser(godmodeDb, message.guild.id, message.author.id);
      saveGodmode();
      return reply(message, 'Godmode disabled', removed ? 'Godmode disabled.' : 'Godmode was not enabled for you.');
    }
    const hasGrantPermission = isOwner(message) || isStaff(message);
    if (!hasGrantPermission) return reply(message, 'Permission denied', 'You do not have permission to grant Godmode.');
    const target = message.mentions.members.first() || message.mentions.roles.first() || roleResolver(message.guild, args[0]) || await userResolver(message, args[0]);
    if (!target) return reply(message, 'Invalid target', 'Usage: `-godmode @user` or `-godmode @role`');
    if (target instanceof Role || target.constructor?.name === 'Role') {
      const roleId = target.id;
      grantRoleGodmode(godmodeDb, message.guild.id, roleId, message.author.id);
      for (const member of message.guild.members.cache.values()) {
        if (member.user.bot || !member.roles.cache.has(roleId)) continue;
        applyRoleGodmodeToMember(godmodeDb, message.guild.id, member.id, roleId, message.author.id);
      }
      saveGodmode();
      return reply(message, 'Godmode granted to everyone with @role', `Godmode granted to everyone with ${target}.`);
    }
    setGodmodeForUser(godmodeDb, message.guild.id, target.id, { grantedBy: message.author.id, source: 'staff', roleIds: [] });
    saveGodmode();
    return reply(message, 'Godmode granted to @user', `Godmode granted to ${target}.`);
  }
  if (command === 'stfu' || command === 'unstfu') {
    const target = message.mentions.members.first() || await message.guild.members.fetch(args[0]?.replace(/[<@!>]/g, '')).catch(() => null);
    if (!target || target.user.bot) return reply(message, 'Invalid target', 'Usage: `-stfu @user [reason]`');
    if (target.id === message.author.id || target.id === message.guild.ownerId) return reply(message, 'Action blocked', 'You cannot apply this action to yourself or the guild owner.');
    if (command === 'unstfu') {
      const record = data.stfu[target.id];
      if (!record?.active) return reply(message, 'STFU not active', `${target} is not currently under STFU.`);
      record.active = false; record.removedBy = message.author.id; record.removedAt = new Date().toISOString();
      data.stfuHistory.push({ ...record }); delete data.stfu[target.id]; save();
      if (target.voice?.channel) await target.voice.setMute(false, 'STFU removed').catch(() => {});
      await log(message.guild, 'protected', 'STFU removed', `${target} was released by ${message.author}.`);
      return reply(message, 'STFU removed', `${target} is no longer under persistent server mute.`);
    }
    if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.MuteMembers) || !target.manageable) return reply(message, 'Action unavailable', 'I cannot manage that member because of missing Mute Members permission or role hierarchy.');
    const reason = args.slice(1).join(' ').trim() || 'No reason provided';
    const record = { guildId: message.guild.id, targetId: target.id, executorId: message.author.id, reason, timestamp: new Date().toISOString(), active: true };
    data.stfu[target.id] = record; save();
    if (target.voice?.channel) await target.voice.setMute(true, `STFU: ${reason}`).catch(() => {});
    await log(message.guild, 'protected', 'STFU applied', `${target} was server-muted by ${message.author}. Reason: ${reason}`);
    return reply(message, 'STFU applied', `${target} will remain server-muted until ` + '```-unstfu @user```' + ' is used.');
  }
  if (command === 'setstaff') {
    const role = roleResolver(message.guild, args[0]);
    if (!role) return reply(message, 'Invalid role', 'Usage: `-setstaff @role|role ID`');
    const previousRoleId = data.staffRoleId;
    data.staffRoleId = role.id; save();
    await log(message.guild, 'main', 'Staff role configured', `${role} is now the bot staff role${previousRoleId ? ` (replacing <@&${previousRoleId}>)` : ''}. Changed by ${message.author}.`);
    return reply(message, 'Staff role set', `${role} can now access bot commands.`);
  }
  if (command === 'resetstaffrole') {
    if (!data.staffRoleId) return reply(message, 'No staff role configured', 'Use `-setstaff @role|role ID` to configure one.');
    const oldRole = message.guild.roles.cache.get(data.staffRoleId);
    data.staffRoleId = null; save(); return reply(message, 'Staff role reset', `The configured staff role${oldRole ? ` "${oldRole.name}"` : ''} was cleared. Run \'-setstaff @role|role ID\' to set a new one.`);
  }
  if (command === 'setlogs') {
    const type = args.shift()?.toLowerCase(); const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[0]);
    if (!['strike', 'protected', 'main'].includes(type) || !channel?.isTextBased()) return reply(message, 'Invalid log setup', 'Usage: `-setlogs strike|protected|main #channel|channel ID`');
    data.logs[type] = channel.id; save(); return reply(message, 'Log channel set', `${type} logs will be sent to ${channel}.`);
  }
  if (command === 'staffblacklist' || command === 'rmstaffblacklist') {
    const { target, reason } = await parseBlacklistTargetReason(message);
    if (!target || !reason) return reply(message, 'Reason required', `A reason is required. Usage: \'-${command} @user|role|ID <reason>\'`);
    const isRole = target instanceof Role;
    const collection = isRole ? data.staffBlacklistRoles : data.staffBlacklistUsers;
    if (command === 'rmstaffblacklist') {
      if (!collection[target.id]) return reply(message, 'Not blacklisted', `${target} does not have a staff blacklist entry.`);
      const previous = collection[target.id];
      data.staffBlacklistHistory.push({ targetId: target.id, targetType: isRole ? 'role' : 'user', ...previous, action: 'removed', removedBy: message.author.id, removedAt: new Date().toISOString(), removalReason: reason });
      delete collection[target.id]; save(); await log(message.guild, 'protected', 'Staff blacklist removed', `${target} was removed from the staff blacklist by ${message.author}. Reason: ${reason}`); return reply(message, 'Staff blacklist removed', `${target} is no longer staff blacklisted.`);
    }
    const record = { targetId: target.id, targetType: isRole ? 'role' : 'user', action: 'added', by: message.author.id, reason, at: new Date().toISOString() };
    collection[target.id] = record;
    data.staffBlacklistHistory.push(record);
    save(); await log(message.guild, 'protected', 'Staff blacklist added', `${target} was staff blacklisted by ${message.author}. Reason: ${reason}`);
    const member = !isRole ? await message.guild.members.fetch(target.id).catch(() => null) : null;
    const permissionRoles = member?.roles.cache.filter(isStaffBlacklistRole).map(role => role.id) || [];
    if (member && permissionRoles.length) await member.roles.remove(permissionRoles, 'Staff blacklist added').catch(() => {});
    return reply(message, 'Staff blacklist added', `${target} is now staff blacklisted. Any role with ban, kick, timeout, move, or administrator permissions will be automatically removed.`);
  }
  if (command === 'staffblacklistlist') {
    const active = [...Object.entries(data.staffBlacklistUsers).map(([id, record]) => ({ id, ...record, targetType: 'user', action: 'active' })), ...Object.entries(data.staffBlacklistRoles).map(([id, record]) => ({ id, ...record, targetType: 'role', action: 'active' }))];
    const history = data.staffBlacklistHistory.filter(record => record.action === 'removed').map(record => ({ id: record.targetId, ...record }));
    const entries = [...active, ...history].sort((left, right) => new Date(right.removedAt || right.at).getTime() - new Date(left.removedAt || left.at).getTime());
    return message.reply(page('Staff blacklist history', entries, 0, Math.ceil(entries.length / 6), record => {
      const target = record.targetType === 'role' ? `<@&${record.id}>` : `<@${record.id}>`;
      const date = record.removedAt || record.at;
      const action = record.action === 'active' ? 'ACTIVE' : 'REMOVED';
      const detail = record.action === 'removed' ? `Removed by <@${record.removedBy}>: ${record.removalReason}` : `By <@${record.by}>: ${record.reason}`;
      return `**${action}** ${target} (${record.targetType})\n<t:${Math.floor(new Date(date).getTime() / 1000)}:R>\n${detail.slice(0, 700)}`;
    }, `blacklist:${message.author.id}`));
  }
  if (command === 'strike' || command === 'st' || command === 'rmstrike' || command === 'rmst' || command === 'clearstrikes') {
    const { target, reason } = await parseTargetReason(message);
    if (!target || !reason) return reply(message, 'Reason required', 'A reason is required. Usage: `-' + (command === 'rmst' ? 'rmstrike' : command === 'st' ? 'strike' : command) + ' @user <reason>`');
    const staffRoleId = data.staffRoleId;
    if (command === 'strike' || command === 'st') {
      if (target.id === message.author.id) return reply(message, 'Strike blocked', 'You cannot strike yourself.');
      if (target.id === message.guild.ownerId) return reply(message, 'Strike blocked', 'You cannot strike the guild owner.');
      if (target.id === client.user.id) return reply(message, 'Strike blocked', 'You cannot strike the bot.');
      if (staffRoleId && target.id !== message.guild.ownerId && (message.guild.members.cache.get(target.id)?.roles.cache.has(staffRoleId))) return reply(message, 'Strike blocked', 'You cannot strike a member of the staff management team.');
    }
    const records = data.strikes[target.id] ||= [];
    if (command === 'clearstrikes') {
      const clearedAt = new Date().toISOString();
      const clearedCount = records.length;
      for (const record of records) {
        record.status = 'removed'; record.removedAt = clearedAt; record.removedBy = message.author.id; record.removalReason = reason; record.removalType = 'cleared';
      }
      data.strikes[target.id] = [];
      save(); await log(message.guild, 'strike', 'Strikes cleared', `${target} had ${clearedCount} strike(s) cleared by ${message.author}. Reason: ${reason}`); return reply(message, 'Strikes cleared', `All current strikes for ${target} were cleared.`);
    }
    if (command === 'rmstrike') {
      if (!records.length) return reply(message, 'No strikes', `${target} has no current strikes.`);
      const removed = records.pop(); const removedAt = new Date().toISOString();
      removed.status = 'removed'; removed.removedAt = removedAt; removed.removedBy = message.author.id; removed.removalReason = reason; removed.removalType = 'removed';
      (data.removedStrikes[target.id] ||= []).push(removed);
      save(); await log(message.guild, 'strike', 'Strike removed', `${target} had strike ${removed.id || 'record'} removed by ${message.author}. Reason: ${reason}`); return reply(message, 'Strike removed', `Removed strike ${removed.id || 'record'} from ${target}.`);
    }
    const key = `${message.guild.id}:${message.author.id}:${target.id}`; const last = cooldowns.get(key) || 0;
    if (Date.now() - last < 15000) return reply(message, 'Strike cooldown', 'Wait 15 seconds before striking this user again.');
    cooldowns.set(key, Date.now());
    const strike = { id: `${message.guild.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, guildId: message.guild.id, targetId: target.id, at: new Date().toISOString(), by: message.author.id, reason, status: 'active' };
    records.push(strike); data.strikeHistory.push(strike);
    if (records.length === 3) {
      const member = await message.guild.members.fetch(target.id).catch(() => null);
      const highestBotRole = member?.guild.members.me?.roles.highest;
      const removedRoles = member?.roles.cache.filter(role => isAdminRole(role) && (!highestBotRole || role.position < highestBotRole.position)).map(role => role.id) || [];
      if (member && removedRoles.length) await member.roles.remove(removedRoles, 'Three strikes').catch(() => {});
      await target.send({ embeds: [embed('Staff removal', `You received your third strike in **${message.guild.name}** and were removed from staff permission roles.\nReason: ${reason}`)] }).catch(() => {});
      await log(message.guild, 'strike', 'Third strike: staff roles removed', `${target} reached 3 strikes. Removed ${removedRoles.length} permission role(s). By ${message.author}.`);
    } else await log(message.guild, 'strike', 'Strike added', `${target} now has ${records.length}/3 strikes. By ${message.author}. Reason: ${reason}`);
    save(); return reply(message, 'Strike added', `${target} now has ${records.length}/3 strikes.`);
  }
  if (command === 'strikelist') {
    const people = Object.entries(data.strikes).filter(([, records]) => records.length).sort((a, b) => b[1].at(-1).at.localeCompare(a[1].at(-1).at));
    return message.reply(page('Current strikes', people, 0, Math.ceil(people.length / 6), ([id, records]) => { const latest = records.at(-1); return `<@${id}>: **${records.length}/3**\nLatest: <t:${Math.floor(new Date(latest.at).getTime() / 1000)}:R> by <@${latest.by}>\n${latest.reason}`; }, `strikes:${message.author.id}`));
  }
  if (command === 'protect' || command === 'rmprotection' || command === 'view' || command === 'plist') {
    if (command === 'plist') {
      const protectedUsers = Object.entries(data.protectedUsers).map(([id, record]) => `• <@${id}> protected by <@${record.by}> (${record.roles?.length || 0} role snapshot entries)`).join('\n');
      const protectedRoles = Object.entries(data.protectedRoles).map(([id, record]) => `• <@&${id}> protected by <@${record.by}>`).join('\n');
      const body = [protectedUsers || 'No protected users.', protectedRoles || 'No protected roles.'].join('\n\n');
      return reply(message, 'Protection list', body.length > 1800 ? `${body.slice(0, 1800)}...` : body);
    }
    const target = await resolveProtectionTarget(message, args[0]);
    if (!target) return reply(message, 'Invalid target', `Usage: ${PREFIX}${command} @user|role|ID`);
    const id = target.id; const isRole = target instanceof Role || target.constructor?.name === 'Role';
    if (command === 'protect') {
      const config = protectionConfig(data);
      if (!config.enabled) return reply(message, 'Protection disabled', 'Protection is disabled. Run `-setupprotection` to enable it.');
      if (!protectionTypeAllows(config, isRole)) return reply(message, 'Protection type blocked', `This server is configured to protect ${config.protectionType}.`);
      const member = !isRole ? await message.guild.members.fetch(id).catch(() => null) : null;
      const snapshot = isRole ? [] : (member?.roles.cache.filter(role => role.id !== message.guild.id).map(role => role.id) || []);
      const record = { by: message.author.id, roles: snapshot, at: new Date().toISOString() };
      if (isRole) {
        data.protectedRoles[id] = { by: message.author.id, roles: [], at: record.at };
        await protectMembersWithRole(message.guild, id, message.author.id, data);
      } else {
        data.protectedUsers[id] = record;
      }
      save();
      await log(message.guild, 'protected', 'Protection granted', `${target} protected by ${message.author}.`);
      return reply(message, 'Protection granted', `${target} is now protected.`);
    }
    if (command === 'rmprotection') {
      delete (isRole ? data.protectedRoles : data.protectedUsers)[id];
      save();
      await log(message.guild, 'protected', 'Protection removed', `${target} protection removed by ${message.author}.`);
      return reply(message, 'Protection removed', `${target} is no longer protected.`);
    }
    const member = !isRole ? await message.guild.members.fetch(id).catch(() => null) : null; const records = data.strikes[id] || []; const removed = data.removedStrikes[id] || [];
    const currentHistory = records.map(record => `<t:${Math.floor(new Date(record.at).getTime() / 1000)}:d> by <@${record.by}>: ${record.reason}`).join('\n') || 'none';
    const removedHistory = removed.map(record => `<t:${Math.floor(new Date(record.removedAt).getTime() / 1000)}:d> by <@${record.removedBy}>: ${record.removalReason}`).join('\n') || 'none';
    return reply(message, 'Member view', `Target: ${target}\nProtected: ${Boolean(data.protectedUsers[id] || data.protectedRoles[id])}\nCurrent strikes: ${records.length}/3\nPermission roles: ${member?.roles.cache.filter(isAdminRole).map(role => role.name).join(', ') || 'none'}\nJoined: ${member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:D>` : 'not a member'}\n\nCurrent history:\n${currentHistory}\n\nRemoved history:\n${removedHistory}`);
  }
});

client.on('interactionCreate', async interaction => {
  if ((interaction.isButton() || interaction.isStringSelectMenu() || interaction.isChannelSelectMenu()) && interaction.customId.startsWith('ps:')) {
    const [, ownerId, action, value] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) return interaction.reply({ embeds: [embed('Setup locked', 'Only the guild owner who opened this setup can use it.')], ephemeral: true });
    if (!interaction.guild || interaction.guild.ownerId !== interaction.user.id) return interaction.reply({ embeds: [embed('Owner only', 'Only the current guild owner can configure protection.')], ephemeral: true });
    const data = guildData(interaction.guild);
    let state = protectionSetups.get(`${interaction.guild.id}:${ownerId}`);
    if (action === 'cancel') { protectionSetups.delete(`${interaction.guild.id}:${ownerId}`); return interaction.update({ embeds: [embed('Protection setup cancelled', 'No protection settings were changed.')], components: [] }); }
    if (action === 'view') return interaction.update(setupView(ownerId, { step: 'existing', config: protectionConfig(data) }, true));
    if (action === 'reconfigure') state = { step: 'enable', config: protectionConfig(data) };
    else if (!state) return interaction.update({ embeds: [embed('Setup expired', 'Run `-setupprotection` to start again.')], components: [] });
    else if (action === 'enable') { state.config.enabled = value === 'yes'; state.step = 'type'; }
    else if (action === 'type') { state.config.protectionType = interaction.values[0]; state.step = 'restore'; }
    else if (action === 'restore') { state.config.automaticRestore = value === 'yes'; state.step = 'threshold'; }
    else if (action === 'threshold') { const [threshold, window] = interaction.values[0].split(':').map(Number); state.config.attemptThreshold = threshold; state.config.attemptWindow = window; state.step = 'punishment'; }
    else if (action === 'punishment') { state.config.punishment = interaction.values[0]; state.step = 'channel'; }
    else if (action === 'channel') { state.config.logChannel = interaction.values[0]; state.step = 'confirm'; }
    else if (action === 'back') { const previous = { confirm: 'channel', channel: 'punishment', punishment: 'threshold', threshold: 'restore', restore: 'type', type: 'enable' }; state.step = previous[state.step] || 'enable'; }
    else if (action === 'confirm') {
      data.protection = { ...protectionConfig(data), ...state.config, configured: true, configuredBy: ownerId, configuredAt: new Date().toISOString() };
      save(); protectionSetups.delete(`${interaction.guild.id}:${ownerId}`);
      await log(interaction.guild, 'protected', 'Protection configured', `Protection was configured by <@${ownerId}>.`);
      return interaction.update({ embeds: [embed('Protection configured', 'Protection system successfully configured.\nUse `-protect` to protect a user or role.')], components: [] });
    }
    protectionSetups.set(`${interaction.guild.id}:${ownerId}`, state);
    return interaction.update(setupView(ownerId, state));
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'menu:commands') {
    const items = menus[interaction.values[0]]; return interaction.update({ embeds: [embed(`${interaction.values[0]} commands`, items.map(([name, usage]) => `**${usage}**`).join('\n'))], components: [interaction.message.components[0], interaction.message.components[1]] });
  }
  if (interaction.isButton() && interaction.customId.startsWith('commands:page:')) {
    const index = Number(interaction.customId.split(':')[2]); return interaction.update(dashboard(index));
  }
  if (interaction.isButton() && interaction.customId.startsWith('blacklist:')) {
    const [, ownerId, indexText] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) return interaction.reply({ embeds: [embed('Navigation locked', 'Only the person who opened this list can change its page.')], ephemeral: true });
    const data = guildData(interaction.guild);
    const active = [...Object.entries(data.staffBlacklistUsers).map(([id, record]) => ({ id, ...record, targetType: 'user', action: 'active' })), ...Object.entries(data.staffBlacklistRoles).map(([id, record]) => ({ id, ...record, targetType: 'role', action: 'active' }))];
    const history = data.staffBlacklistHistory.filter(record => record.action === 'removed').map(record => ({ id: record.targetId, ...record }));
    const entries = [...active, ...history].sort((left, right) => new Date(right.removedAt || right.at).getTime() - new Date(left.removedAt || left.at).getTime());
    const index = Number(indexText); const total = Math.ceil(entries.length / 6);
    return interaction.update(page('Staff blacklist history', entries, index, total, record => {
      const target = record.targetType === 'role' ? `<@&${record.id}>` : `<@${record.id}>`;
      const date = record.removedAt || record.at;
      const action = record.action === 'active' ? 'ACTIVE' : 'REMOVED';
      const detail = record.action === 'removed' ? `Removed by <@${record.removedBy}>: ${record.removalReason}` : `By <@${record.by}>: ${record.reason}`;
      return `**${action}** ${target} (${record.targetType})\n<t:${Math.floor(new Date(date).getTime() / 1000)}:R>\n${detail.slice(0, 700)}`;
    }, `blacklist:${ownerId}`));
  }
  if (interaction.isButton() && interaction.customId.startsWith('strikes:')) {
    const [, ownerId, indexText] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) return interaction.reply({ embeds: [embed('Navigation locked', 'Only the person who opened this list can change its page.')], ephemeral: true });
    const data = guildData(interaction.guild); const people = Object.entries(data.strikes).filter(([, records]) => records.length).sort((a, b) => b[1].at(-1).at.localeCompare(a[1].at(-1).at));
    const index = Number(indexText); const total = Math.ceil(people.length / 6);
    return interaction.update(page('Current strikes', people, index, total, ([id, records]) => { const latest = records.at(-1); return `<@${id}>: **${records.length}/3**\nLatest: <t:${Math.floor(new Date(latest.at).getTime() / 1000)}:R> by <@${latest.by}>\n${latest.reason}`; }, `strikes:${ownerId}`));
  }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
  const guildState = ensureGuildGodmode(godmodeDb, newMember.guild.id);
  const roleGodmodeIds = Object.keys(guildState.roles);
  for (const roleId of roleGodmodeIds) {
    if (newMember.roles.cache.has(roleId)) {
      applyRoleGodmodeToMember(godmodeDb, newMember.guild.id, newMember.id, roleId, guildState.roles[roleId].by || newMember.id);
    }
  }

  const data = guildData(newMember.guild);
  const config = protectionConfig(data);

  const blacklistedRole = newMember.roles.cache.find(role => data.staffBlacklistRoles[role.id]);
  const blacklistEntry = data.staffBlacklistUsers[newMember.id] || (blacklistedRole && data.staffBlacklistRoles[blacklistedRole.id]);
  if (blacklistEntry) {
    const blacklistRoleIds = new Set(Object.keys(data.staffBlacklistRoles));
    const permissionRoles = newMember.roles.cache.filter(role => isStaffBlacklistRole(role) && !blacklistRoleIds.has(role.id)).map(role => role.id);
    if (permissionRoles.length) {
      await newMember.roles.remove(permissionRoles, 'Staff blacklist enforcement').catch(() => {});
      await log(newMember.guild, 'protected', 'Staff blacklist enforced', `Removed permission roles from ${newMember} because they are staff blacklisted.`);
    }
  }

  const protectedUserEntry = data.protectedUsers[newMember.id];
  const missingProtected = new Set();
  if (protectedUserEntry?.roles?.length) {
    for (const roleId of protectedUserEntry.roles) {
      if (roleId !== newMember.guild.id && !newMember.roles.cache.has(roleId)) missingProtected.add(roleId);
    }
  }
  for (const roleId of Object.keys(data.protectedRoles)) {
    if (newMember.roles.cache.has(roleId)) missingProtected.delete(roleId);
  }

  const audit = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 20 }).catch(() => null);
  const auditEntry = audit?.entries.find(entry => entry.target?.id === newMember.id && Date.now() - entry.createdTimestamp < 10000 && entry.executor?.id !== client.user.id);
  const executorId = auditEntry?.executor?.id;

  if (config.enabled && protectedUserEntry && missingProtected.size) {
    const restorationKey = `${newMember.guild.id}:${newMember.id}`;
    if (protectionRestorations.has(restorationKey)) {
      protectionRestorations.delete(restorationKey);
      return;
    }
    if (!executorId || (executorId !== protectedUserEntry.by && executorId !== newMember.guild.ownerId)) {
      const key = `${newMember.guild.id}:${executorId || 'unknown'}:${newMember.id}`;
      const recent = (protectionAttempts.get(key) || []).filter(time => Date.now() - time < 30000);
      recent.push(Date.now());
      protectionAttempts.set(key, recent);
      if (recent.length >= config.attemptThreshold) {
        const offender = executorId ? await newMember.guild.members.fetch(executorId).catch(() => null) : null;
        const action = await punishProtectionAttacker(newMember.guild, offender, config, 'Repeated protected-user tampering');
        protectionAttempts.delete(key);
        await log(newMember.guild, 'protected', 'Protection escalation', `${offender || 'An unknown actor'} triggered protection escalation; action: ${action}.`);
      }
      const manageableMissing = [...missingProtected].filter(roleId => {
        const role = newMember.guild.roles.cache.get(roleId);
        return role && (!newMember.guild.members.me?.roles.highest || role.position < newMember.guild.members.me.roles.highest.position);
      });
      if (config.automaticRestore && manageableMissing.length) {
        protectionRestorations.add(restorationKey);
        const restored = await newMember.roles.add(manageableMissing, 'Restore protected user roles').then(() => true).catch(() => false);
        if (restored) await log(newMember.guild, 'protected', 'Protected roles restored', `Restored protected roles for ${newMember} after an unauthorized role change.`);
        else protectionRestorations.delete(restorationKey);
      }
      return;
    }
  }

  const protectedRoleMissing = [...oldMember.roles.cache.keys()].filter(roleId => !newMember.roles.cache.has(roleId) && data.protectedRoles[roleId]);
  for (const roleId of protectedRoleMissing) {
    const protectorId = data.protectedRoles[roleId]?.by;
    const isAllowedRemoval = !executorId || executorId === protectorId || executorId === newMember.guild.ownerId;
    if (config.enabled && (!isAllowedRemoval || !protectedRoleMissing.length)) {
      const role = newMember.guild.roles.cache.get(roleId);
      if (config.automaticRestore && role && (!newMember.guild.members.me?.roles.highest || role.position < newMember.guild.members.me.roles.highest.position)) {
        const restorationKey = `${newMember.guild.id}:${newMember.id}`;
        protectionRestorations.add(restorationKey);
        const restored = await newMember.roles.add(roleId, 'Protected role re-added').then(() => true).catch(() => false);
        if (restored) await log(newMember.guild, 'protected', 'Protected role restored', `Re-added protected role <@&${roleId}> to ${newMember} because it was removed without the original protector.`);
        else protectionRestorations.delete(restorationKey);
      }
      return;
    }
  }

  const protectedRoleIds = [...newMember.roles.cache.keys()].filter(roleId => data.protectedRoles[roleId]);
  for (const roleId of protectedRoleIds) {
    const protectedRoleInfo = data.protectedRoles[roleId];
    if (!protectedRoleInfo || !executorId || executorId === protectedRoleInfo.by) continue;
    const key = `${newMember.guild.id}:${executorId}:${roleId}`;
    const recent = (protectionAttempts.get(key) || []).filter(time => Date.now() - time < 30000);
    recent.push(Date.now());
    protectionAttempts.set(key, recent);
    if (recent.length >= config.attemptThreshold) {
      const offender = await newMember.guild.members.fetch(executorId).catch(() => null);
      const action = await punishProtectionAttacker(newMember.guild, offender, config, 'Repeated protected-role tampering');
      protectionAttempts.delete(key);
      await log(newMember.guild, 'protected', 'Protection escalation', `${offender || auditEntry.executor} triggered protection escalation; action: ${action}.`);
    }
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guildId = member.guild.id;
  const stfuKey = `${guildId}:${member.id}`;
  if (stfuProcessing.has(stfuKey)) {
    stfuProcessing.delete(stfuKey);
  } else if (guildData(member.guild).stfu[member.id]?.active && newState.channel) {
    if (!newState.serverMute) {
      await log(member.guild, 'protected', 'Unauthorized STFU unmute', `${member} was unmuted while STFU was active; enforcement was reapplied.`);
      await enforceStfu(member);
    }
  }
  if (!hasGodmode(godmodeDb, guildId, member.id)) return;

  const me = member.guild.members.me;
  if (!me) return;

  const canMute = me.permissions.has(PermissionFlagsBits.MuteMembers);
  const canDeafen = me.permissions.has(PermissionFlagsBits.DeafenMembers);

  const currentMute = newState.serverMute;
  const currentDeaf = newState.serverDeaf;
  const muteKey = `${guildId}:${member.id}:mute`;
  const deafKey = `${guildId}:${member.id}:deaf`;

  const now = Date.now();
  const muteLockedUntil = godmodeProcessing.get(muteKey) || 0;
  const deafLockedUntil = godmodeProcessing.get(deafKey) || 0;

  if (currentMute && canMute && now > muteLockedUntil) {
    const freshState = member.guild.members.cache.get(member.id)?.voice;
    if (!freshState || !freshState.serverMute) return;
    godmodeProcessing.set(muteKey, now + 1000);
    try {
      await member.voice?.setMute(false, 'Godmode protection');
      await log(member.guild, 'protected', 'Godmode protection triggered', `${member} was automatically unmuted by Godmode.`);
    } catch (error) {
      console.error(`Godmode mute enforcement failed for ${member.id}:`, error?.message || error);
    }
  }

  if (currentDeaf && canDeafen && now > deafLockedUntil) {
    const freshState = member.guild.members.cache.get(member.id)?.voice;
    if (!freshState || !freshState.serverDeaf) return;
    godmodeProcessing.set(deafKey, now + 1000);
    try {
      await member.voice?.setDeaf(false, 'Godmode protection');
      await log(member.guild, 'protected', 'Godmode protection triggered', `${member} was automatically undeafened by Godmode.`);
    } catch (error) {
      console.error(`Godmode deaf enforcement failed for ${member.id}:`, error?.message || error);
    }
  }

  if (now > (godmodeProcessing.get(muteKey) || 0) && !currentMute) {
    godmodeProcessing.delete(muteKey);
  }
  if (now > (godmodeProcessing.get(deafKey) || 0) && !currentDeaf) {
    godmodeProcessing.delete(deafKey);
  }
});

if (!process.env.DISCORD_TOKEN) { console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and add your bot token.'); process.exitCode = 1; } else client.login(process.env.DISCORD_TOKEN);
