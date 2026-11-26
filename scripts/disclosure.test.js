var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var SRC = function(name) { return path.join(ROOT, 'src', name); };

/** .gs ファイルを同じコンテキストで評価する(GAS のグローバルスコープと同じ) */
function loadGas(files, globals) {
  var context = vm.createContext(globals || {});
  files.forEach(function(file) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  });
  return context;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

var gas = loadGas([SRC('Disclosure.gs'), SRC('Events.gs')]);

function ev(title, description, location) {
  return {
    getTitle: function() { return title; },
    getDescription: function() { return description || ''; },
    getLocation: function() { return location || ''; },
  };
}

// ---------- normalizeDisclose ----------

test('normalizeDisclose treats missing or empty settings as "do not disclose"', function() {
  assert.strictEqual(gas.normalizeDisclose(undefined), null);
  assert.strictEqual(gas.normalizeDisclose(null), null);
  assert.strictEqual(gas.normalizeDisclose('always'), null);
  assert.strictEqual(gas.normalizeDisclose({}), null);
  assert.strictEqual(gas.normalizeDisclose({ markers: [] }), null);
  assert.strictEqual(gas.normalizeDisclose({ markers: ['', '  ', null, 1] }), null);
});

test('normalizeDisclose does not disclose on a misspelled key or a non-true always', function() {
  assert.strictEqual(gas.normalizeDisclose({ marker: ['#公開'] }), null);
  assert.strictEqual(gas.normalizeDisclose({ always: 'true' }), null);
  assert.strictEqual(gas.normalizeDisclose({ always: 1 }), null);
});

test('normalizeDisclose defaults to the narrowest disclosure', function() {
  var n = plain(gas.normalizeDisclose({ markers: [' #公開 '] }));
  assert.deepStrictEqual(n, {
    always: false,
    markers: ['#公開'],
    eventTitle: '',
    descriptionMode: 'none',
    location: false,
    allDay: false,
    stripMarker: true,
  });
});

test('normalizeDisclose falls back to "none" for an unknown descriptionMode', function() {
  var n = gas.normalizeDisclose({ always: true, descriptionMode: 'everything', location: 'yes' });
  assert.strictEqual(n.descriptionMode, 'none');
  assert.strictEqual(n.location, false);
});

// ---------- isDisclosedEvent ----------

test('isDisclosedEvent matches a marker in the title or the description, ignoring case', function() {
  var n = gas.normalizeDisclose({ markers: ['#公開', '#Share'] });
  assert.strictEqual(gas.isDisclosedEvent(ev('出張 #公開', ''), n), true);
  assert.strictEqual(gas.isDisclosedEvent(ev('出張', 'メモ\n#公開'), n), true);
  assert.strictEqual(gas.isDisclosedEvent(ev('出張 #share', ''), n), true);
  assert.strictEqual(gas.isDisclosedEvent(ev('出張', 'メモ'), n), false);
});

test('isDisclosedEvent discloses everything when always is true, and nothing without settings', function() {
  assert.strictEqual(gas.isDisclosedEvent(ev('何でも', ''), gas.normalizeDisclose({ always: true })), true);
  assert.strictEqual(gas.isDisclosedEvent(ev('何でも #公開', ''), null), false);
});

// ---------- stripMarkers / getCopyTitle / getCopyLocation ----------

test('stripMarkers removes every marker and tidies whitespace', function() {
  assert.strictEqual(gas.stripMarkers('出張 #公開', ['#公開']), '出張');
  assert.strictEqual(gas.stripMarkers('#公開 出張 #公開', ['#公開']), '出張');
  assert.strictEqual(gas.stripMarkers('a #X.* b', ['#X.*']), 'a b');
  assert.strictEqual(gas.stripMarkers('そのまま', []), 'そのまま');
  assert.strictEqual(gas.stripMarkers(null, ['#公開']), '');
});

test('getCopyTitle uses the fixed title when set, otherwise the original without the marker', function() {
  assert.strictEqual(gas.getCopyTitle(ev('出張 #公開'), { eventTitle: '予定あり' }), '予定あり');
  assert.strictEqual(gas.getCopyTitle(ev('出張 #公開'), { eventTitle: '', stripMarkers: ['#公開'] }), '出張');
  assert.strictEqual(gas.getCopyTitle(ev('出張 #公開'), { eventTitle: '' }), '出張 #公開');
  // 目印しかない件名は、空のタイトルにしない
  assert.strictEqual(gas.getCopyTitle(ev('#公開'), { eventTitle: '', stripMarkers: ['#公開'] }), '#公開');
});

