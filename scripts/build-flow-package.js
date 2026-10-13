/**
 * Power Automate のインポート用パッケージ (.zip) を生成する
 *
 * power-automate/flow-definition.json のプレースホルダにコピー元・コピー先を埋め、
 * 「Import Package (Legacy)」で読める形式の zip を dist/ に出力する。
 *
 *   node scripts/build-flow-package.js --source "<GoogleカレンダーID>" [--target "Calendar"] [--out path.zip]
 *
 * --source は Google カレンダーの ID(設定画面の「カレンダーID」)。Outlook 側(--target)は名前で実行時に解決する。
 * 注意: テナントID・カレンダーID等の環境固有の値をテンプレートに書かないこと(公開リポのため)。
 * 値は生成した zip にだけ入る。
 */
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var TEMPLATE_PATH = path.join(__dirname, '..', 'power-automate', 'flow-definition.json');
var DEFAULT_OUT = path.join(__dirname, '..', 'dist', 'google-to-outlook-sync.zip');
var DEFAULT_TARGET = 'Calendar';

// パッケージ内でリソース同士を参照するためのダミーID。値に意味はなく、固定でよい
var FLOW_RESOURCE_ID = '00000000-0000-0000-0000-000000000001';
var CONNECTORS = [
  {
    name: 'shared_office365',
    displayName: 'Office 365 Outlook',
    apiResourceId: '00000000-0000-0000-0000-000000000002',
    connectionResourceId: '00000000-0000-0000-0000-000000000003',
  },
  {
    name: 'shared_googlecalendar',
    displayName: 'Google Calendar',
    apiResourceId: '00000000-0000-0000-0000-000000000004',
    connectionResourceId: '00000000-0000-0000-0000-000000000005',
  },
];

var CRC_TABLE = (function() {
  var table = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
})();

