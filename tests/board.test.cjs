const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function board(now) {
  const nodes = {};
  function node() {
    const result = { value: '', children: [], attributes: {}, className: '', style: {},
      appendChild(child) { this.children.push(child); return child; },
      setAttribute(name, value) { this.attributes[name] = value; }, focus() {}, add(option) { this.options.push(option); if (!this.value) this.value = option.value; } };
    let text = '';
    Object.defineProperty(result, 'textContent', { get() { return text; }, set(value) { text = value; this.children = []; } });
    result.options = [];
    return result;
  }
  const intervals = [];
  const requests = [];
  class BoardDate extends Date { static now() { return now === undefined ? Date.now() : now; } }
  const prefs = new Map();
  const data = { end: '20990101', services: { daily: ['20261114'] },
    catalog: { 'Hlavní nádraží': { file: 'main.json', lines: [[0, '9'], [1, 'C'], [3, '905']] },
      'Anděl': { file: 'andel.json', lines: [[0, '9'], [0, '10'], [3, '123']] },
      'Štěpánská': { file: 'stepanska.json', lines: [[0, '22']] } },
    stations: { 'Hlavní nádraží': [[36000, 'daily', '9', 0, 'Řepy'], [36100, 'daily', 'C', 1, 'Háje']] } };
  const context = { console, Date: BoardDate, JSON, Object, String, Number, Math, Array, Error,
    db: data, location: { hostname: 'localhost', protocol: 'http:' }, navigator: {},
    document: { getElementById(id) { return nodes[id] ||= node(); }, createElement: node,
      createTextNode(text) { return { textContent: text }; }, body: {}, documentElement: {} },
    localStorage: { getItem(k) { return prefs.get(k) ?? null; }, setItem(k, v) { prefs.set(k, v); } },
    Option: function(text, value) { this.text = text; this.value = String(value); },
    XMLHttpRequest: function() { requests.push(this); this.open = (method, url) => { this.url = url; }; this.send = () => {}; },
    setInterval(callback, milliseconds) { intervals.push({ callback, milliseconds }); }, window: {} };
  let source = fs.readFileSync(require('node:path').join(__dirname, '../board.html.in'), 'utf8').split('<script>')[1].split('</script>')[0];
  source = source.replace('var db=/*TIMETABLE*/null;', '');
  vm.createContext(context);
  vm.runInContext(source, context);
  return { c: context, nodes, requests, prefs, intervals };
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

test('dropdown starts at Hlavní nádraží and offers every catalog stop', () => {
  const { c, nodes } = board();
  assert.equal(nodes.station.value, 'Hlavní nádraží');
  assert.deepEqual(nodes.station.options.map(option => option.value), ['Anděl', 'Hlavní nádraží', 'Štěpánská']);
  nodes.station.value = 'Anděl'; nodes.station.onchange();
  assert.ok(c.stationLines.some(r => r[1] === '123'));
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

test('countdown updates each second and applies exact walking/running thresholds', () => {
  const now = Date.UTC(2026, 10, 14, 12, 0, 7);
  const { c, nodes, intervals } = board(now);
  assert.equal(c.countdown(c.remainingSeconds(now + 299999, now)), '4:59');
  assert.equal(c.countdownTone(299), 'too-late');
  assert.equal(c.countdownTone(300), 'run-only');
  assert.equal(c.countdownTone(539), 'run-only');
  assert.equal(c.countdownTone(540), '');
  assert.equal(c.countdown(0), '0:00');
  assert.equal(c.remainingSeconds(now - 1, now), 0);
  assert.equal(c.countdown(3601), '60:01');
  assert.equal(nodes.clock.textContent, '13:00:07');
  assert.equal(c.clock(now), '13:00');
  assert.ok(intervals.some(interval => interval.callback === c.render && interval.milliseconds === 1000));
});

test('renders seconds and urgency colors without transport notes, retaining minute-only scheduled times', () => {
  const now = Date.UTC(2026, 10, 14, 12, 0, 7);
  const { c, nodes } = board(now);
  c.live = [
    { at: now + 299000, scheduledAt: now + 120000, predicted: true, type: 1, line: 'C', dest: 'Háje' },
    { at: now + 360000, type: 0, line: '9', dest: 'Řepy' },
    { at: now + 600000, type: 3, line: '905', dest: 'Letňany' }
  ];
  c.updated = now; c.failed = false; c.render();
  const rows = nodes.rows.children;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].children[1].children.length, 1);
  assert.equal(rows[0].children[1].children[0].textContent, 'Háje');
  assert.equal(rows[0].children[2].children[0].textContent, '4:59');
  assert.equal(rows[0].children[2].children[0].className, 'eta too-late');
  assert.equal(rows[1].children[2].children[0].className, 'eta run-only');
  assert.equal(rows[2].children[2].children[0].className.trim(), 'eta');
  assert.equal(rows[0].children[2].children[1].textContent, '13:02');
  assert.match(rows[0].children[2].children[1].attributes['aria-label'], /^Scheduled departure /);
});

test('recovers a missing stop file after deployment using a fresh catalog', () => {
  const { c, nodes, requests } = board();
  nodes.station.value = 'Anděl'; c.change();
  const old = requests.find(r => r.url === 'data/andel.json');
  old.status = 404; old.onload();
  const catalogRequest = requests.find(r => r.url.startsWith('data/catalog.json?t='));
  assert.ok(catalogRequest);
  catalogRequest.status = 200;
  catalogRequest.responseText = JSON.stringify({ 'Anděl': { file: 'new-andel.json', lines: [[0, '9'], [0, '22']] } });
  catalogRequest.onload();
  const recovered = requests.find(r => r.url.startsWith('data/new-andel.json?t='));
  assert.ok(recovered);
  recovered.status = 200;
  recovered.responseText = JSON.stringify({ rows: [[36000, 'daily', '22', 0, 'Hostivař']], services: { daily: ['20261114'] }, end: '20990102' });
  recovered.onload();
  assert.equal(c.timetableError, false);
  assert.equal(c.loading, false);
  assert.equal(c.db.stations['Anděl'][0][2], '22');
  assert.equal(c.db.end, '20990102');
  assert.ok(c.stationLines.some(r => r[1] === '22'));
});

test('ignores stale catalog recovery when the selected stop changes', () => {
  const { c, nodes, requests } = board();
  nodes.station.value = 'Anděl'; c.change();
  const old = requests.find(r => r.url === 'data/andel.json');
  old.status = 404; old.onload();
  const catalogRequest = requests.find(r => r.url.startsWith('data/catalog.json?t='));
  nodes.station.value = 'Štěpánská'; c.change();
  catalogRequest.status = 200;
  catalogRequest.responseText = JSON.stringify({ 'Anděl': { file: 'obsolete.json', lines: [] } });
  catalogRequest.onload();
  assert.ok(!requests.some(r => r.url.includes('obsolete.json')));
  assert.equal(c.loading, true);
});

test('stops automatic retries and offers a real Retry button on persistent failure', () => {
  const { c, nodes, requests } = board();
  nodes.station.value = 'Anděl'; c.change();
  requests.find(r => r.url === 'data/andel.json').onerror();
  const catalogRequest = requests.find(r => r.url.startsWith('data/catalog.json?t='));
  catalogRequest.status = 200;
  catalogRequest.responseText = JSON.stringify({ 'Anděl': { file: 'andel.json', lines: [] } });
  catalogRequest.onload();
  requests.find(r => r.url.startsWith('data/andel.json?t=')).ontimeout();
  assert.equal(c.loading, false); assert.equal(c.timetableError, true);
  const retry = nodes.rows.children.find(n => n.textContent === 'Retry');
  assert.ok(retry);
  const before = requests.length; retry.onclick();
  assert.equal(c.loading, true); assert.equal(requests.length, before + 1);
});

test('treats an empty timetable as loaded rather than a network failure', () => {
  const { c, nodes, requests } = board();
  nodes.station.value = 'Anděl'; c.change();
  const req = requests.find(r => r.url === 'data/andel.json');
  req.status = 200; req.responseText = JSON.stringify({ rows: [], services: {} }); req.onload();
  assert.equal(c.loading, false); assert.equal(c.timetableError, false);
  assert.ok(Array.isArray(c.db.stations['Anděl']));
});

test('catalog failure ends loading and malformed stop JSON triggers recovery', () => {
  const { c, nodes, requests } = board();
  nodes.station.value = 'Anděl'; c.change();
  const req = requests.find(r => r.url === 'data/andel.json');
  req.status = 200; req.responseText = '<html>Cached error</html>'; req.onload();
  requests.find(r => r.url.startsWith('data/catalog.json?t=')).onerror();
  assert.equal(c.loading, false); assert.equal(c.timetableError, true);
});
