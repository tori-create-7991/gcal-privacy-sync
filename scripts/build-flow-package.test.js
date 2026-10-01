var test = require('node:test');
var assert = require('node:assert');
var fs = require('fs');
var os = require('os');
var path = require('path');
var zlib = require('zlib');
var childProcess = require('child_process');

var pkg = require('./build-flow-package.js');

var SCRIPT = path.join(__dirname, 'build-flow-package.js');
var FLOW_DIR = 'Microsoft.Flow/flows/00000000-0000-0000-0000-000000000001/';

/** 中央ディレクトリをたどって {name: Buffer} を返す */
function readZip(buf) {
  var end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  var count = buf.readUInt16LE(end + 10);
  var pos = buf.readUInt32LE(end + 16);
  var files = {};
  for (var i = 0; i < count; i++) {
    assert.strictEqual(buf.readUInt32LE(pos), 0x02014b50);
    var compressedSize = buf.readUInt32LE(pos + 20);
    var nameLength = buf.readUInt16LE(pos + 28);
    var localOffset = buf.readUInt32LE(pos + 42);
    var name = buf.toString('utf8', pos + 46, pos + 46 + nameLength);
    var dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    files[name] = zlib.inflateRawSync(buf.subarray(dataStart, dataStart + compressedSize));
    pos += 46 + nameLength + buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
  }
  return files;
}

function collectActions(actions, into) {
  Object.keys(actions).forEach(function(name) {
    into[name] = actions[name];
    if (actions[name].actions) collectActions(actions[name].actions, into);
  });
  return into;
}

function builtDefinition(options) {
  var entries = pkg.buildPackageEntries(options);
  var entry = entries.filter(function(e) { return e.name === FLOW_DIR + 'definition.json'; })[0];
  return JSON.parse(entry.data);
}

test('buildZip round-trips entry names and contents', function() {
  var files = readZip(pkg.buildZip([
    { name: 'a.json', data: '{"a":1}' },
    { name: 'dir/b.txt', data: Buffer.from('予定あり'.repeat(100), 'utf8') },
  ]));
  assert.deepStrictEqual(Object.keys(files), ['a.json', 'dir/b.txt']);
  assert.strictEqual(files['a.json'].toString('utf8'), '{"a":1}');
  assert.strictEqual(files['dir/b.txt'].toString('utf8'), '予定あり'.repeat(100));
});

test('buildZip output passes an external zip integrity check', { skip: !hasUnzip() }, function() {
  var file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flowpkg-')), 't.zip');
  fs.writeFileSync(file, pkg.buildZip(pkg.buildPackageEntries({ source: 'Busy Block' })));
  childProcess.execFileSync('unzip', ['-tq', file]);
});

function hasUnzip() {
  return childProcess.spawnSync('unzip', ['-v']).status === 0;
}

test('template keeps both calendar name placeholders', function() {
  var raw = fs.readFileSync(pkg.TEMPLATE_PATH, 'utf8');
  assert.ok(raw.includes('__SOURCE_CALENDAR_NAME__'));
  assert.ok(raw.includes('__TARGET_CALENDAR_NAME__'));
});

test('every runAfter points to an action at the same level', function() {
  var template = JSON.parse(fs.readFileSync(pkg.TEMPLATE_PATH, 'utf8'));
  (function check(actions) {
    Object.keys(actions).forEach(function(name) {
      Object.keys(actions[name].runAfter).forEach(function(dep) {
        assert.ok(actions[dep], name + ' runs after unknown action ' + dep);
      });
      if (actions[name].actions) check(actions[name].actions);
    });
  })(template.properties.definition.actions);
});

test('expressions only reference actions that exist', function() {
  var template = JSON.parse(fs.readFileSync(pkg.TEMPLATE_PATH, 'utf8'));
  var all = collectActions(template.properties.definition.actions, {});
  var refs = JSON.stringify(template).match(/(?:body|outputs|items)\('([^']+)'\)/g) || [];
  assert.ok(refs.length > 0);
  refs.forEach(function(ref) {
    var name = /\('([^']+)'\)/.exec(ref)[1];
    assert.ok(all[name], 'expression references unknown action ' + name);
  });
});

test('deletion only targets events tagged with the managed category', function() {
  var actions = builtDefinition({ source: 'Busy Block' }).properties.definition.actions;
  assert.match(actions.Managed_events.inputs.where, /categories.*'GcalSync'/);
  assert.strictEqual(actions.To_delete.inputs.from, "@body('Managed_events')");
  assert.strictEqual(actions.Delete_stale.foreach, "@body('To_delete')");
  assert.deepStrictEqual(
    actions.Create_new.actions.Create_event.inputs.parameters['item/categories'],
    ['GcalSync']
  );
});

