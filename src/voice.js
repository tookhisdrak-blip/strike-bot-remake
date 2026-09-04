function ensureVoice(data) {
  const voice = data.voice ||= { follows: {}, chains: {}, ownership: {}, overrides: {} };
  voice.follows ||= {};
  voice.chains ||= {};
  voice.ownership ||= {};
  voice.overrides ||= {};
  return voice;
}

function addHistory(data, userId, event) {
  const voice = ensureVoice(data);
  const history = voice.history ||= {};
  const entries = history[userId] ||= [];
  entries.unshift({ ...event, at: event.at || new Date().toISOString() });
  history[userId] = entries.slice(0, 50);
}

function setFollow(data, followerId, targetId) {
  ensureVoice(data).follows[followerId] = targetId;
}

function removeFollow(data, followerId) {
  delete ensureVoice(data).follows[followerId];
}

function setChain(data, ownerId, memberIds) {
  ensureVoice(data).chains[ownerId] = [...new Set(memberIds.filter(Boolean))];
}

module.exports = { ensureVoice, addHistory, setFollow, removeFollow, setChain };
