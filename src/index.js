require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const {
  Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits,
  AuditLogEvent, ChannelType, Role
} = require('discord.js');

const PREFIX = process.env.PREFIX || '-';
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
const file = path.join(dataDir, 'guilds.json');
let db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 2));
const guildData = guild => {
  const data = db[guild.id] ||= { strikes: {}, removedStrikes: {}, logs: {}, staffRoleId: null, protectedUsers: {}, protectedRoles: {}, staffBlacklistUsers: {}, staffBlacklistRoles: {}, aliases: {} };
  data.staffBlacklistUsers ||= {};
  data.staffBlacklistRoles ||= {};
  return data;
};
const embed = (title, description) => new EmbedBuilder().setTitle(title).setDescription(description).setFooter({ text: 'bot created by @6xwg / kutt' }).setTimestamp();
const reply = (message, title, description, extra = {}) => message.reply({ embeds: [embed(title, description)], ...extra });
const mentionChannel = (guild, id) => id ? guild.channels.cache.get(id)?.toString() || `<#${id}>` : 'not configured';
const isOwner = message => message.guild.ownerId === message.author.id;
const isStaff = message => isOwner(message) || Boolean(guildData(message.guild).staffRoleId && message.member.roles.cache.has(guildData(message.guild).staffRoleId));
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
const log = async (guild, kind, title, text) => {
  const data = guildData(guild);
  const channels = [data.logs[kind], data.logs.main].filter(Boolean);
  for (const id of [...new Set(channels)]) {
    const channel = guild.channels.cache.get(id);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed(title, text)] }).catch(() => {});
  }
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

