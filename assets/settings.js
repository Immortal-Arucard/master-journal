/* TWGI master profile settings, per user, saved on this device.
   localStorage key: twgi-settings-v1:<user id>
   Format: { "v": 1, "journal": { "dictationOriginals": "ask" | "always" | "never" } }
   The same file and format are used on the main site's /account/ page and in
   the Journal app. TWGISettings.sync.pull/push are hooks for a later cloud sync.
   Other sections can add their own namespaced groups via TWGISettings.define. */
(function (global) {
  var PREFIX = 'twgi-settings-v1:';
  var ID_RE = /^[A-Za-z0-9-]{1,64}$/;
  var schema = {
    journal: {
      dictationOriginals: { values: ['ask', 'always', 'never'], fallback: 'ask' }
    }
  };
  var listeners = [];

  function key(userId) { return ID_RE.test(String(userId || '')) ? PREFIX + userId : ''; }

  function readRaw(userId) {
    var k = key(userId);
    if (!k) return {};
    try {
      var v = JSON.parse(global.localStorage.getItem(k) || '{}');
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch (err) { return {}; }
  }

  function get(userId, group, name) {
    var def = schema[group] && schema[group][name];
    if (!def) return undefined;
    var raw = readRaw(userId);
    var value = raw[group] && raw[group][name];
    return def.values.indexOf(value) !== -1 ? value : def.fallback;
  }

  function set(userId, group, name, value) {
    var def = schema[group] && schema[group][name];
    var k = key(userId);
    if (!def || !k) throw new Error('Sign in to change settings.');
    if (def.values.indexOf(value) === -1) throw new Error('Unknown setting value.');
    var raw = readRaw(userId);
    raw.v = 1;
    raw[group] = raw[group] && typeof raw[group] === 'object' ? raw[group] : {};
    raw[group][name] = value;
    global.localStorage.setItem(k, JSON.stringify(raw));
    api.sync.push(userId, raw);
    listeners.forEach(function (fn) { try { fn(userId, group, name, value); } catch (err) {} });
    return value;
  }

  var api = {
    storageKey: key,
    get: get,
    set: set,
    define: function (group, name, values, fallback) {
      schema[group] = schema[group] || {};
      schema[group][name] = { values: values.slice(), fallback: fallback };
    },
    onChange: function (fn) { listeners.push(fn); },
    sync: {
      enabled: false,
      pull: function (userId) { return Promise.resolve(null); },
      push: function (userId, all) { return Promise.resolve(false); }
    }
  };
  global.TWGISettings = api;
})(window);
