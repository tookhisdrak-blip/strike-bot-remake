const { ChannelType } = require('discord.js');

function getVoiceStats(guild) {
  let activeChannels = 0;
  let membersInVc = 0;

  for (const channel of guild.channels.cache.values()) {
    const isVoiceChannel = channel && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice || channel.type === 2 || channel.type === 13);
    if (!isVoiceChannel || !channel.members || channel.members.size === 0) continue;
    activeChannels += 1;
    membersInVc += channel.members.size;
  }

  return { channels: activeChannels, members: membersInVc };
}

function getMemberStats(guild, now = Date.now()) {
  let total = 0;
  let humans = 0;
  let bots = 0;
  let newIn24h = 0;
  const cutoff = 24 * 60 * 60 * 1000;

  for (const member of guild.members.cache.values()) {
    total += 1;
    if (member.user.bot) {
      bots += 1;
    } else {
      humans += 1;
    }

    if (member.joinedTimestamp && now - member.joinedTimestamp <= cutoff) {
      newIn24h += 1;
    }
  }

  return { total, humans, bots, newIn24h };
}

module.exports = { getVoiceStats, getMemberStats };
