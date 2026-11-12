/* TWGI Journal note reminders: the shared rules. The SAME file ships in the
   Journal (assets/reminders.js) and in the push Worker
   (backend/src/reminders-core.cjs); a test keeps them identical.

   A reminder lives on its journal entry (entry.reminder) and syncs with it:
     { v: 1,
       on: true,                       on/off switch
       title: 'Call Mum',              notification name (up to 80 characters)
       at: '2026-11-12T09:00',         first time, local wall clock in tz
       tz: 'America/New_York',         IANA time zone
       repeat: 'once' | 'daily' | 'weekly' | 'monthly' | 'hours' | 'days',
       every: 1,                       for 'hours' (1-168) and 'days' (1-365)
       days: [1, 3, 5] }               for 'weekly': 0 = Sunday .. 6 = Saturday
   Pure functions only; no storage, no network. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TWGIReminders = api;
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  var DEFAULT_TZ = 'America/New_York';
  var REPEATS = ['once', 'daily', 'weekly', 'monthly', 'hours', 'days'];
  var MAX_TITLE = 80;
  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var AT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

  function validTimeZone(tz) {
    if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (err) { return false; }
  }

  var formatters = {};
  function parts(ms, tz) {
    var f = formatters[tz];
    if (!f) {
      f = formatters[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    var out = {};
    f.formatToParts(new Date(ms)).forEach(function (p) { if (p.type !== 'literal') out[p.type] = Number(p.value); });
    if (out.hour === 24) out.hour = 0;
    return out;
  }
  function offset(ms, tz) {
    var p = parts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  }
  /* UTC instant of a local wall time. DST gap: moved forward; overlap: earlier instant. */
  function zoned(y, mo, d, h, mi, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi);
    var first = guess - offset(guess, tz);
    var second = guess - offset(first, tz);
    return first === second ? first : Math.min(first, second);
  }

  function parseAt(at) {
    var m = AT_RE.exec(String(at || ''));
    if (!m) return null;
    var p = { year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] };
    if (p.month < 1 || p.month > 12 || p.day < 1 || p.day > 31 || p.hour > 23 || p.minute > 59) return null;
    var check = new Date(Date.UTC(p.year, p.month - 1, p.day));
    if (check.getUTCDate() !== p.day) return null;
    return p;
  }

  function oneLine(text, max) {
    return String(text == null ? '' : text).replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /* Validates untrusted input. Returns a clean reminder or null. */
  function clean(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!parseAt(raw.at)) return null;
    var repeat = REPEATS.indexOf(raw.repeat) === -1 ? 'once' : raw.repeat;
    var out = {
      v: 1,
      on: raw.on !== false,
      title: oneLine(raw.title, MAX_TITLE),
      at: String(raw.at),
      tz: validTimeZone(raw.tz) ? raw.tz : DEFAULT_TZ,
      repeat: repeat
    };
    if (repeat === 'hours' || repeat === 'days') {
      var n = Math.round(Number(raw.every));
      var max = repeat === 'hours' ? 168 : 365;
      out.every = isFinite(n) && n >= 1 ? Math.min(n, max) : 1;
    }
    if (repeat === 'weekly') {
      var days = [];
      (Array.isArray(raw.days) ? raw.days : []).forEach(function (d) {
        d = Number(d);
        if (d >= 0 && d <= 6 && Math.floor(d) === d && days.indexOf(d) === -1) days.push(d);
      });
      days.sort();
      if (!days.length) { var p = parseAt(raw.at); days = [new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]; }
      out.days = days;
    }
    return out;
  }

  /* Default notification name: the note's title, else its first words. */
  function defaultTitle(entry) {
    var t = oneLine(entry && entry.title, MAX_TITLE);
    if (t) return t;
    var words = oneLine(entry && entry.body, 400).split(' ').slice(0, 8).join(' ');
    return oneLine(words, MAX_TITLE) || 'Journal reminder';
  }

  function dayNum(y, mo, d) { return Math.floor(Date.UTC(y, mo - 1, d) / DAY); }
  function fromDayNum(n) { var dt = new Date(n * DAY); return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), weekday: dt.getUTCDay() }; }
  function daysInMonth(y, mo) { return new Date(Date.UTC(y, mo, 0)).getUTCDate(); }

  function startMs(r) { var p = parseAt(r.at); return p ? zoned(p.year, p.month, p.day, p.hour, p.minute, r.tz) : null; }

  /* Every fire time t with from < t <= to (at most `limit`). */
  function between(raw, from, to, limit) {
    var r = clean(raw);
    var out = [];
    limit = limit || 500;
    if (!r || to <= from) return out;
    var p = parseAt(r.at);
    var first = startMs(r);
    if (r.repeat === 'once') {
      if (first > from && first <= to) out.push(first);
      return out;
    }
    if (r.repeat === 'hours') {
      var step = r.every * HOUR;
      var k = Math.max(0, Math.floor((from - first) / step) + 1);
      for (var t = first + k * step; t <= to && out.length < limit; t += step) if (t > from) out.push(t);
      return out;
    }
    var startDay = dayNum(p.year, p.month, p.day);
    var a = parts(Math.max(from, first - DAY), r.tz);
    var b = parts(to, r.tz);
    var d0 = Math.max(startDay, dayNum(a.year, a.month, a.day) - 1);
    var d1 = dayNum(b.year, b.month, b.day) + 1;
    for (var n = d0; n <= d1 && out.length < limit; n++) {
      var day = fromDayNum(n);
      var hit = false;
      if (r.repeat === 'daily') hit = true;
      else if (r.repeat === 'days') hit = (n - startDay) % r.every === 0;
      else if (r.repeat === 'weekly') hit = r.days.indexOf(day.weekday) !== -1;
      else if (r.repeat === 'monthly') hit = day.day === Math.min(p.day, daysInMonth(day.year, day.month));
      if (!hit) continue;
      var at = zoned(day.year, day.month, day.day, p.hour, p.minute, r.tz);
      if (at > from && at <= to && at >= first) out.push(at);
    }
    return out;
  }

  /* Next fire time after `now`, or null (a past one-time reminder, or off). */
  function next(raw, now) {
    var r = clean(raw);
    if (!r || !r.on) return null;
    var span = r.repeat === 'monthly' ? 62 * DAY : r.repeat === 'days' ? (r.every + 2) * DAY : 9 * DAY;
    if (r.repeat === 'once') span = Math.max(DAY, startMs(r) - now + DAY);
    if (r.repeat === 'hours') span = r.every * HOUR + DAY;
    var from = Math.max(now, startMs(r) - 1);
    var list = between(r, from, from + span, 1);
    return list.length ? list[0] : null;
  }

  function clock(h, m) {
    var ap = h < 12 ? 'AM' : 'PM';
    var hh = h % 12 || 12;
    return hh + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
  }

  /* Short plain words for the tag on a note, e.g. "Daily at 9:00 AM". */
  function describe(raw) {
    var r = clean(raw);
    if (!r) return '';
    var p = parseAt(r.at);
    var time = clock(p.hour, p.minute);
    switch (r.repeat) {
      case 'daily': return 'Daily at ' + time;
      case 'weekly': return (r.days.length === 7 ? 'Every day' : r.days.length === 5 && r.days.join() === '1,2,3,4,5' ? 'Weekdays' : r.days.map(function (d) { return DAY_NAMES[d]; }).join(', ')) + ' at ' + time;
      case 'monthly': return 'Monthly on day ' + p.day + ' at ' + time;
      case 'hours': return r.every === 1 ? 'Every hour' : 'Every ' + r.every + ' hours';
      case 'days': return (r.every === 1 ? 'Daily' : 'Every ' + r.every + ' days') + ' at ' + time;
      default: return 'Once, ' + p.month + '/' + p.day + '/' + p.year + ' at ' + time;
    }
  }

  /* Wall-clock "YYYY-MM-DDTHH:MM" for an instant in a zone (for the editor). */
  function localAt(ms, tz) {
    var q = parts(ms, validTimeZone(tz) ? tz : DEFAULT_TZ);
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return q.year + '-' + two(q.month) + '-' + two(q.day) + 'T' + two(q.hour) + ':' + two(q.minute);
  }

  function formatWhen(ms, tz) {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: validTimeZone(tz) ? tz : DEFAULT_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
    } catch (err) { return new Date(ms).toISOString(); }
  }

  return {
    DEFAULT_TZ: DEFAULT_TZ, REPEATS: REPEATS, MAX_TITLE: MAX_TITLE, DAY_NAMES: DAY_NAMES,
    validTimeZone: validTimeZone, clean: clean, defaultTitle: defaultTitle, parseAt: parseAt,
    between: between, next: next, describe: describe, localAt: localAt, formatWhen: formatWhen, zoned: zoned
  };
});