test('getCopyLocation copies the location only for disclosed settings', function() {
  assert.strictEqual(gas.getCopyLocation(ev('a', '', '羽田空港'), { includeLocation: true }), '羽田空港');
  assert.strictEqual(gas.getCopyLocation(ev('a', '', '羽田空港'), { includeLocation: false }), '');
  assert.strictEqual(gas.getCopyLocation(ev('a', '', '羽田空港'), {}), '');
  assert.strictEqual(gas.getCopyLocation(ev('a', '', '羽田 #公開'), { includeLocation: true, stripMarkers: ['#公開'] }), '羽田');
});

// ---------- applyDisclosure / shouldCopyAllDay ----------

test('applyDisclosure leaves the pair untouched when the event is not disclosed', function() {
  var pair = { eventTitle: '予定あり', disclose: { markers: ['#公開'] } };
  var r = gas.applyDisclosure(pair, ev('普通の予定', ''));
  assert.strictEqual(r.disclosed, false);
  assert.strictEqual(r.pair, pair);
});

test('applyDisclosure overrides title, description, location and marker stripping', function() {
  var pair = {
    eventTitle: '予定あり',
    descriptionMode: 'none',
    disclose: { markers: ['#公開'], descriptionMode: 'full', location: true },
  };
  var r = gas.applyDisclosure(pair, ev('出張 #公開', ''));
  assert.strictEqual(r.disclosed, true);
  assert.strictEqual(r.pair.eventTitle, '');
  assert.strictEqual(r.pair.descriptionMode, 'full');
  assert.strictEqual(r.pair.includeLocation, true);
  assert.deepStrictEqual(plain(r.pair.stripMarkers), ['#公開']);
  assert.strictEqual(pair.eventTitle, '予定あり', 'the original pair is not mutated');
});

test('shouldCopyAllDay: disclosed events follow disclose.allDay, others follow copyAllDayEvents then the common setting', function() {
  var off = { COPY_ALL_DAY_EVENTS: false };
  var on = { COPY_ALL_DAY_EVENTS: true };
  assert.strictEqual(gas.shouldCopyAllDay({ allDayAllowed: true }, true, off), true);
  assert.strictEqual(gas.shouldCopyAllDay({ allDayAllowed: false }, true, on), false);
  assert.strictEqual(gas.shouldCopyAllDay({}, false, off), false);
  assert.strictEqual(gas.shouldCopyAllDay({}, false, on), true);
  assert.strictEqual(gas.shouldCopyAllDay({ copyAllDayEvents: true }, false, off), true);
  assert.strictEqual(gas.shouldCopyAllDay({ copyAllDayEvents: false }, false, on), false);
});

// ---------- description ----------

test('buildDisplayDescription strips markers only in full mode', function() {
  var e = ev('出張', '帰りは新幹線\n#公開');
  var cfg = { DESCRIPTION_MODE: 'full', stripMarkers: ['#公開'] };
  assert.strictEqual(gas.buildDisplayDescription(e, cfg), '帰りは新幹線');
  assert.strictEqual(gas.buildDisplayDescription(e, { DESCRIPTION_MODE: 'none', stripMarkers: ['#公開'] }), '');
});

// ---------- 同期ループ全体(偽のカレンダーで syncSinglePair を通す) ----------

var DAY = 24 * 60 * 60 * 1000;

function fakeSourceEvent(spec) {
  return {
    getId: function() { return spec.id; },
    getTitle: function() { return spec.title; },
    getDescription: function() { return spec.description || ''; },
    getLocation: function() { return spec.location || ''; },
    isAllDayEvent: function() { return !!spec.allDay; },
    getStartTime: function() { return new Date(spec.start); },
    getEndTime: function() { return new Date(spec.end); },
    getAllDayStartDate: function() { return new Date(spec.start); },
    getAllDayEndDate: function() { return new Date(spec.end); },
    getMyStatus: function() { return 'OWNER'; },
  };
}

