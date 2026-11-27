'use strict';
// Finds records and their details on the internet.
//  - MusicBrainz: free database of releases, song lists and credits (no key needed)
//  - Cover Art Archive: free front/back cover pictures for MusicBrainz releases
//  - Discogs: record values from real sales (free personal key needed)
//  - Claude (optional): reads a photo of a cover and says which record it is
const https = require('https');
const { URL } = require('url');

const UA = 'KillionsRecordShelf/1.0.0 (personal record collection app for Windows)';
const MB = 'https://musicbrainz.org/ws/2';
const DISCOGS = 'https://api.discogs.com';

// ---------- low-level web request (Node https; follows redirects) ----------
function request(url, opts = {}, redirects = 6) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('Bad address: ' + url)); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('Unsupported address'));
    const mod = u.protocol === 'http:' ? require('http') : https;
    const req = mod.request(u, {
      method: opts.method || 'GET',
      headers: { 'User-Agent': UA, Accept: opts.binary ? '*/*' : 'application/json', ...(opts.headers || {}) },
      timeout: opts.timeout || 25000
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(request(new URL(res.headers.location, u).toString(), opts, redirects - 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf });
      });
    });
    req.on('timeout', () => req.destroy(new Error('The internet took too long to answer.')));
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function getJSON(url, opts = {}, http = request) {
  const r = await http(url, opts);
  if (r.status === 404) return null;
  if (r.status < 200 || r.status >= 300) {
    const err = new Error('Lookup failed (' + r.status + ')');
    err.status = r.status;
    try { err.detail = JSON.parse(r.body.toString('utf8')); } catch (e) { /* not json */ }
    throw err;
  }
  return JSON.parse(r.body.toString('utf8'));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Each service gets its own queue so requests are spaced out and never pile up:
// MusicBrainz asks for at most 1 request a second, Discogs for at most 60 a minute.
function pacer(gapMs) {
  let chain = Promise.resolve();
  let last = 0;
  return fn => {
    const run = chain.then(async () => {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
    }).then(fn);
    chain = run.catch(() => {});
    return run;
  };
}
const mbQueue = pacer(1100);
const discogsQueue = pacer(1050);
let PACE = true; // tests switch pacing off
function setPacing(on) { PACE = on; }

// If a service says it is busy (429/503), wait a little and try once more.
async function politeGet(queue, url, opts, http) {
  const go = () => getJSON(url, opts, http);
  try { return PACE ? await queue(go) : await go(); }
  catch (e) {
    if (e.status !== 429 && e.status !== 503) throw e;
    if (PACE) await sleep(e.status === 429 ? 15000 : 3000);
    return PACE ? queue(go) : go();
  }
}
const mbGet = (pathAndQuery, http) => politeGet(mbQueue, MB + pathAndQuery, {}, http);
const dGet = (url, opts, http) => politeGet(discogsQueue, url, opts, http);

// ---------- helpers ----------
function luceneEscape(s) { return String(s).replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1'); }
function artistName(credit) {
  if (!Array.isArray(credit)) return '';
  return credit.map(c => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim();
}
function yearOf(date) { const m = /^(\d{4})/.exec(date || ''); return m ? m[1] : ''; }
function msToTime(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
function digits(s) { return String(s || '').replace(/\D/g, ''); }

function buildQuery({ text, artist, title, barcode, catno }) {
  if (barcode && digits(barcode).length >= 8) return 'barcode:' + digits(barcode);
  if (catno) return 'catno:"' + String(catno).replace(/"/g, '') + '"';
  if (artist && title) return 'release:"' + String(title).replace(/"/g, '') + '" AND artist:"' + String(artist).replace(/"/g, '') + '"';
  if (title) return 'release:"' + String(title).replace(/"/g, '') + '"';
  const t = String(text || '').trim();
  if (!t) return '';
  return t.split(/\s+/).map(luceneEscape).join(' ');
}

function mapRelease(r) {
  const li = (r['label-info'] || [])[0] || {};
  const medium = (r.media || [])[0] || {};
  return {
    mbid: r.id,
    rgid: r['release-group'] ? r['release-group'].id : '',
    title: r.title || '',
    artist: artistName(r['artist-credit']),
    year: yearOf(r.date),
    label: li.label ? li.label.name : '',
    catno: li['catalog-number'] || '',
    barcode: r.barcode || '',
    country: r.country || '',
    format: medium.format || '',
    formats: (r.media || []).map(m => m.format).filter(Boolean),
    primaryType: (r['release-group'] && r['release-group']['primary-type']) || '',
    tracksCount: r['track-count'] || medium['track-count'] || 0,
    score: r.score || 0,
    thumb: 'https://coverartarchive.org/release/' + r.id + '/front-250'
  };
}

function isVinyl(fmt) { return /vinyl|"/i.test(fmt || '') ? 1 : 0; }

// ---------- what kind of record he collects ----------
// mb: extra MusicBrainz search words (narrows the search on the server; a fallback search
//     without them always runs too, so a slightly wrong guess can never hide results)
// fits: the final say, checked on every result
// discogs: format words Discogs uses, tried in order when looking up a value
const TYPES = {
  '7':    { label: '7-inch singles (45s)', mb: 'format:"7\\" vinyl"', discogs: ['7"', 'Vinyl'],
            fits: r => r.f.some(x => /^7"/.test(x)) || (r.f.includes('vinyl') && /single|ep/.test(r.t)) },
  '12lp': { label: '12-inch albums (LPs)', mb: 'format:"12\\" vinyl" AND primarytype:album', discogs: ['LP', 'Vinyl'],
            fits: r => (r.f.some(x => /^12"/.test(x)) || r.f.includes('vinyl')) && !/single/.test(r.t) },
  '12s':  { label: '12-inch singles', mb: 'format:"12\\" vinyl" AND (primarytype:single OR primarytype:ep)', discogs: ['12"', 'Vinyl'],
            fits: r => r.f.some(x => /^12"/.test(x)) && /single|ep/.test(r.t) },
  '10':   { label: '10-inch records', mb: '(format:"10\\" vinyl" OR format:"10\\" shellac")', discogs: ['10"', 'Vinyl'],
            fits: r => r.f.some(x => /^10"/.test(x)) },
  '78':   { label: '78s (shellac)', mb: 'format:shellac', discogs: ['Shellac', '78 RPM'],
            fits: r => r.f.some(x => /shellac/.test(x)) },
  'vinyl':{ label: 'Any vinyl record', mb: 'format:vinyl', discogs: ['Vinyl'],
            fits: r => r.f.some(x => /vinyl|shellac|flexi/.test(x)) },
  'all':  { label: 'Anything (CDs and tapes too)', mb: '', discogs: [''], fits: () => true }
};
const typeOf = t => (TYPES[t] ? t : 'vinyl');
function fitsType(rel, type) {
  return TYPES[typeOf(type)].fits({ f: (rel.formats || [rel.format]).filter(Boolean).map(x => String(x).toLowerCase()), t: String(rel.primaryType || '').toLowerCase() });
}

// ---------- search ----------
async function search(params, http = request) {
  const q = buildQuery(params);
  if (!q) return [];
  const type = typeOf(params.recordType);
  const get = async (query, limit) => {
    const d = await mbGet('/release/?fmt=json&limit=' + limit + '&query=' + encodeURIComponent(query), http);
    return (d && d.releases ? d.releases : []).map(mapRelease);
  };
  const tidy = list => list.sort((a, b) => (isVinyl(b.format) - isVinyl(a.format)) || (b.score - a.score)).slice(0, 8);
  if (type === 'all') return tidy(await get(q, 15));
  if (TYPES[type].mb) {
    try {
      const narrow = (await get('(' + q + ') AND ' + TYPES[type].mb, 25)).filter(r => fitsType(r, type));
      if (narrow.length) return tidy(narrow);
    } catch (e) { if (e.status !== 400) throw e; } // a search word MusicBrainz didn't like: use the wide search
  }
  const wide = await get(q, 50);
  const fit = wide.filter(r => fitsType(r, type));
  if (fit.length) return tidy(fit);
  // None of that kind exist online: show what there is, clearly marked.
  return tidy(wide).map(r => ({ ...r, otherType: true }));
}

// ---------- full details ----------
async function details(mbid, http = request) {
  const r = await mbGet('/release/' + encodeURIComponent(mbid) +
    '?fmt=json&inc=artist-credits+labels+recordings+release-groups+artist-rels+url-rels', http);
  if (!r) throw new Error('That record could not be found any more.');
  const base = mapRelease(r);
  const tracks = [];
  (r.media || []).forEach((m, mi) => {
    (m.tracks || []).forEach(t => {
      const num = String(t.number || t.position || '');
      const sideLetter = /^[A-Za-z]/.test(num) ? num[0].toUpperCase() : '';
      const side = sideLetter ? 'Side ' + sideLetter : ((r.media.length > 1) ? 'Record ' + (mi + 1) : '');
      tracks.push({ side, pos: num, title: t.title || (t.recording && t.recording.title) || '', length: msToTime(t.length) });
    });
  });
  const credits = [];
  for (const rel of r.relations || []) {
    if (rel['target-type'] === 'artist' && rel.artist) {
      const role = rel.type + (rel.attributes && rel.attributes.length ? ' (' + rel.attributes.join(', ') + ')' : '');
      credits.push({ role: role.charAt(0).toUpperCase() + role.slice(1), name: rel.artist.name });
    }
  }
  let discogsId = '';
  for (const rel of r.relations || []) {
    const url = rel.url && rel.url.resource;
    const m = url && /discogs\.com\/release\/(\d+)/.exec(url);
    if (m) { discogsId = m[1]; break; }
  }
  return { ...base, tracks, credits, discogsId };
}

// ---------- cover pictures ----------
async function coverUrls(mbid, rgid, http = request) {
  const out = { front: '', back: '' };
  try {
    const d = await getJSON('https://coverartarchive.org/release/' + encodeURIComponent(mbid), {}, http);
    for (const img of (d && d.images) || []) {
      const url = (img.thumbnails && (img.thumbnails['500'] || img.thumbnails.large)) || img.image;
      if (img.front && !out.front) out.front = url;
      if (img.back && !out.back) out.back = url;
    }
  } catch (e) { /* no pictures for this exact pressing */ }
  if (!out.front && rgid) out.front = 'https://coverartarchive.org/release-group/' + encodeURIComponent(rgid) + '/front-500';
  return out;
}

async function download(url, http = request) {
  const r = await http(url, { binary: true, timeout: 20000 });
  if (r.status !== 200 || !r.body || r.body.length < 500) return null;
  const type = String(r.headers['content-type'] || '');
  if (!/^image\//.test(type)) return null;
  const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg';
  return { buffer: r.body, ext };
}

// ---------- Discogs ----------
function discogsHeaders(token) { return { Authorization: 'Discogs token=' + token }; }

async function discogsFind(rec, token, http = request, recordType) {
  const tries = [];
  const formats = TYPES[typeOf(recordType)].discogs;
  const fmt = f => (f ? '&format=' + encodeURIComponent(f) : '');
  if (rec.barcode) tries.push('barcode=' + encodeURIComponent(rec.barcode));
  if (rec.catno) for (const f of formats) tries.push('catno=' + encodeURIComponent(rec.catno) + '&artist=' + encodeURIComponent(rec.artist || '') + fmt(f));
  for (const f of formats) tries.push('q=' + encodeURIComponent(((rec.artist || '') + ' ' + (rec.title || '')).trim()) + fmt(f));
  for (const t of tries) {
    const d = await dGet(DISCOGS + '/database/search?type=release&per_page=5&' + t, { headers: discogsHeaders(token) }, http);
    const hit = d && d.results && d.results[0];
    if (hit) return { id: String(hit.id), cover: hit.cover_image || '', title: hit.title || '' };
  }
  return null;
}

const GRADES = {
  nm: 'Near Mint (NM or M-)',
  vgp: 'Very Good Plus (VG+)',
  vg: 'Very Good (VG)',
  g: 'Good (G)'
};

// Works out a value in up to three ways, best first:
//  1. Discogs' suggested price for each condition (needs the account's Seller Settings filled in)
//  2. the cheapest copy of this exact pressing for sale right now
//  3. the cheapest copy of ANY pressing of the same album (Discogs "master release")
// "note" records why something is missing, so the screen can explain it.
async function prices(discogsId, token, http = request) {
  const out = { nm: null, vgp: null, vg: null, g: null, lowest: null, forSale: null, anyLowest: null, anyForSale: null,
    currency: 'USD', checkedAt: new Date().toISOString(), note: '' };
  const notes = [];
  const h = { headers: discogsHeaders(token) };
  const id = encodeURIComponent(discogsId);
  try {
    const s = await dGet(DISCOGS + '/marketplace/price_suggestions/' + id, h, http);
    let any = false;
    if (s) for (const [k, label] of Object.entries(GRADES)) {
      const v = s[label] && s[label].value;
      if (typeof v === 'number' && v > 0) { out[k] = round(v); out.currency = s[label].currency || out.currency; any = true; }
    }
    if (!any) notes.push('noSuggestions');
  } catch (e) {
    if (e.status === 401) throw e;
    notes.push([403, 422].includes(e.status) ? 'needsSeller' : 'suggestFailed');
  }
  let masterId = null;
  try {
    const rel = await dGet(DISCOGS + '/releases/' + id + '?curr_abbr=USD', h, http);
    if (rel) {
      if (typeof rel.lowest_price === 'number' && rel.lowest_price > 0) out.lowest = round(rel.lowest_price);
      if (typeof rel.num_for_sale === 'number') out.forSale = rel.num_for_sale;
      masterId = rel.master_id || null;
    }
  } catch (e) { if (e.status === 401) throw e; }
  if (out.lowest == null) {
    try {
      const st = await dGet(DISCOGS + '/marketplace/stats/' + id + '?curr_abbr=USD', h, http);
      if (st && st.lowest_price && st.lowest_price.value > 0) out.lowest = round(st.lowest_price.value);
      if (st && typeof st.num_for_sale === 'number') out.forSale = st.num_for_sale;
    } catch (e) { /* ignore */ }
  }
  if (masterId) {
    try {
      const m = await dGet(DISCOGS + '/masters/' + encodeURIComponent(masterId) + '?curr_abbr=USD', h, http);
      if (m && typeof m.lowest_price === 'number' && m.lowest_price > 0) out.anyLowest = round(m.lowest_price);
      if (m && typeof m.num_for_sale === 'number') out.anyForSale = m.num_for_sale;
    } catch (e) { /* ignore */ }
  }
  if (!out.forSale && out.lowest == null) notes.push('noneForSale');
  out.note = notes.join(',');
  return out;
}

// Settings › "Test my Discogs key": is the key accepted, and are condition prices available?
async function testDiscogs(token, http = request) {
  const me = await dGet(DISCOGS + '/oauth/identity', { headers: discogsHeaders(token) }, http);
  let conditionPrices = false, reason = '';
  try {
    const s = await dGet(DISCOGS + '/marketplace/price_suggestions/1', { headers: discogsHeaders(token) }, http);
    conditionPrices = !!(s && Object.keys(s).length);
  } catch (e) {
    if (e.status === 401) throw e;
    reason = [403, 422].includes(e.status) ? 'needsSeller' : 'unknown';
  }
  return { username: (me && me.username) || '', conditionPrices, reason };
}
function round(n) { return Math.round(n * 100) / 100; }

// ---------- Claude: read a photo of a cover ----------
const PHOTO_PROMPT = 'This is a photo of a vinyl record: the front or back of its sleeve, or its centre label. ' +
  'Work out which release it is. Reply with JSON only, no other words, in exactly this shape: ' +
  '{"artist": string|null, "title": string|null, "year": string|null, "label": string|null, ' +
  '"catalog_number": string|null, "barcode": string|null, "confidence": "high"|"medium"|"low"}. ' +
  'Use null for anything you cannot read or are unsure of. Copy catalogue numbers and barcodes exactly as printed.';

async function identifyPhoto(dataUrl, apiKey, model, http = request) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('That picture could not be read.');
  const body = JSON.stringify({
    model: model || 'claude-sonnet-5-5',
    max_tokens: 400,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
      { type: 'text', text: PHOTO_PROMPT }
    ] }]
  });
  const r = await http('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    body, timeout: 60000
  });
  const text = r.body.toString('utf8');
  if (r.status === 401) throw new Error('The Anthropic key in Settings was not accepted.');
  if (r.status < 200 || r.status >= 300) throw new Error('Photo reading failed (' + r.status + ').');
  const d = JSON.parse(text);
  const reply = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return parseIdentify(reply);
}

function parseIdentify(reply) {
  const j = /\{[\s\S]*\}/.exec(reply || '');
  if (!j) return null;
  let o;
  try { o = JSON.parse(j[0]); } catch (e) { return null; }
  const s = v => (v === null || v === undefined ? '' : String(v).trim());
  return { artist: s(o.artist), title: s(o.title), year: s(o.year), label: s(o.label), catno: s(o.catalog_number), barcode: s(o.barcode), confidence: s(o.confidence) || 'low' };
}

module.exports = { TYPES, fitsType, setPacing, request, search, details, coverUrls, download, discogsFind, prices, testDiscogs, identifyPhoto, parseIdentify, buildQuery, mapRelease, msToTime, GRADES };
