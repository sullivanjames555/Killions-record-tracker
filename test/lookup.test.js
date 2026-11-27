'use strict';
// Offline tests for the look-up and storage code, using made-up server answers.
// Run with:  npm test
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/lookup');
const { Store } = require('../src/store');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + (e.stack || e)); process.exitCode = 1; }
}
const json = (obj, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(obj)) });
function fakeHttp(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    for (const [match, reply] of routes) if (url.includes(match)) return typeof reply === 'function' ? reply(url, opts) : reply;
    return json({ error: 'not found' }, 404);
  };
  fn.calls = calls;
  return fn;
}

const MB_SEARCH = { releases: [
  { id: 'cd-1', score: 100, title: 'Kind of Blue', 'artist-credit': [{ name: 'Miles Davis' }], date: '1997', country: 'US', 'track-count': 6,
    'label-info': [{ 'catalog-number': 'CK 64935', label: { name: 'Columbia' } }], media: [{ format: 'CD' }], 'release-group': { id: 'rg-1' } },
  { id: 'lp-1', score: 95, title: 'Kind of Blue', 'artist-credit': [{ name: 'Miles Davis' }], date: '1959-08-17', country: 'US', 'track-count': 5,
    'label-info': [{ 'catalog-number': 'CL 1355', label: { name: 'Columbia' } }], media: [{ format: '12" Vinyl' }], 'release-group': { id: 'rg-1' } }
] };

const MB_RELEASE = {
  id: 'lp-1', title: 'Kind of Blue', date: '1959-08-17', country: 'US', barcode: '',
  'artist-credit': [{ name: 'Miles Davis', joinphrase: '' }],
  'label-info': [{ 'catalog-number': 'CL 1355', label: { name: 'Columbia' } }],
  'release-group': { id: 'rg-1' },
  media: [{ format: '12" Vinyl', tracks: [
    { number: 'A1', title: 'So What', length: 562000 },
    { number: 'A2', title: 'Freddie Freeloader', length: 586000 },
    { number: 'B1', title: 'All Blues', length: 693000 }
  ] }],
  relations: [
    { 'target-type': 'artist', type: 'producer', attributes: [], artist: { name: 'Teo Macero' } },
    { 'target-type': 'artist', type: 'photography', attributes: ['cover'], artist: { name: 'Jay Maisel' } },
    { 'target-type': 'url', type: 'discogs', url: { resource: 'https://www.discogs.com/release/1234567-Miles-Davis-Kind-Of-Blue' } }
  ]
};