function fakeCopy(initial) {
  var tags = initial.tags || {};
  var e = {
    deleted: false,
    title: initial.title,
    description: initial.description || '',
    location: initial.location || '',
    allDay: !!initial.allDay,
    start: initial.start,
    end: initial.end,
    getTitle: function() { return e.title; },
    setTitle: function(v) { e.title = v; },
    getDescription: function() { return e.description; },
    setDescription: function(v) { e.description = v; },
    getLocation: function() { return e.location; },
    setLocation: function(v) { e.location = v; },
    isAllDayEvent: function() { return e.allDay; },
    getAllDayStartDate: function() { return new Date(e.start); },
    setAllDayDate: function(d) { e.start = d.getTime(); },
    getStartTime: function() { return new Date(e.start); },
    getEndTime: function() { return new Date(e.end); },
    setTime: function(s, en) { e.start = s.getTime(); e.end = en.getTime(); },
    getTag: function(k) { return tags[k] === undefined ? null : tags[k]; },
    setTag: function(k, v) { tags[k] = v; },
    setColor: function() {},
    getTransparency: function() { return e.transparency; },
    setTransparency: function(v) { e.transparency = v; },
    deleteEvent: function() { e.deleted = true; },
  };
  return e;
}

function runSync(pair, sourceSpecs, existingCopies, commonOverrides) {
  var created = [];
  var sourceEvents = sourceSpecs.map(fakeSourceEvent);
  var dest = {
    getName: function() { return 'dest'; },
    getEvents: function() { return existingCopies.filter(function(c) { return !c.deleted; }); },
    createEvent: function(title, start, end) {
      var c = fakeCopy({ title: title, start: start.getTime(), end: end.getTime() });
      created.push(c);
      return c;
    },
    createAllDayEvent: function(title, start) {
      var c = fakeCopy({ title: title, start: start.getTime(), end: start.getTime() + DAY, allDay: true });
      created.push(c);
      return c;
    },
  };
  var source = { getName: function() { return 'source'; }, getEvents: function() { return sourceEvents; } };
  var calendars = { 'src@example.com': source, 'dest@example.com': dest };
  var context = loadGas(
    ['Config.gs', 'Code.gs', 'Events.gs', 'Disclosure.gs', 'OrganizerRouting.gs', 'InviteRuleMatching.gs', 'Utils.gs'].map(SRC),
    {
      Logger: { log: function() {} },
      Utilities: { base64Encode: function(s) { return Buffer.from(s).toString('base64'); } },
      CalendarApp: {
        getCalendarById: function(id) { return calendars[id] || null; },
        EventTransparency: { OPAQUE: 'OPAQUE', TRANSPARENT: 'TRANSPARENT' },
        GuestStatus: { NO: 'NO', INVITED: 'INVITED' },
      },
    }
  );
  var common = Object.assign(context.getCommonConfig(), commonOverrides || {});
  var result = plain(context.syncSinglePair(pair, common));
  return { result: result, created: created };
}

var BASE_PAIR = {
  name: 'work',
  sourceCalendarId: 'src@example.com',
  destCalendarId: 'dest@example.com',
  eventTitle: '予定あり',
  showAsBusy: true,
  descriptionMode: 'none',
  excludeTitles: undefined,
  disclose: {
    markers: ['#公開'],
    descriptionMode: 'full',
    location: true,
    allDay: true,
  },
};

var NOV27 = Date.parse('2026-11-27T09:00:00+09:00');
var HOUR_MS = 60 * 60 * 1000;

function timed(id, title, extra) {
  return Object.assign({ id: id, title: title, start: NOV27, end: NOV27 + HOUR_MS }, extra || {});
}

function allDay(id, title, extra) {
  return Object.assign({ id: id, title: title, allDay: true, start: Date.parse('2026-12-01T00:00:00+09:00'), end: Date.parse('2026-12-02T00:00:00+09:00') }, extra || {});
}

test('sync keeps ordinary events anonymous and copies the marked ones in full', function() {
  var run = runSync(BASE_PAIR, [
    timed('plain', '顧客A 商談', { description: '機密メモ', location: '本社' }),
    timed('trip', '出張 東京→大阪', { description: '新幹線 のぞみ\n#公開', location: '東京駅' }),
  ], []);

  assert.deepStrictEqual(run.result, { created: 2, updated: 0, deleted: 0, skipped: 0 });
  var plainCopy = run.created[0];
  assert.strictEqual(plainCopy.title, '予定あり');
  assert.strictEqual(plainCopy.description, '');
  assert.strictEqual(plainCopy.location, '');

  var tripCopy = run.created[1];
  assert.strictEqual(tripCopy.title, '出張 東京→大阪');
  assert.strictEqual(tripCopy.description, '新幹線 のぞみ');
  assert.strictEqual(tripCopy.location, '東京駅');
});

