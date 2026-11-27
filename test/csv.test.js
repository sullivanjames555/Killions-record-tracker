'use strict';
// Tests for reading CSV lists and choosing the right online match.
const assert = require('assert');
const C = require('../renderer/csvimport');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e.stack || e)); process.exitCode = 1; }
}
console.log('CSV import tests');

t('reads quotes, commas inside quotes, blank lines and Windows line endings', () => {
  const rows = C.parseCSV('﻿Artist,Album,Notes\r\n"Presley, Elvis",Elvis,"He said ""wow"""\r\n\r\nFoo Fighters,Foo Fighters,\r\n');
  assert.deepStrictEqual(rows, [['Artist', 'Album', 'Notes'], ['Presley, Elvis', 'Elvis', 'He said "wow"'], ['Foo Fighters', 'Foo Fighters', '']]);
});

t('handles semicolon and tab separated files', () => {
  assert.strictEqual(C.detectDelimiter('Artist;Album;Year\nA;B;1970'), ';');
  assert.deepStrictEqual(C.parseCSV('Artist\tAlbum\nA\tB'), [['Artist', 'Album'], ['A', 'B']]);
});

t('decodes old Excel (Windows-1252) files', () => {
  const buf = Uint8Array.from([0x42, 0x65, 0x79, 0x6f, 0x6e, 0x63, 0xe9]); // "Beyoncé" in Windows-1252
  assert.strictEqual(C.decode(buf.buffer), 'Beyoncé');
});

t('recognises everyday column names', () => {
  const { hasHeader, map } = C.detectColumns([['Band', 'Album Title', 'Yr', 'Record Label', 'Cat #', 'Shape', 'Picture Sleeve?', 'Comments', 'Price Paid']]);
  assert.strictEqual(hasHeader, true);
  assert.deepStrictEqual([map.artist, map.title, map.year, map.label, map.catno, map.condition, map.sleeve, map.notes, map.paid], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

t('recognises a Discogs collection export', () => {
  const head = ['Catalog#', 'Artist', 'Title', 'Label', 'Format', 'Rating', 'Released', 'release_id', 'CollectionFolder', 'Date Added', 'Collection Media Condition', 'Collection Sleeve Condition', 'Collection Notes'];
  const { map } = C.detectColumns([head]);
  assert.deepStrictEqual([map.catno, map.artist, map.title, map.label, map.format, map.year, map.discogsId, map.condition, map.sleeve, map.notes], [0, 1, 2, 3, 4, 6, 7, 10, 11, 12]);
  const r = C.rowToRecord(['LSP-1382', 'Elvis Presley (2)', 'Elvis', 'RCA Victor', 'LP, Album, Mono', '', '1956', '1234567', 'Uncategorized', '', 'Very Good Plus (VG+)', 'Generic', 'From Dad'], map);
  assert.strictEqual(r.artist, 'Elvis Presley');
  assert.strictEqual(r.discogsId, '1234567');
  assert.strictEqual(r.condition, 'vgp');
  assert.strictEqual(r.haveCover, false);
  assert.strictEqual(r.year, '1956');
});

t('works with a list that has no headings', () => {
  const { hasHeader, map } = C.detectColumns([['Elvis Presley', 'Elvis', '1956']]);
  assert.strictEqual(hasHeader, false);
  assert.deepStrictEqual([map.artist, map.title, map.year], [0, 1, 2]);
});

t('turns "Beatles, The" into "The Beatles"', () => {
  assert.strictEqual(C.rowToRecord(['Beatles, The', 'Abbey Road'], { artist: 0, title: 1 }).artist, 'The Beatles');
});

t('splits "Artist - Album" written in one column', () => {
  const r = C.rowToRecord(['Elvis Presley - Elvis'], { title: 0, artist: -1 });
  assert.strictEqual(r.artist, 'Elvis Presley'); assert.strictEqual(r.title, 'Elvis');
});

t('understands conditions and picture sleeve answers', () => {
  assert.deepStrictEqual(['Mint', 'NM', 'VG+', 'Very Good', 'G+', 'fair', 'worn', '', 'Like new'].map(C.parseCondition), ['nm', 'nm', 'vgp', 'vg', 'vg', 'g', 'g', '', 'nm']);
  assert.deepStrictEqual(['Yes', 'y', 'X', 'No', 'missing', 'No Cover', 'Generic', 'Very Good (VG)', 'Not Graded', ''].map(C.parseSleeve), [true, true, true, false, false, false, false, true, null, null]);
});

t('keeps values and prices tidy', () => {
  const r = C.rowToRecord(['A', 'B', '$1,250.00', '$4'], { artist: 0, title: 1, myValue: 2, paid: 3 });
  assert.strictEqual(r.myValue, '1250'); assert.strictEqual(r.paid, '$4');
});

const cands = [
  { mbid: 'cd', title: 'Elvis', artist: 'Elvis Presley', year: '1997', catno: '07863 67736-2', format: 'CD', barcode: '078636773624' },
  { mbid: 'lp', title: 'Elvis', artist: 'Elvis Presley', year: '1956', catno: 'LPM-1382', format: '12" Vinyl', barcode: '' },
  { mbid: 'other', title: 'Elvis Is Back!', artist: 'Elvis Presley', year: '1960', catno: 'LSP-2231', format: '12" Vinyl' }
];
t('picks the vinyl pressing whose year matches', () => {
  assert.strictEqual(C.pickBest({ artist: 'Elvis Presley', title: 'Elvis', year: '1956' }, cands).match.mbid, 'lp');
});
t('a matching catalog number wins', () => {
  assert.strictEqual(C.pickBest({ artist: 'Elvis', title: 'Elvis', catno: 'LSP 2231' }, cands).match.mbid, 'other');
});
t('says "no match" instead of guessing wrong', () => {
  assert.strictEqual(C.pickBest({ artist: 'Johnny Cash', title: 'At Folsom Prison' }, cands), null);
});
t('spots duplicates whatever the spelling', () => {
  assert.strictEqual(C.dupKey({ artist: 'The Beatles', title: 'Abbey Road' }), C.dupKey({ artist: 'Beatles', title: 'ABBEY ROAD' }));
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ', some FAILED' : ''));