test('package contains the five files of a legacy flow package', function() {
  var names = pkg.buildPackageEntries({ source: 'Busy Block' }).map(function(e) { return e.name; });
  assert.deepStrictEqual(names, [
    FLOW_DIR + 'apisMap.json',
    FLOW_DIR + 'connectionsMap.json',
    FLOW_DIR + 'definition.json',
    'Microsoft.Flow/flows/manifest.json',
    'manifest.json',
  ]);
});

test('manifest resources match the keys used by the flow maps', function() {
  var entries = {};
  pkg.buildPackageEntries({ source: 'Busy Block' }).forEach(function(e) { entries[e.name] = JSON.parse(e.data); });
  var resources = entries['manifest.json'].resources;
  assert.ok(resources[entries[FLOW_DIR + 'apisMap.json'].shared_office365]);
  assert.ok(resources[entries[FLOW_DIR + 'connectionsMap.json'].shared_office365]);
  var flowKey = entries['Microsoft.Flow/flows/manifest.json'].flowAssets.assetPaths[0];
  assert.strictEqual(resources[flowKey].suggestedCreationType, 'New');
});

test('calendar names are embedded and no placeholder remains', function() {
  var definition = builtDefinition({ source: 'Busy Block', target: '予定表' });
  var actions = definition.properties.definition.actions;
  assert.strictEqual(actions.Source_calendar.inputs.where, "@equals(item()?['name'], 'Busy Block')");
  assert.strictEqual(actions.Target_calendar.inputs.where, "@equals(item()?['name'], '予定表')");
  assert.ok(!/__[A-Z_]+__/.test(JSON.stringify(definition)));
});

test('target calendar name defaults to Calendar', function() {
  var actions = builtDefinition({ source: 'Busy Block' }).properties.definition.actions;
  assert.strictEqual(actions.Target_calendar.inputs.where, "@equals(item()?['name'], 'Calendar')");
});

test('quotes in calendar names are escaped for expressions and JSON', function() {
  var entries = pkg.buildPackageEntries({ source: 'Ryo\'s "Busy"' });
  var entry = entries.filter(function(e) { return e.name === FLOW_DIR + 'definition.json'; })[0];
  var where = JSON.parse(entry.data).properties.definition.actions.Source_calendar.inputs.where;
  assert.strictEqual(where, '@equals(item()?[\'name\'], \'Ryo\'\'s "Busy"\')');
});

test('missing source name is rejected', function() {
  assert.throws(function() { pkg.buildPackageEntries({}); }, /--source/);
});

test('parseArgs rejects unknown flags and missing values', function() {
  assert.deepStrictEqual(pkg.parseArgs(['--source', 'A', '--target', 'B']), { source: 'A', target: 'B' });
  assert.throws(function() { pkg.parseArgs(['--nope', 'x']); }, /不明な引数/);
  assert.throws(function() { pkg.parseArgs(['--source']); }, /値がありません/);
});

test('CLI exits non-zero without --source and writes a zip with it', function() {
  var failed = childProcess.spawnSync(process.execPath, [SCRIPT]);
  assert.strictEqual(failed.status, 1);

  var out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'flowpkg-')), 'nested', 'flow.zip');
  var ok = childProcess.spawnSync(process.execPath, [SCRIPT, '--source', 'Busy Block', '--out', out]);
  assert.strictEqual(ok.status, 0, String(ok.stderr));
  assert.strictEqual(Object.keys(readZip(fs.readFileSync(out))).length, 5);
});

test('package carries no environment-specific identifiers', function() {
  var text = pkg.buildPackageEntries({ source: 'Busy Block' })
    .map(function(e) { return e.data; })
    .join('\n');
  // パッケージ内の相互参照用に固定しているダミーキーだけを許可する
  var allowed = [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
  ];
  var guids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) || [];
  guids.forEach(function(g) {
    assert.ok(allowed.indexOf(g.toLowerCase()) !== -1, 'unexpected GUID ' + g);
  });
  assert.ok(!/tenantId|"creator":\s*\{/.test(text), 'tenant or creator metadata present');
  assert.ok(!/AAMk[A-Za-z0-9_-]{20,}/.test(text), 'Exchange item/calendar id present');
  assert.ok(!/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text), 'email address present');
});
