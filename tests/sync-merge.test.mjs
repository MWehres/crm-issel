// Tests für die Merge-Logik der Sync-Engine (v25).
// Extrahiert _mergeRecords/fbKey/FB_TOMB direkt aus index.html,
// damit genau der ausgelieferte Code getestet wird.
//
//   node tests/sync-merge.test.mjs

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Funktion ${name} nicht gefunden`);
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  return html.slice(start, i + 1);
}

const tombMatch = html.match(/const FB_TOMB\s*=\s*'([^']+)'/);
assert.ok(tombMatch, 'FB_TOMB nicht gefunden');

const src = `
  const FB_TOMB = '${tombMatch[1]}';
  ${extractFunction('fbKey')}
  ${extractFunction('_mergeRecords')}
  return _mergeRecords;
`;
const mergeRecords = new Function(src)();
const FB_TOMB = tombMatch[1];

const J = o => JSON.stringify(o);
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const rec = (id, name, updatedAt, extra = {}) => ({ id, name, updatedAt, ...extra });

test('Remote-Änderung überschreibt sauberen lokalen Datensatz', () => {
  const local  = [rec('a', 'Alt', 100)];
  const shadow = { a: J(local[0]) };
  const remote = { a: rec('a', 'Neu', 200) };
  const { merged, changed } = mergeRecords(local, remote, shadow);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Neu');
  assert.equal(changed, true);
});

test('Identischer Stand ändert nichts', () => {
  const r = rec('a', 'Gleich', 100);
  const { merged, changed } = mergeRecords([r], { a: JSON.parse(J(r)) }, { a: J(r) });
  assert.equal(merged.length, 1);
  assert.equal(changed, false);
});

test('Lokale ungesyncte Änderung (neuer) gewinnt gegen ältere Remote-Version', () => {
  const synced = rec('a', 'Basis', 100);
  const local  = [rec('a', 'Lokal bearbeitet', 300)];
  const shadow = { a: J(synced) };                 // lokal weicht vom Shadow ab → dirty
  const remote = { a: rec('a', 'Remote bearbeitet', 200) };
  const { merged } = mergeRecords(local, remote, shadow);
  assert.equal(merged[0].name, 'Lokal bearbeitet');
});

test('Beide geändert, Remote neuer → Remote gewinnt', () => {
  const synced = rec('a', 'Basis', 100);
  const local  = [rec('a', 'Lokal', 200)];
  const shadow = { a: J(synced) };
  const remote = { a: rec('a', 'Remote', 300) };
  const { merged } = mergeRecords(local, remote, shadow);
  assert.equal(merged[0].name, 'Remote');
});

test('Remote-Tombstone löscht sauberen lokalen Datensatz', () => {
  const r = rec('a', 'X', 100);
  const shadow = { a: J(r) };
  const remote = { a: { id: 'a', deleted: true, updatedAt: 200 } };
  const { merged, changed } = mergeRecords([r], remote, shadow);
  assert.equal(merged.length, 0);
  assert.equal(changed, true);
  assert.ok(shadow.a.startsWith(FB_TOMB));
});

test('Remote-Tombstone löscht NICHT eine neuere lokale Bearbeitung', () => {
  const synced = rec('a', 'Basis', 100);
  const local  = [rec('a', 'Nach Löschung bearbeitet', 300)];
  const shadow = { a: J(synced) };
  const remote = { a: { id: 'a', deleted: true, updatedAt: 200 } };
  const { merged } = mergeRecords(local, remote, shadow);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Nach Löschung bearbeitet');
});

test('Neuer Remote-Datensatz wird übernommen', () => {
  const { merged, changed } = mergeRecords([], { b: rec('b', 'Neu', 100) }, {});
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'b');
  assert.equal(changed, true);
});

test('Neuer lokaler Datensatz bleibt erhalten (wird später gepusht)', () => {
  const local = [rec('c', 'Nur lokal', 100)];
  const { merged, changed } = mergeRecords(local, {}, {});
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'c');
  assert.equal(changed, false);
});

test('Lokale, noch nicht gepushte Löschung bleibt bestehen', () => {
  // Datensatz war gesynct (Shadow == Remote), lokal bereits entfernt
  const synced = rec('a', 'Gelöscht', 100);
  const shadow = { a: J(synced) };
  const remote = { a: JSON.parse(J(synced)) };
  const { merged } = mergeRecords([], remote, shadow);
  assert.equal(merged.length, 0);
});

test('Remote nach lokaler Löschung bearbeitet → Datensatz wird wiederbelebt', () => {
  const shadow = { a: FB_TOMB + '150' };           // Löschung wurde mit ts=150 bestätigt
  const remote = { a: rec('a', 'Wiederbelebt', 200) };
  const { merged, changed } = mergeRecords([], remote, shadow);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Wiederbelebt');
  assert.equal(changed, true);
});

test('Alter Remote-Stand belebt bestätigte Löschung NICHT wieder', () => {
  const shadow = { a: FB_TOMB + '250' };
  const remote = { a: rec('a', 'Veraltet', 200) };
  const { merged } = mergeRecords([], remote, shadow);
  assert.equal(merged.length, 0);
});

test('IDs mit Sonderzeichen werden über fbKey abgeglichen', () => {
  const local  = [rec('a.b#c', 'Sonderzeichen', 100)];
  const shadow = { 'a_b_c': J(local[0]) };
  const remote = { 'a_b_c': rec('a.b#c', 'Remote', 200) };
  const { merged } = mergeRecords(local, remote, shadow);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Remote');
});

console.log(`\n${passed} Tests bestanden${process.exitCode ? ' (mit Fehlern!)' : ''}`);
