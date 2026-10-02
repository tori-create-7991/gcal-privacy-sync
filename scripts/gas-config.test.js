var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var vm = require('vm');
var childProcess = require('child_process');

var ROOT = path.join(__dirname, '..');
var INJECT_SCRIPT = path.join(__dirname, 'inject-sync-pairs.js');

/** .gs ファイルを評価し、トップレベルの関数を持つコンテキストを返す */
function loadGas(files) {
  var context = vm.createContext({});
  files.forEach(function(file) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  });
  return context;
}

/** vm 内で作られた値を、このレルムの値として比較できるようにする */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/** 一時ディレクトリで inject-sync-pairs.js を実行し、生成された Config.gs のパスを返す */
function inject(pairs) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inject-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.copyFileSync(path.join(ROOT, 'src', 'Config.gs'), path.join(dir, 'src', 'Config.gs'));
  var run = childProcess.spawnSync(process.execPath, [INJECT_SCRIPT], {
    cwd: dir,
    env: Object.assign({}, process.env, { SYNC_PAIRS_JSON: JSON.stringify(pairs) }),
  });
  assert.strictEqual(run.status, 0, String(run.stderr));
  return path.join(dir, 'src', 'Config.gs');
}

var utils = loadGas([path.join(ROOT, 'src', 'Utils.gs')]);

test('isExcludedTitle matches whole titles only', function() {
  assert.strictEqual(utils.isExcludedTitle('予定あり', ['予定あり']), true);
  assert.strictEqual(utils.isExcludedTitle('午後予定ありのため不在', ['予定あり']), false);
  assert.strictEqual(utils.isExcludedTitle('定例', ['予定あり', '定例']), true);
});

test('isExcludedTitle ignores surrounding whitespace', function() {
  assert.strictEqual(utils.isExcludedTitle('  予定あり ', ['予定あり']), true);
  assert.strictEqual(utils.isExcludedTitle('予定あり', [' 予定あり ']), true);
});

test('isExcludedTitle excludes nothing when the list is missing or empty', function() {
  assert.strictEqual(utils.isExcludedTitle('予定あり', undefined), false);
  assert.strictEqual(utils.isExcludedTitle('予定あり', []), false);
  assert.strictEqual(utils.isExcludedTitle('予定あり', '予定あり'), false);
  assert.strictEqual(utils.isExcludedTitle(null, ['予定あり']), false);
});

test('isOrphanedSyncTag flags only copies from sources no longer configured for the destination', function() {
  var allowed = { '[CalendarSync][kept@example.com]': true };
  assert.strictEqual(utils.isOrphanedSyncTag('[CalendarSync][kept@example.com]', allowed, '[CalendarSync]'), false);
  assert.strictEqual(utils.isOrphanedSyncTag('[CalendarSync][removed@example.com]', allowed, '[CalendarSync]'), true);
});

test('isOrphanedSyncTag never flags events this script did not create', function() {
  var allowed = { '[CalendarSync][kept@example.com]': true };
  assert.strictEqual(utils.isOrphanedSyncTag(null, allowed, '[CalendarSync]'), false);
  assert.strictEqual(utils.isOrphanedSyncTag(undefined, allowed, '[CalendarSync]'), false);
  assert.strictEqual(utils.isOrphanedSyncTag('', allowed, '[CalendarSync]'), false);
  assert.strictEqual(utils.isOrphanedSyncTag('[OtherTool][x]', allowed, '[CalendarSync]'), false);
});

test('getSyncPairs carries excludeTitles to every expanded destination', function() {
  var configPath = inject([
    {
      name: 'outlook',
      sourceCalendarId: 'outlook@import.calendar.google.com',
      eventTitle: '',
      excludeTitles: ['予定あり', "it's \"busy\""],
      destinations: [{ calendarId: 'a@group.calendar.google.com' }, { calendarId: 'b@group.calendar.google.com' }],
    },
    {
      name: 'plain',
      sourceCalendarId: 'plain@example.com',
      destinations: [{ calendarId: 'a@group.calendar.google.com' }],
    },
  ]);
  var pairs = plain(loadGas([configPath]).getSyncPairs());

  assert.strictEqual(pairs.length, 3);
  assert.deepStrictEqual(pairs[0].excludeTitles, ['予定あり', "it's \"busy\""]);
  assert.deepStrictEqual(pairs[1].excludeTitles, ['予定あり', "it's \"busy\""]);
  assert.strictEqual(pairs[2].excludeTitles, undefined);
});

test('injection omits excludeTitles when it is not set', function() {
  var configPath = inject([
    { name: 'plain', sourceCalendarId: 'plain@example.com', destinations: [{ calendarId: 'primary' }] },
    { name: 'empty', sourceCalendarId: 'empty@example.com', excludeTitles: [], destinations: [{ calendarId: 'primary' }] },
  ]);
  var raw = fs.readFileSync(configPath, 'utf8').match(/SYNC_PAIRS_START[\s\S]*SYNC_PAIRS_END/)[0];
  assert.ok(!raw.includes('excludeTitles'));
});

test('injection keeps existing destination fields', function() {
  var configPath = inject([
    {
      name: 'full',
      sourceCalendarId: 'src@example.com',
      eventTitle: '',
      eventColor: 11,
      excludeTitles: ['予定あり'],
      destinations: [
        { calendarId: 'a@group.calendar.google.com', descriptionMode: 'full' },
        { calendarId: 'b@group.calendar.google.com', eventTitle: '予定あり', showAsBusy: true },
      ],
    },
  ]);
  var pairs = plain(loadGas([configPath]).getSyncPairs());
  assert.strictEqual(pairs[0].descriptionMode, 'full');
  assert.strictEqual(pairs[0].eventTitle, '');
  assert.strictEqual(pairs[1].eventTitle, '予定あり');
  assert.strictEqual(pairs[1].showAsBusy, true);
  assert.strictEqual(pairs[1].eventColor, 11);
});

test('default config in the repo still expands without excludeTitles', function() {
  var pairs = plain(loadGas([path.join(ROOT, 'src', 'Config.gs')]).getSyncPairs());
  assert.ok(pairs.length > 0);
  pairs.forEach(function(pair) {
    assert.strictEqual(pair.excludeTitles, undefined);
  });
});