(async () => {
  console.log('Look-up tests');

  await t('builds the right search for each kind of input', () => {
    assert.strictEqual(L.buildQuery({ barcode: '0 74646 49352 8' }), 'barcode:074646493528');
    assert.strictEqual(L.buildQuery({ catno: 'CL 1355' }), 'catno:"CL 1355"');
    assert.strictEqual(L.buildQuery({ artist: 'Miles Davis', title: 'Kind of Blue' }), 'release:"Kind of Blue" AND artist:"Miles Davis"');
    assert.strictEqual(L.buildQuery({ text: 'AC/DC Back in Black' }), 'AC\\/DC Back in Black');
    assert.strictEqual(L.buildQuery({ text: '   ' }), '');
  });

  await t('search puts vinyl pressings first', async () => {
    const http = fakeHttp([['/release/?', json(MB_SEARCH)]]);
    const r = await L.search({ text: 'kind of blue' }, http);
    assert.strictEqual(r.length, 2);
    assert.strictEqual(r[0].mbid, 'lp-1');
    assert.strictEqual(r[0].year, '1959');
    assert.strictEqual(r[0].catno, 'CL 1355');
    assert.ok(http.calls[0].url.startsWith('https://musicbrainz.org/ws/2/release/?fmt=json'));
  });

  await t('details reads songs by side, credits and the Discogs link', async () => {
    const http = fakeHttp([['/release/lp-1', json(MB_RELEASE)]]);
    const d = await L.details('lp-1', http);
    assert.strictEqual(d.tracks.length, 3);
    assert.deepStrictEqual(d.tracks[0], { side: 'Side A', pos: 'A1', title: 'So What', length: '9:22' });
    assert.strictEqual(d.tracks[2].side, 'Side B');
    assert.deepStrictEqual(d.credits[0], { role: 'Producer', name: 'Teo Macero' });
    assert.strictEqual(d.credits[1].role, 'Photography (cover)');
    assert.strictEqual(d.discogsId, '1234567');
  });

  await t('finds front and back cover pictures', async () => {
    const http = fakeHttp([['coverartarchive.org/release/lp-1', json({ images: [
      { front: true, back: false, image: 'https://x/front.jpg', thumbnails: { 500: 'https://x/front-500.jpg' } },
      { front: false, back: true, image: 'https://x/back.jpg', thumbnails: {} }
    ] })]]);
    const c = await L.coverUrls('lp-1', 'rg-1', http);
    assert.strictEqual(c.front, 'https://x/front-500.jpg');
    assert.strictEqual(c.back, 'https://x/back.jpg');
  });

  await t('falls back to the album cover when the pressing has none', async () => {
    const http = fakeHttp([]);
    const c = await L.coverUrls('lp-9', 'rg-1', http);
    assert.strictEqual(c.front, 'https://coverartarchive.org/release-group/rg-1/front-500');
    assert.strictEqual(c.back, '');
  });

  await t('downloads only real pictures', async () => {
    const img = { status: 200, headers: { 'content-type': 'image/jpeg' }, body: Buffer.alloc(2000, 1) };
    const html = { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.alloc(2000, 1) };
    assert.strictEqual((await L.download('https://a/img', fakeHttp([['img', img]]))).ext, 'jpg');
    assert.strictEqual(await L.download('https://a/page', fakeHttp([['page', html]])), null);
  });

  await t('reads Discogs value for each condition', async () => {
    const http = fakeHttp([
      ['price_suggestions/1234567', json({ 'Near Mint (NM or M-)': { currency: 'USD', value: 61.237 }, 'Very Good Plus (VG+)': { currency: 'USD', value: 44.5 },
        'Very Good (VG)': { currency: 'USD', value: 25 }, 'Good (G)': { currency: 'USD', value: 9.99 } })],
      ['/releases/1234567', json({ lowest_price: 30, num_for_sale: 12, master_id: 77 })],
      ['/masters/77', json({ lowest_price: 8, num_for_sale: 300 })]
    ]);
    const p = await L.prices('1234567', 'TOKEN', http);
    assert.strictEqual(p.nm, 61.24); assert.strictEqual(p.vgp, 44.5); assert.strictEqual(p.g, 9.99);
    assert.strictEqual(p.lowest, 30); assert.strictEqual(p.forSale, 12);
    assert.strictEqual(p.anyLowest, 8); assert.strictEqual(p.anyForSale, 300);
    assert.strictEqual(p.note, '');
    assert.strictEqual(http.calls[0].opts.headers.Authorization, 'Discogs token=TOKEN');
  });

  await t('without Seller Settings: falls back to cheapest copy and says why', async () => {
    const http = fakeHttp([
      ['price_suggestions', json({ message: 'You must fill out your seller settings first.' }, 422)],
      ['/releases/55', json({ lowest_price: 18.5, num_for_sale: 3, master_id: 9 })],
      ['/masters/9', json({ lowest_price: 4.99, num_for_sale: 80 })]
    ]);
    const p = await L.prices('55', 'T', http);
    assert.strictEqual(p.vgp, null); assert.strictEqual(p.lowest, 18.5); assert.strictEqual(p.anyLowest, 4.99);
    assert.ok(p.note.includes('needsSeller'));
  });

  await t('nothing for sale: uses any pressing of the same album', async () => {
    const http = fakeHttp([
      ['price_suggestions', json({})],
      ['/releases/66', json({ lowest_price: null, num_for_sale: 0, master_id: 10 })],
      ['marketplace/stats/66', json({ lowest_price: null, num_for_sale: 0 })],
      ['/masters/10', json({ lowest_price: 12, num_for_sale: 41 })]
    ]);
    const p = await L.prices('66', 'T', http);
    assert.strictEqual(p.lowest, null); assert.strictEqual(p.anyLowest, 12);
    assert.ok(p.note.includes('noneForSale')); assert.ok(p.note.includes('noSuggestions'));
  });

  await t('a rejected Discogs key is reported, not hidden', async () => {
    const http = fakeHttp([['price_suggestions', json({ message: 'Invalid consumer token' }, 401)]]);
    await assert.rejects(L.prices('1', 'BAD', http), e => e.status === 401);
  });

  await t('tests the Discogs key and whether condition prices work', async () => {
    const ok = await L.testDiscogs('T', fakeHttp([['oauth/identity', json({ username: 'killion' })], ['price_suggestions/1', json({ 'Mint (M)': { value: 5 } })]]));
    assert.deepStrictEqual(ok, { username: 'killion', conditionPrices: true, reason: '' });
    const no = await L.testDiscogs('T', fakeHttp([['oauth/identity', json({ username: 'killion' })], ['price_suggestions/1', json({}, 422)]]));
    assert.deepStrictEqual(no, { username: 'killion', conditionPrices: false, reason: 'needsSeller' });
  });

  await t('finds the Discogs release by barcode', async () => {
    const http = fakeHttp([['database/search', json({ results: [{ id: 999, cover_image: 'https://i.discogs.com/a.jpg' }] })]]);
    const hit = await L.discogsFind({ barcode: '0123', artist: 'A', title: 'B' }, 'T', http);
    assert.deepStrictEqual(hit, { id: '999', cover: 'https://i.discogs.com/a.jpg', title: '' });
    assert.ok(http.calls[0].url.includes('barcode=0123'));
  });

  await t('reads Claude’s answer about a photo', async () => {
    const http = fakeHttp([['api.anthropic.com', (url, opts) => {
      const body = JSON.parse(opts.body);
      assert.strictEqual(body.messages[0].content[0].type, 'image');
      assert.strictEqual(opts.headers['x-api-key'], 'KEY');
      return json({ content: [{ type: 'text', text: '```json\n{"artist":"Miles Davis","title":"Kind of Blue","year":"1959","label":"Columbia","catalog_number":"CL 1355","barcode":null,"confidence":"high"}\n```' }] });
    }]]);
    const id = await L.identifyPhoto('data:image/jpeg;base64,AAAA', 'KEY', 'claude-sonnet-5-5', http);
    assert.deepStrictEqual(id, { artist: 'Miles Davis', title: 'Kind of Blue', year: '1959', label: 'Columbia', catno: 'CL 1355', barcode: '', confidence: 'high' });
  });

  await t('explains a rejected Anthropic key', async () => {
    const http = fakeHttp([['api.anthropic.com', json({ error: {} }, 401)]]);
    await assert.rejects(L.identifyPhoto('data:image/png;base64,AAAA', 'BAD', null, http), /not accepted/);
  });

  console.log('Storage tests');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-'));
  const fakeCrypt = { encrypt: s => Buffer.from('x' + s).toString('base64'), decrypt: b => Buffer.from(b, 'base64').toString().slice(1) };

  await t('saves, updates and reloads records', () => {
    const s = new Store(dir, fakeCrypt);
    const r = s.upsert({ title: 'Kind of Blue', artist: 'Miles Davis', haveCover: false, condition: 'vgp', prices: { vgp: 44.5, currency: 'USD' }, frontUrl: 'file://ignored', evil: '<script>' });
    assert.ok(r.id && r.addedAt);
    assert.strictEqual(r.list, 'collection');
    assert.strictEqual(r.frontUrl, undefined);
    assert.strictEqual(r.evil, undefined);
    s.upsert({ ...r, haveCover: true });
    const s2 = new Store(dir, fakeCrypt);
    assert.strictEqual(s2.all().length, 1);
    assert.strictEqual(s2.all()[0].haveCover, true);
    assert.strictEqual(s2.all()[0].prices.vgp, 44.5);
  });

  await t('keeps keys encrypted and out of backups', () => {
    const s = new Store(dir, fakeCrypt);
    s.setSettings({ discogsToken: ' abc123 ', textSize: 3 });
    assert.strictEqual(s.getSecret('discogsToken'), 'abc123');
    assert.ok(!fs.readFileSync(path.join(dir, 'records.json'), 'utf8').includes('abc123'));
    assert.strictEqual(s.publicSettings().hasDiscogs, true);
    assert.strictEqual(s.publicSettings().textSize, 3);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    const dest = s.backupTo(out);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dest, 'records.json'), 'utf8')).secrets, {});
  });

  await t('cover files: saved, protected names, removed with the record', () => {
    const s = new Store(dir, fakeCrypt);
    const name = s.writeCover(Buffer.from('img'), 'jpeg');
    assert.ok(/^[a-f0-9]{16}\.jpg$/.test(name));
    assert.strictEqual(s.coverPath('../../evil.txt'), null);
    const r = s.upsert({ title: 'X', coverFront: name });
    assert.ok(fs.existsSync(s.coverPath(name)));
    s.remove(r.id);
    assert.ok(!fs.existsSync(s.coverPath(name)));
  });

  await t('restores a backup into a fresh computer', () => {
    const s = new Store(dir, fakeCrypt);
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
    const dest = s.backupTo(out);
    const fresh = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'new-')), fakeCrypt);
    assert.strictEqual(fresh.restoreFrom(dest), s.all().length);
    assert.throws(() => fresh.restoreFrom(os.tmpdir()), /ENOENT|backup/);
  });

  await t('missing prices stay missing (no more $0)', () => {
    const { sanitizeRecord } = require('../src/store');
    const r = sanitizeRecord({ title: 'Elvis', prices: { nm: null, vgp: undefined, vg: '', g: 0, lowest: 0, forSale: 0, anyLowest: 7.5, note: 'needsSeller' } });
    assert.deepStrictEqual([r.prices.nm, r.prices.vgp, r.prices.vg, r.prices.g, r.prices.lowest, r.prices.anyLowest], [null, null, null, null, null, 7.5]);
    assert.strictEqual(r.prices.forSale, 0);
    assert.strictEqual(r.prices.note, 'needsSeller');
  });

  await t('repairs $0 values saved by version 1.0.0 when loading', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'old-'));
    fs.writeFileSync(path.join(d, 'records.json'), JSON.stringify({ version: 1, records: [{ id: 'a', title: 'Elvis', prices: { nm: 0, vgp: 0, vg: 0, g: 0, lowest: 0, forSale: 0 } }], settings: {}, secrets: {} }));
    const s = new Store(d, fakeCrypt);
    assert.strictEqual(s.all()[0].prices.vgp, null);
    assert.strictEqual(s.all()[0].prices.lowest, null);
  });

  await t('survives a damaged save file by using the spare copy', () => {
    const s = new Store(dir, fakeCrypt);
    s.upsert({ title: 'Spare test' });
    s.upsert({ title: 'Second' });
    fs.writeFileSync(path.join(dir, 'records.json'), '{ broken');
    const s2 = new Store(dir, fakeCrypt);
    assert.ok(s2.all().some(r => r.title === 'Spare test'));
  });

  console.log('\n' + passed + ' tests passed' + (process.exitCode ? ', some FAILED' : ''));
})();