const commandList = [
  ['-commands / -cmds', 'Open the command dashboard'], ['-logs', 'Show configured log channels'], ['-setlogs <type> <channel>', 'Set strike, protected, or main logs'],
  ['-strike @user <reason>', 'Add a strike; third strike removes permission roles'], ['-st @user <reason>', 'Alias for strike'], ['-rmstrike @user <reason>', 'Remove the latest strike'],
  ['-rmst @user <reason>', 'Alias for rmstrike'], ['-clearstrikes @user <reason>', 'Clear every current strike'], ['-strikelist', 'List current strikes, six people per page'],
  ['-protect @user|role|ID', 'Protect a user or role from role removal'], ['-rmprotection @user|role|ID', 'Remove protection'], ['-view @user|role|ID', 'Show protection, strikes, roles, and tenure'],
  ['-setstaff @role|ID', 'Set the required staff role (owner only)'], ['-resetstaffrole', 'Clear the staff role so it can be reconfigured (owner only)'], ['-staffblacklist @user|role|ID <reason>', 'Blacklist staff permissions with a required reason'], ['-rmstaffblacklist @user|role|ID <reason>', 'Remove a staff blacklist with a required reason'], ['-viewaliases', 'Show every command alias'], ['-botclear', 'Clear the last 20 user/bot response messages']
];
const menus = {
  moderation: [['strike', '-strike @user <reason>'], ['rmstrike', '-rmstrike @user <reason>'], ['strikelist', '-strikelist'], ['clearstrikes', '-clearstrikes @user <reason>'], ['staffblacklist', '-staffblacklist @user|role|ID <reason>'], ['rmstaffblacklist', '-rmstaffblacklist @user|role|ID <reason>'], ['view', '-view @user|role|ID']],
  protection: [['protect', '-protect @user|role|ID'], ['rmprotection', '-rmprotection @user|role|ID']],
  owner: [['setstaff', '-setstaff @role|ID'], ['resetstaffrole', '-resetstaffrole'], ['setlogs protected', '-setlogs protected #channel|ID'], ['setlogs strike', '-setlogs strike #channel|ID'], ['setlogs main', '-setlogs main #channel|ID']]
};
const dashboard = (index = 0) => {
  const total = Math.ceil(commandList.length / 6);
  const commands = commandList.slice(index * 6, index * 6 + 6).map(([usage, description]) => `**${usage}**\n${description}`).join('\n\n');
  const select = new StringSelectMenuBuilder().setCustomId('menu:commands').setPlaceholder('Choose a command group').addOptions(
    { label: 'Moderation', value: 'moderation', description: 'Strike and review staff' },
    { label: 'Protection', value: 'protection', description: 'Protect users and roles' },
    { label: 'Server owner', value: 'owner', description: 'Server-only configuration' }
  );
  const navigation = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`commands:page:${index - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
    new ButtonBuilder().setCustomId(`commands:page:${index + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(index >= total - 1)
  );
  return { embeds: [embed('Strike bot commands', `${commands}\n\nPage ${index + 1}/${total}`)], components: [new ActionRowBuilder().addComponents(select), navigation] };
};

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent], partials: [Partials.GuildMember] });
const cooldowns = new Map();
const protectionAttempts = new Map();
client.once('ready', () => {
  client.user.setPresence({ status: 'online', activities: [{ name: '.gg/intweakin', type: 0 }] });
  console.log(`Ready as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot || !message.content.startsWith(PREFIX)) return;
  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const command = args.shift()?.toLowerCase();
  if (!command) return;
  const data = guildData(message.guild);
  if (command === 'commands' || command === 'cmds') return message.reply(dashboard());
  if (command === 'logs') return reply(message, 'Configured logs', `Strike: ${mentionChannel(message.guild, data.logs.strike)}\nProtected: ${mentionChannel(message.guild, data.logs.protected)}\nMain: ${mentionChannel(message.guild, data.logs.main)}`);
  if (command === 'viewaliases') return reply(message, 'Aliases', '`-cmds` = `-commands`\n`-st` = `-strike`\n`-rmst` = `-rmstrike`');
  if (['setlogs', 'setstaff', 'resetstaffrole'].includes(command) && !isOwner(message)) return reply(message, 'Owner only', 'Only the guild owner can change bot configuration.');
  if (!['commands', 'cmds', 'logs', 'viewaliases', 'setlogs', 'setstaff', 'resetstaffrole'].includes(command) && !isStaff(message)) return reply(message, 'Access denied', 'You need the configured staff role to use this bot.');
  if (command === 'botclear') {
    if (!message.channel.permissionsFor(message.guild.members.me).has(PermissionFlagsBits.ManageMessages)) return reply(message, 'Cleanup unavailable', 'The bot needs Manage Messages in this channel.');
    const messages = await message.channel.messages.fetch({ limit: 100 });
    const matching = messages.filter(item => item.author.id === message.author.id || item.author.id === client.user.id).first(20);
    const removable = matching.filter(item => Date.now() - item.createdTimestamp < 1209600000);
    if (removable.size) await message.channel.bulkDelete(removable, true).catch(() => {});
    return reply(message, 'Bot responses cleared', `Removed ${removable.size} recent message(s) from you and this bot.`);
  }
  if (command === 'setstaff') {
    const role = roleResolver(message.guild, args[0]);
    if (!role) return reply(message, 'Invalid role', 'Usage: `-setstaff @role|role ID`');
    if (data.staffRoleId) return reply(message, 'Staff role already configured', `setstaff role already configured to "${message.guild.roles.cache.get(data.staffRoleId)?.name || data.staffRoleId}". To change this do the command \'-resetstaffrole\' to reconfigure the staff role to a new role.`);
    data.staffRoleId = role.id; save(); return reply(message, 'Staff role set', `${role} can now access bot commands.`);
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
      delete collection[target.id]; save(); await log(message.guild, 'protected', 'Staff blacklist removed', `${target} was removed from the staff blacklist by ${message.author}. Reason: ${reason}`); return reply(message, 'Staff blacklist removed', `${target} is no longer staff blacklisted.`);
    }
    collection[target.id] = { by: message.author.id, reason, at: new Date().toISOString() };
    save(); await log(message.guild, 'protected', 'Staff blacklist added', `${target} was staff blacklisted by ${message.author}. Reason: ${reason}`);
    const member = !isRole ? await message.guild.members.fetch(target.id).catch(() => null) : null;
    const permissionRoles = member?.roles.cache.filter(isStaffBlacklistRole).map(role => role.id) || [];
    if (member && permissionRoles.length) await member.roles.remove(permissionRoles, 'Staff blacklist added').catch(() => {});
    return reply(message, 'Staff blacklist added', `${target} is now staff blacklisted. Any role with ban, kick, timeout, move, or administrator permissions will be automatically removed.`);
  }
  if (command === 'strike' || command === 'st' || command === 'rmstrike' || command === 'rmst' || command === 'clearstrikes') {
    const { target, reason } = await parseTargetReason(message);
    if (!target || !reason) return reply(message, 'Reason required', 'A reason is required. Usage: `-' + (command === 'rmst' ? 'rmstrike' : command === 'st' ? 'strike' : command) + ' @user <reason>`');
    if (target.id === message.author.id) return reply(message, 'Strike blocked', 'You cannot strike yourself.');
    const staffRoleId = data.staffRoleId;
    if (staffRoleId && target.id !== message.guild.ownerId && (message.guild.members.cache.get(target.id)?.roles.cache.has(staffRoleId))) return reply(message, 'Strike blocked', 'You cannot strike someone who has the configured staff role.');
    const records = data.strikes[target.id] ||= [];
    if (command === 'clearstrikes') { records.length = 0; save(); await log(message.guild, 'strike', 'Strikes cleared', `${target} cleared by ${message.author}. Reason: ${reason}`); return reply(message, 'Strikes cleared', `All current strikes for ${target} were cleared.`); }
    if (command === 'rmstrike') { if (!records.length) return reply(message, 'No strikes', `${target} has no current strikes.`); const removed = records.pop(); (data.removedStrikes[target.id] ||= []).push({ ...removed, removedAt: new Date().toISOString(), removedBy: message.author.id, removalReason: reason }); save(); await log(message.guild, 'strike', 'Strike removed', `${target} had a strike removed by ${message.author}. Reason: ${reason}`); return reply(message, 'Strike removed', `Removed strike from ${target}.`); }
    const key = `${message.guild.id}:${target.id}`; const last = cooldowns.get(key) || 0;
    if (Date.now() - last < 15000) return reply(message, 'Strike cooldown', 'Wait 15 seconds before striking this user again.');
    cooldowns.set(key, Date.now()); records.push({ at: new Date().toISOString(), by: message.author.id, reason });
    if (records.length >= 3) {
      const member = await message.guild.members.fetch(target.id).catch(() => null);
      const removedRoles = member?.roles.cache.filter(isAdminRole).map(role => role.id) || [];
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
  if (command === 'protect' || command === 'rmprotection' || command === 'view') {
    const target = message.mentions.members.first() || message.mentions.roles.first() || roleResolver(message.guild, args[0]) || await userResolver(message, args[0]);
    if (!target) return reply(message, 'Invalid target', `Usage: ${PREFIX}${command} @user|role|ID`);
    const id = target.id; const isRole = target instanceof Object && target.constructor.name === 'Role';
    if (command === 'protect') { const snapshot = isRole ? [] : (message.guild.members.cache.get(id)?.roles.cache.filter(role => role.id !== message.guild.id).map(role => role.id) || []); (isRole ? data.protectedRoles : data.protectedUsers)[id] = { by: message.author.id, roles: snapshot, at: new Date().toISOString() }; save(); await log(message.guild, 'protected', 'Protection granted', `${target} protected by ${message.author}.`); return reply(message, 'Protection granted', `${target} is now protected.`); }
    if (command === 'rmprotection') { delete (isRole ? data.protectedRoles : data.protectedUsers)[id]; save(); await log(message.guild, 'protected', 'Protection removed', `${target} protection removed by ${message.author}.`); return reply(message, 'Protection removed', `${target} is no longer protected.`); }
    const member = !isRole ? await message.guild.members.fetch(id).catch(() => null) : null; const records = data.strikes[id] || []; const removed = data.removedStrikes[id] || [];
    const currentHistory = records.map(record => `<t:${Math.floor(new Date(record.at).getTime() / 1000)}:d> by <@${record.by}>: ${record.reason}`).join('\n') || 'none';
    const removedHistory = removed.map(record => `<t:${Math.floor(new Date(record.removedAt).getTime() / 1000)}:d> by <@${record.removedBy}>: ${record.removalReason}`).join('\n') || 'none';
    return reply(message, 'Member view', `Target: ${target}\nProtected: ${Boolean(data.protectedUsers[id] || data.protectedRoles[id])}\nCurrent strikes: ${records.length}/3\nPermission roles: ${member?.roles.cache.filter(isAdminRole).map(role => role.name).join(', ') || 'none'}\nJoined: ${member?.joinedAt ? `<t:${Math.floor(member.joinedAt.getTime() / 1000)}:D>` : 'not a member'}\n\nCurrent history:\n${currentHistory}\n\nRemoved history:\n${removedHistory}`);
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isStringSelectMenu() && interaction.customId === 'menu:commands') {
    const items = menus[interaction.values[0]]; return interaction.update({ embeds: [embed(`${interaction.values[0]} commands`, items.map(([name, usage]) => `**${usage}**`).join('\n'))], components: [interaction.message.components[0], interaction.message.components[1]] });
  }
  if (interaction.isButton() && interaction.customId.startsWith('commands:page:')) {
    const index = Number(interaction.customId.split(':')[2]); return interaction.update(dashboard(index));
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
  const data = guildData(newMember.guild); const protectedEntry = data.protectedUsers[newMember.id];
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
  const matchingRole = newMember.roles.cache.find(role => data.protectedRoles[role.id]);
  const entry = protectedEntry || (matchingRole && data.protectedRoles[matchingRole.id]);
  if (!entry) return;
  const expected = new Set(entry.roles || oldMember.roles.cache.map(role => role.id));
  const missing = [...expected].filter(id => id !== newMember.guild.id && !newMember.roles.cache.has(id));
  const protectedRoleId = matchingRole?.id || (data.protectedUsers[newMember.id]?.roleId);
  if (protectedRoleId && !newMember.roles.cache.has(protectedRoleId)) missing.push(protectedRoleId);
  if (!missing.length) return;
  const audit = await newMember.guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 5 }).catch(() => null);
  const auditEntry = audit?.entries.find(item => item.target?.id === newMember.id && Date.now() - item.createdTimestamp < 10000);
  if (auditEntry?.executor?.id === entry.by) return;
  if (auditEntry?.executor?.id && auditEntry.executor.id !== client.user.id) {
    const key = `${newMember.guild.id}:${auditEntry.executor.id}`; const recent = (protectionAttempts.get(key) || []).filter(at => Date.now() - at < 30000); recent.push(Date.now()); protectionAttempts.set(key, recent);
    if (recent.length >= 4) {
      const executor = await newMember.guild.members.fetch(auditEntry.executor.id).catch(() => null);
      const permissionRoles = executor?.roles.cache.filter(isAdminRole).map(role => role.id) || [];
      if (permissionRoles.length) await executor.roles.remove(permissionRoles, 'Repeated protected-role removal attempts').catch(() => {});
      protectionAttempts.delete(key);
      await log(newMember.guild, 'protected', 'Protection escalation', `${executor || auditEntry.executor} had permission roles removed after 4 protected-role attempts in 30 seconds.`);
    }
  }
  await newMember.roles.add([...new Set(missing)], 'Restore protected roles').catch(() => {});
  await log(newMember.guild, 'protected', 'Protected roles restored', `Restored roles for ${newMember} after an unauthorized role change.`);
});

if (!process.env.DISCORD_TOKEN) { console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and add your bot token.'); process.exitCode = 1; } else client.login(process.env.DISCORD_TOKEN);