function crc32(buf) {
  var c = 0xffffffff;
  for (var i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @param {{name: string, data: Buffer|string}[]} entries
 * @returns {Buffer} zip ファイルの内容
 */
function buildZip(entries) {
  var DOS_DATE = 0x21; // 1980-01-01 (出力を再現可能にするため固定)
  var locals = [];
  var centrals = [];
  var offset = 0;

  entries.forEach(function(e) {
    var name = Buffer.from(e.name, 'utf8');
    var data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    var compressed = zlib.deflateRawSync(data);
    var crc = crc32(data);

    var local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    var central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42); // local header offset (30〜41 は 0 のまま)

    locals.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  });

  var centralSize = centrals.reduce(function(sum, b) { return sum + b.length; }, 0);
  var end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat(locals.concat(centrals, [end]));
}

/** 式中の文字列リテラル ('...') に埋め込むため、単一引用符を二重化する */
function escapeExpressionString(s) {
  return s.replace(/'/g, "''");
}

function replacePlaceholders(node, values) {
  if (typeof node === 'string') {
    return Object.keys(values).reduce(function(s, key) {
      return s.split(key).join(values[key]);
    }, node);
  }
  if (Array.isArray(node)) {
    return node.map(function(v) { return replacePlaceholders(v, values); });
  }
  if (node && typeof node === 'object') {
    var out = {};
    Object.keys(node).forEach(function(k) { out[k] = replacePlaceholders(node[k], values); });
    return out;
  }
  return node;
}

/** Google カレンダーIDの形(例: xxx@group.calendar.google.com / 自分のGmailアドレス)か */
function isGoogleCalendarId(id) {
  return /^[^@\s'"]+@[^@\s'"]+$/.test(id);
}

/**
 * @param {{source: string, target?: string}} options
 * @returns {{name: string, data: string}[]} zip に入れるファイル一覧
 */
function buildPackageEntries(options) {
  if (!options || !options.source) {
    throw new Error('--source <GoogleカレンダーID> を指定してください');
  }
  if (!isGoogleCalendarId(options.source)) {
    throw new Error('--source には Google カレンダーの ID を指定してください(例: xxx@group.calendar.google.com): ' + options.source);
  }
  var target = options.target || DEFAULT_TARGET;
  var template = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  var definition = replacePlaceholders(template, {
    __SOURCE_CALENDAR_ID__: options.source,
    __TARGET_CALENDAR_NAME__: escapeExpressionString(target),
  });

  var resources = {};
  resources[FLOW_RESOURCE_ID] = {
    type: 'Microsoft.Flow/flows',
    suggestedCreationType: 'New',
    creationType: 'Existing, New, Update',
    details: { displayName: definition.properties.displayName },
    configurableBy: 'User',
    hierarchy: 'Root',
    dependsOn: CONNECTORS.reduce(function(ids, c) {
      return ids.concat([c.apiResourceId, c.connectionResourceId]);
    }, []),
  };
  var apisMap = {};
  var connectionsMap = {};
  CONNECTORS.forEach(function(c) {
    resources[c.apiResourceId] = {
      id: '/providers/Microsoft.PowerApps/apis/' + c.name,
      name: c.name,
      type: 'Microsoft.PowerApps/apis',
      suggestedCreationType: 'Existing',
      details: { displayName: c.displayName },
      configurableBy: 'System',
      hierarchy: 'Child',
      dependsOn: [],
    };
    resources[c.connectionResourceId] = {
      type: 'Microsoft.PowerApps/apis/connections',
      suggestedCreationType: 'Existing',
      creationType: 'Existing',
      details: { displayName: c.displayName },
      configurableBy: 'User',
      hierarchy: 'Child',
      dependsOn: [c.apiResourceId],
    };
    apisMap[c.name] = c.apiResourceId;
    connectionsMap[c.name] = c.connectionResourceId;
  });

  var manifest = {
    schema: '1.0',
    details: {
      displayName: definition.properties.displayName,
      description: 'Copy events from a Google calendar to the Outlook default calendar',
      createdTime: '2026-01-01T00:00:00Z',
      packageTelemetryId: FLOW_RESOURCE_ID,
      creator: 'N/A',
      sourceEnvironment: '',
    },
    resources: resources,
  };

  var flowDir = 'Microsoft.Flow/flows/' + FLOW_RESOURCE_ID + '/';
  return [
    { name: flowDir + 'apisMap.json', data: JSON.stringify(apisMap) },
    { name: flowDir + 'connectionsMap.json', data: JSON.stringify(connectionsMap) },
    { name: flowDir + 'definition.json', data: JSON.stringify(definition) },
    {
      name: 'Microsoft.Flow/flows/manifest.json',
      data: JSON.stringify({ packageSchemaVersion: '1.0', flowAssets: { assetPaths: [FLOW_RESOURCE_ID] } }),
    },
    { name: 'manifest.json', data: JSON.stringify(manifest) },
  ];
}

function parseArgs(argv) {
  var options = {};
  for (var i = 0; i < argv.length; i++) {
    var m = /^--(source|target|out)$/.exec(argv[i]);
    if (!m) throw new Error('不明な引数: ' + argv[i]);
    if (argv[i + 1] == null) throw new Error(argv[i] + ' に値がありません');
    options[m[1]] = argv[++i];
  }
  return options;
}

function main() {
  var options;
  var zip;
  try {
    options = parseArgs(process.argv.slice(2));
    zip = buildZip(buildPackageEntries(options));
  } catch (e) {
    console.error(e.message);
    console.error('使い方: node scripts/build-flow-package.js --source "<GoogleカレンダーID>" [--target "Calendar"] [--out path.zip]');
    process.exit(1);
  }
  var out = options.out || DEFAULT_OUT;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zip);
  console.log('生成しました: ' + out);
}

if (require.main === module) main();

module.exports = {
  buildZip: buildZip,
  buildPackageEntries: buildPackageEntries,
  parseArgs: parseArgs,
  TEMPLATE_PATH: TEMPLATE_PATH,
};
