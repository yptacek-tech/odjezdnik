const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function board() {
  const nodes = {};
  function node() {
    const result = { value: '', children: [], textContent: '', className: '', style: {},
      appendChild(child) { this.children.push(child); return child; },
      setAttribute() {}, focus() {}, add(option) { this.options.push(option); if (!this.value) this.value = option.value; } };
    result.options = [];
    return result;
  }
  const requests = [];
  const prefs = new Map();
  const data = { end: '20990101', services: { daily: ['20261114'] },
    catalog: { 'Hlavní nádraží': { file: 'main.json', lines: [[0, '9'], [1, 'C'], [3, '905']] },
      'Anděl': { file: 'andel.json', lines: [[0, '9'], [0, '10'], [3, '123']] },
      'Štěpánská': { file: 'stepanska.json', lines: [[0, '22']] } },
    stations: { 'Hlavní nádraží': [[36000, 'daily', '9', 0, 'Řepy'], [36100, 'daily', 'C', 1, 'Háje']] } };
  const context = { console, Date, JSON, Object, String, Number, Math, Array, Error,
    db: data, location: { hostname: 'localhost', protocol: 'http:' }, navigator: {},
    document: { getElementById(id) { return nodes[id] ||= node(); }, createElement: node,
      createTextNode(text) { return { textContent: text }; }, body: {}, documentElement: {} },
    localStorage: { getItem(k) { return prefs.get(k) ?? null; }, setItem(k, v) { prefs.set(k, v); } },
    Option: function(text, value) { this.text = text; this.value = String(value); },
    XMLHttpRequest: function() { requests.push(this); this.open = (method, url) => { this.url = url; }; this.send = () => {}; },
    setInterval() {}, window: {} };
  let source = fs.readFileSync(require('node:path').join(__dirname, '../board.html.in'), 'utf8').split('<script>')[1].split('</script>')[0];
  source = source.replace('var db=/*TIMETABLE*/null;', '');
  vm.createContext(context);
  vm.runInContext(source, context);
  return { c: context, nodes, requests, prefs };
}

test('filters route numbers and letters before filling five departure rows', () => {
  const { c } = board();
  const source = Array.from({ length: 12 }, (_, i) => ({ at: 10000 + i * 1000, line: i < 6 ? '905' : 'C', type: i < 6 ? 3 : 1, dest: 'Háje' }));
  const rows = c.upcomingRows(source, 0, 'hlavninadrazi', 'all', { '3:905': true });
  assert.equal(rows.length, 5);
  assert.ok(rows.every(r => r.line === 'C'));
  assert.equal(rows[0].at, 16000);
  assert.equal(c.upcomingRows(source, 0, '', 'all', { '3:905': true, '1:C': true }).length, 0);
});

test('same route number in another transport type remains independent', () => {
  const { c } = board();
  const rows = c.upcomingRows([{ at: 100, type: 0, line: '9', dest: 'A' }, { at: 100, type: 3, line: '9', dest: 'B' }], 0, '', 'all', { '3:9': true });
  assert.equal(rows.length, 1); assert.equal(rows[0].type, 0);
});

test('keeps predicted duplicate and excludes arrivals at the selected terminus', () => {
  const { c } = board();
  const rows = c.upcomingRows([
    { at: 100, scheduledAt: 100, type: 1, line: 'C', dest: 'Háje' },
    { at: 120, scheduledAt: 100, predicted: true, type: 1, line: 'C', dest: 'Háje' },
    { at: 150, type: 2, line: 'S9', dest: 'Praha hl.n.' }
  ], 0, 'hlavninadrazi', 'all', {});
  assert.equal(rows.length, 1); assert.equal(rows[0].at, 120);
});

test('search handles Czech accents, uppercase and station aliases', () => {
  const { c } = board();
  assert.equal(c.stationOptions('ANDEL')[0], 'Anděl');
  assert.equal(c.stationOptions('STEPANSKA')[0], 'Štěpánská');
  assert.equal(c.stationOptions('ŠTĚPÁNSKÁ')[0], 'Štěpánská');
  assert.equal(c.stationKey('Praha hl.n.'), 'hlavninadrazi');
});

test('remembers hidden lines per stop and exposes all catalog routes', () => {
  const { c, nodes } = board();
  nodes.mode.value = 'all'; c.setAllLines(false);
  assert.equal(c.excluded['1:C'], true);
  nodes.station.value = 'Anděl'; c.change();
  assert.equal(Object.keys(c.excluded).length, 0);
  assert.ok(c.stationLines.some(r => r[1] === '123'));
  nodes.station.value = 'Hlavní nádraží'; c.change();
  assert.equal(c.excluded['1:C'], true);
  c.setAllLines(true); assert.equal(Object.keys(c.excluded).length, 0);
});

test('changing stops discards a delayed timetable response for the previous stop', () => {
  const { c, nodes, requests } = board();
  nodes.station.value = 'Anděl'; c.change();
  const old = requests.find(r => r.url === 'data/andel.json');
  nodes.station.value = 'Štěpánská'; c.change();
  old.status = 200; old.responseText = JSON.stringify({ rows: [], services: {} }); old.onload();
  assert.equal(c.db.stations['Anděl'], undefined);
  const current = requests.find(r => r.url === 'data/stepanska.json');
  current.status = 200; current.responseText = JSON.stringify({ rows: [[36000, 'daily', '22', 0, 'Hostivař']], services: { daily: ['20261114'] } }); current.onload();
  assert.equal(c.db.stations['Štěpánská'].length, 1);
  assert.equal(c.loading, false);
});
