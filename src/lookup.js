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

// MusicBrainz asks for no more than one request per second.
let lastMB = 0;
async function mbGet(pathAndQuery, http) {
  const wait = lastMB + 1100 - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastMB = Date.now();
  return getJSON(MB + pathAndQuery, {}, http);
}

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
    tracksCount: r['track-count'] || medium['track-count'] || 0,
    score: r.score || 0,
    thumb: 'https://coverartarchive.org/release/' + r.id + '/front-250'
  };
}

function isVinyl(fmt) { return /vinyl|"/i.test(fmt || '') ? 1 : 0; }

// ---------- search ----------
async function search(params, http = request) {
  const q = buildQuery(params);
  if (!q) return [];
  const d = await mbGet('/release/?fmt=json&limit=15&query=' + encodeURIComponent(q), http);
  const list = (d && d.releases ? d.releases : []).map(mapRelease);
  // Vinyl first, then best match. Keep it short and easy to read.
  list.sort((a, b) => (isVinyl(b.format) - isVinyl(a.format)) || (b.score - a.score));
  return list.slice(0, 8);
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
  const r = await http(url, { binary: true, timeout: 40000 });
  if (r.status !== 200 || !r.body || r.body.length < 500) return null;
  const type = String(r.headers['content-type'] || '');
  if (!/^image\//.test(type)) return null;
  const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg';
  return { buffer: r.body, ext };
}

// ---------- Discogs ----------
function discogsHeaders(token) { return { Authorization: 'Discogs token=' + token }; }

async function discogsFind(rec, token, http = request) {
  const tries = [];
  if (rec.barcode) tries.push('barcode=' + encodeURIComponent(rec.barcode));
  if (rec.catno) tries.push('catno=' + encodeURIComponent(rec.catno) + '&artist=' + encodeURIComponent(rec.artist || ''));
  tries.push('q=' + encodeURIComponent(((rec.artist || '') + ' ' + (rec.title || '')).trim()) + '&format=Vinyl');
  for (const t of tries) {
    const d = await getJSON(DISCOGS + '/database/search?type=release&per_page=5&' + t, { headers: discogsHeaders(token) }, http);
    const hit = d && d.results && d.results[0];
    if (hit) return { id: String(hit.id), cover: hit.cover_image || '' };
  }
  return null;
}

const GRADES = {
  nm: 'Near Mint (NM or M-)',
  vgp: 'Very Good Plus (VG+)',
  vg: 'Very Good (VG)',
  g: 'Good (G)'
};

async function prices(discogsId, token, http = request) {
  const out = { nm: null, vgp: null, vg: null, g: null, lowest: null, forSale: null, currency: 'USD', checkedAt: new Date().toISOString() };
  const h = { headers: discogsHeaders(token) };
  try {
    const s = await getJSON(DISCOGS + '/marketplace/price_suggestions/' + encodeURIComponent(discogsId), h, http);
    if (s) for (const [k, label] of Object.entries(GRADES)) {
      if (s[label] && typeof s[label].value === 'number') { out[k] = round(s[label].value); out.currency = s[label].currency || out.currency; }
    }
  } catch (e) { /* price suggestions need Discogs seller settings; fall back to market stats */ }
  try {
    const st = await getJSON(DISCOGS + '/marketplace/stats/' + encodeURIComponent(discogsId) + '?curr_abbr=USD', h, http);
    if (st) {
      if (st.lowest_price && typeof st.lowest_price.value === 'number') out.lowest = round(st.lowest_price.value);
      if (typeof st.num_for_sale === 'number') out.forSale = st.num_for_sale;
    }
  } catch (e) { /* ignore */ }
  return out;
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

module.exports = { request, search, details, coverUrls, download, discogsFind, prices, identifyPhoto, parseIdentify, buildQuery, mapRelease, msToTime, GRADES };