test('sync does not copy an all-day event unless it is marked', function() {
  var run = runSync(BASE_PAIR, [
    allDay('d1', '休暇'),
    allDay('d2', '出張 #公開', { location: '大阪' }),
  ], []);

  assert.deepStrictEqual(run.result, { created: 1, updated: 0, deleted: 0, skipped: 1 });
  assert.strictEqual(run.created[0].allDay, true);
  assert.strictEqual(run.created[0].title, '出張');
  assert.strictEqual(run.created[0].location, '大阪');
});

test('sync copies a marked all-day event only when disclose.allDay is true, and honours copyAllDayEvents', function() {
  var noAllDay = Object.assign({}, BASE_PAIR, { disclose: Object.assign({}, BASE_PAIR.disclose, { allDay: false }) });
  assert.strictEqual(runSync(noAllDay, [allDay('d2', '出張 #公開')], []).created.length, 0);
  var unset = Object.assign({}, BASE_PAIR, { disclose: { markers: ['#公開'] } });
  assert.strictEqual(runSync(unset, [allDay('d2', '出張 #公開')], []).created.length, 0);

  var anonAllDay = Object.assign({}, BASE_PAIR, { copyAllDayEvents: true });
  var run = runSync(anonAllDay, [allDay('d1', '休暇', { description: '私用' })], []);
  assert.strictEqual(run.created.length, 1);
  assert.strictEqual(run.created[0].title, '予定あり');
  assert.strictEqual(run.created[0].description, '');
});

test('removing the marker turns an already copied event back to anonymous', function() {
  var tag = { 'gcalPrivacySync.syncTag': '[CalendarSync][src@example.com]', 'gcalPrivacySync.sourceId': 'trip_' + NOV27 };
  var existing = fakeCopy({
    title: '出張 東京→大阪', description: '新幹線 のぞみ', location: '東京駅',
    start: NOV27, end: NOV27 + HOUR_MS, tags: tag,
  });
  var run = runSync(BASE_PAIR, [
    timed('trip', '出張 東京→大阪', { description: '新幹線 のぞみ', location: '東京駅' }),
  ], [existing]);

  assert.deepStrictEqual(run.result, { created: 0, updated: 1, deleted: 0, skipped: 0 });
  assert.strictEqual(existing.title, '予定あり');
  assert.strictEqual(existing.description, '');
  assert.strictEqual(existing.location, '', 'the location must not stay behind');
});

test('removing the marker from an all-day event deletes its copy', function() {
  var startMs = Date.parse('2026-12-01T00:00:00+09:00');
  var tag = { 'gcalPrivacySync.syncTag': '[CalendarSync][src@example.com]', 'gcalPrivacySync.sourceId': 'd2_' + startMs };
  var existing = fakeCopy({
    title: '出張', allDay: true, start: startMs, end: startMs + DAY, tags: tag,
  });
  var run = runSync(BASE_PAIR, [allDay('d2', '出張')], [existing]);

  assert.strictEqual(existing.deleted, true);
  assert.deepStrictEqual(run.result, { created: 0, updated: 0, deleted: 1, skipped: 1 });
});

test('an unchanged marked event is not rewritten on the next run', function() {
  var first = runSync(BASE_PAIR, [timed('trip', '出張 #公開', { description: '詳細\n#公開', location: '羽田' })], []);
  var copy = first.created[0];
  copy.setTag('gcalPrivacySync.syncTag', '[CalendarSync][src@example.com]');
  copy.setTag('gcalPrivacySync.sourceId', 'trip_' + NOV27);

  var second = runSync(BASE_PAIR, [timed('trip', '出張 #公開', { description: '詳細\n#公開', location: '羽田' })], [copy]);
  assert.deepStrictEqual(second.result, { created: 0, updated: 0, deleted: 0, skipped: 0 });
});

test('without disclose the behaviour is unchanged: everything stays anonymous', function() {
  var pair = Object.assign({}, BASE_PAIR, { disclose: undefined });
  var run = runSync(pair, [
    timed('trip', '出張 #公開', { description: '#公開', location: '東京駅' }),
    allDay('d1', '休暇'),
  ], []);
  assert.deepStrictEqual(run.result, { created: 1, updated: 0, deleted: 0, skipped: 1 });
  assert.strictEqual(run.created[0].title, '予定あり');
  assert.strictEqual(run.created[0].description, '');
  assert.strictEqual(run.created[0].location, '');
});
