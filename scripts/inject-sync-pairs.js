/**
 * GitHub Actions 用: SYNC_PAIRS_JSON を Config.gs の getSyncPairsRaw に注入する
 */
var fs = require('fs');

var pairs = JSON.parse(process.env.SYNC_PAIRS_JSON);
var config = fs.readFileSync('src/Config.gs', 'utf8');
var I = '    ';
var I2 = '      ';
var I3 = '        ';

function formatOrganizerRule(r) {
  var lines = [I3 + '    {'];
  if (r && r.destCalendarId != null) lines.push(I3 + '      destCalendarId: ' + JSON.stringify(r.destCalendarId) + ',');
  if (r && r.organizerIsSelf != null) lines.push(I3 + '      organizerIsSelf: ' + r.organizerIsSelf + ',');
  if (r && r.organizerEmailContains != null) lines.push(I3 + '      organizerEmailContains: ' + JSON.stringify(r.organizerEmailContains) + ',');
  if (r && r.organizerEmailEndsWith != null) lines.push(I3 + '      organizerEmailEndsWith: ' + JSON.stringify(r.organizerEmailEndsWith) + ',');
  if (r && r.attendeeIsSelf != null) lines.push(I3 + '      attendeeIsSelf: ' + r.attendeeIsSelf + ',');
  if (r && r.attendeeEmailEquals != null) lines.push(I3 + '      attendeeEmailEquals: ' + JSON.stringify(r.attendeeEmailEquals) + ',');
  if (r && r.attendeeEmailContains != null) lines.push(I3 + '      attendeeEmailContains: ' + JSON.stringify(r.attendeeEmailContains) + ',');
  if (r && r.attendeeEmailEndsWith != null) lines.push(I3 + '      attendeeEmailEndsWith: ' + JSON.stringify(r.attendeeEmailEndsWith) + ',');
  if (r && r.summaryContains != null) lines.push(I3 + '      summaryContains: ' + JSON.stringify(r.summaryContains) + ',');
  if (r && r.titleContains != null) lines.push(I3 + '      titleContains: ' + JSON.stringify(r.titleContains) + ',');
  if (r && r.eventTitle != null) lines.push(I3 + '      eventTitle: ' + JSON.stringify(r.eventTitle) + ',');
  if (r && r.eventColor != null) lines.push(I3 + '      eventColor: ' + r.eventColor + ',');
  if (r && r.showAsBusy != null) lines.push(I3 + '      showAsBusy: ' + r.showAsBusy + ',');
  if (r && r.includeOriginalLink != null) lines.push(I3 + '      includeOriginalLink: ' + r.includeOriginalLink + ',');
  lines.push(I3 + '    }');
  return lines.join('\n');
}

function formatDest(d) {
  var lines = [I2 + '{'];
  lines.push(I3 + 'calendarId: ' + JSON.stringify(d.calendarId) + ',');
  if (d.eventTitle != null) lines.push(I3 + 'eventTitle: ' + JSON.stringify(d.eventTitle) + ',');
  if (d.eventColor != null) lines.push(I3 + 'eventColor: ' + d.eventColor + ',');
  if (d.showAsBusy != null) lines.push(I3 + 'showAsBusy: ' + d.showAsBusy + ',');
  if (d.descriptionMode != null) lines.push(I3 + 'descriptionMode: ' + JSON.stringify(d.descriptionMode) + ',');
  if (d.includeOriginalLink != null) lines.push(I3 + 'includeOriginalLink: ' + d.includeOriginalLink + ',');
  if (d.organizerDestinations != null && Array.isArray(d.organizerDestinations) && d.organizerDestinations.length > 0) {
    lines.push(I3 + 'organizerDestinations: [');
    d.organizerDestinations.forEach(function(r, ri) {
      lines.push(formatOrganizerRule(r) + (ri < d.organizerDestinations.length - 1 ? ',' : ''));
    });
    lines.push(I3 + '],');
  }
  lines.push(I2 + '}');
  return lines.join('\n');
}

var pairsCode = pairs.map(function(p) {
  var dests = p.destinations;
  if (!dests) {
    var ids = p.destCalendarIds || (p.destCalendarId ? [p.destCalendarId] : []);
    dests = ids.map(function(id) {
      var d = { calendarId: id };
      if (p.eventTitle != null) d.eventTitle = p.eventTitle;
      if (p.eventColor != null) d.eventColor = p.eventColor;
      return d;
    });
  }
  var lines = [I + '{'];
  lines.push(I + '  name: ' + JSON.stringify(p.name) + ',');
  lines.push(I + '  sourceCalendarId: ' + JSON.stringify(p.sourceCalendarId) + ',');
  if (p.eventTitle != null) lines.push(I + '  eventTitle: ' + JSON.stringify(p.eventTitle) + ',');
  if (p.eventColor != null) lines.push(I + '  eventColor: ' + p.eventColor + ',');
  lines.push(I + '  destinations: [');
  lines.push(dests.map(formatDest).join(',\n'));
  lines.push(I + '  ],');
  lines.push(I + '}');
  return lines.join('\n');
}).join(',\n');

var replacement =
  '// --- SYNC_PAIRS_START ---\n' +
  'function getSyncPairsRaw() {\n' +
  '  return [\n' +
  pairsCode + '\n' +
  '  ];\n' +
  '}\n' +
  '// --- SYNC_PAIRS_END ---';

config = config.replace(
  /\/\/ --- SYNC_PAIRS_START ---[\s\S]*?\/\/ --- SYNC_PAIRS_END ---/,
  replacement
);
fs.writeFileSync('src/Config.gs', config);
console.log('Injected ' + pairs.length + ' sync pair(s) from SYNC_PAIRS_JSON');
