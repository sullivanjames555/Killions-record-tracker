'use strict';
/* Reading a list of records from a CSV file (Excel, Google Sheets, a Discogs collection export…)
   and deciding which online match is the right one. No screen code here, so it can be tested on its own. */
(function (root) {
  // ---------- reading the file ----------
  function decode(buffer) {
    const bytes = new Uint8Array(buffer);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('windows-1252').decode(bytes); } // older Excel "CSV" files
  }

  function detectDelimiter(text) {
    const first = text.split(/\r?\n/).find(l => l.trim()) || '';
    let best = ',', bestN = -1;
    for (const d of [',', ';', '\t', '|']) {
      let n = 0, q = false;
      for (const ch of first) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
      if (n > bestN) { best = d; bestN = n; }
    }
    return best;
  }

  function parseCSV(text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    delim = delim || detectDelimiter(text);
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell.trim() === '') { q = true; cell = ''; }
      else if (ch === delim) { row.push(cell.trim()); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell.trim()); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows.filter(r => r.some(c => c !== ''));
  }

  // ---------- which column is which ----------
  const FIELDS = [
    { key: 'artist', label: 'Artist or band', names: ['artist', 'artists', 'artistname', 'band', 'performer', 'group', 'singer'] },
    { key: 'title', label: 'Album name', names: ['title', 'album', 'albumtitle', 'albumname', 'record', 'recordname', 'release', 'releasetitle', 'name', 'lp'] },
    { key: 'year', label: 'Year', names: ['year', 'released', 'releaseyear', 'releasedate', 'date', 'yr'] },
    { key: 'label', label: 'Record label', names: ['label', 'recordlabel', 'labels', 'company', 'recordcompany'] },
    { key: 'catno', label: 'Catalog number', names: ['catalog', 'catalog#', 'catalogno', 'catalognumber', 'catalogue', 'cataloguenumber', 'catno', 'cat#', 'catnumber', 'cat', 'number', 'no', 'no.', 'matrix'] },
    { key: 'barcode', label: 'Barcode', names: ['barcode', 'upc', 'ean', 'upcean'] },
    { key: 'format', label: 'Format', names: ['format', 'type', 'size', 'media', 'speed', 'rpm'] },
    { key: 'country', label: 'Country', names: ['country', 'origin'] },
    { key: 'condition', label: 'Shape of the record', names: ['condition', 'grade', 'mediacondition', 'recordcondition', 'vinylcondition', 'collectionmediacondition', 'shape'] },
    { key: 'sleeve', label: 'Picture sleeve (have it?)', names: ['picturesleeve', 'sleeve', 'cover', 'jacket', 'havesleeve', 'hassleeve', 'havecover', 'hascover', 'ps', 'sleevecondition', 'collectionsleevecondition', 'covercondition'] },
    { key: 'notes', label: 'Notes', names: ['notes', 'note', 'comments', 'comment', 'description', 'collectionnotes', 'remarks'] },
    { key: 'paid', label: 'What I paid', names: ['paid', 'pricepaid', 'cost', 'purchaseprice', 'boughtfor', 'whatipaid'] },
    { key: 'myValue', label: 'Value', names: ['value', 'worth', 'estvalue', 'estimatedvalue', 'price', 'myvalue', 'currentvalue'] },
    { key: 'discogsId', label: 'Discogs release ID', names: ['releaseid', 'release_id', 'discogsid', 'discogsreleaseid'] }
  ];
  const squash = s => String(s || '').toLowerCase().replace(/[^a-z0-9#_]/g, '');

  function detectColumns(rows) {
    const head = rows[0] || [];
    const map = {};
    let hits = 0;
    for (const f of FIELDS) map[f.key] = -1;
    head.forEach((h, i) => {
      const k = squash(h);
      if (!k) return;
      for (const f of FIELDS) {
        if (map[f.key] !== -1) continue;
        if (f.names.includes(k) || f.names.includes(k.replace(/_/g, ''))) { map[f.key] = i; hits++; return; }
      }
    });
    // Looser second pass: a heading that contains a known word ("Album Title (LP)")
    head.forEach((h, i) => {
      if (Object.values(map).includes(i)) return;
      const k = squash(h);
      for (const f of FIELDS) {
        if (map[f.key] !== -1 || k.length < 4) continue;
        if (f.names.some(n => n.length >= 4 && k.includes(n))) { map[f.key] = i; hits++; return; }
      }
    });
    if (hits === 0) {
      // No headings: assume "artist, album, year…" in that order, the most common layout.
      const guess = ['artist', 'title', 'year', 'label', 'catno'];
      guess.forEach((k, i) => { if (i < head.length) map[k] = i; });
      return { hasHeader: false, map };
    }
    return { hasHeader: true, map };
  }

  // ---------- turning a row into a record ----------
  function parseCondition(s) {
    const t = String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!t) return '';
    const code = (/\(([^)]+)\)/.exec(t) || [])[1] || t; // "Very Good Plus (VG+)" -> "vg+"
    const c = code.replace(/\s/g, '');
    if (/^(m|nm|m-|nm-|nmorm-|mint|nearmint|new|sealed|likenew|ex|ex\+|excellent)$/.test(c) || /mint|like new|excellent|sealed/.test(t)) return 'nm';
    if (/^(vg\+|vgplus|vg\+\+|e|e-)$/.test(c) || /very good plus|very good\+/.test(t)) return 'vgp';
    if (/^(vg|vg-|g\+|good\+|goodplus)$/.test(c) || /^very good$/.test(t)) return 'vg';
    if (/^(g|g-|f|fair|p|poor|worn|bad)$/.test(c) || /fair|poor|worn|damaged|scratched/.test(t)) return 'g';
    if (/good/.test(t)) return 'vg';
    return '';
  }

  // Returns true (have it), false (need one) or null (unknown).
  function parseSleeve(s) {
    const t = String(s || '').toLowerCase().trim();
    if (!t) return null;
    if (/^(no|n|false|0|none|missing|need|needs|needed|no cover|no sleeve|nocover|generic|plain|company sleeve|without)\b/.test(t) || /no cover|no sleeve|missing|generic/.test(t)) return false;
    if (/^(yes|y|true|1|x|✓|✔|have|has|ps|with|included|original)\b/.test(t)) return true;
    if (/not graded/.test(t)) return null;
    if (parseCondition(t)) return true; // a graded sleeve condition means the sleeve is there
    return null;
  }

  function yearFrom(s) { const m = /\b(18|19|20)\d{2}\b/.exec(String(s || '')); return m ? m[0] : ''; }
  function money(s) { const n = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isFinite(n) && n > 0 ? String(Math.round(n * 100) / 100) : ''; }

  function rowToRecord(row, map, opts = {}) {
    const get = k => (map[k] >= 0 && map[k] < row.length ? String(row[map[k]] || '').trim() : '');
    let artist = get('artist'), title = get('title');
    // "Artist - Album" in one column
    if (title && !artist && /\s[-–—]\s/.test(title)) { const p = title.split(/\s+[-–—]\s+/); artist = p[0]; title = p.slice(1).join(' - '); }
    // Discogs adds "(2)" to tell same-named artists apart
    artist = artist.replace(/\s\(\d+\)$/, '');
    // "Beatles, The" -> "The Beatles"
    artist = artist.replace(/^(.+),\s*the$/i, 'The $1');
    const r = {
      list: opts.list === 'wish' ? 'wish' : 'collection',
      title, artist,
      year: yearFrom(get('year')),
      label: get('label'), catno: get('catno'),
      barcode: get('barcode').replace(/[^\dXx]/g, ''),
      format: get('format'), country: get('country'),
      condition: parseCondition(get('condition')) || 'vgp',
      haveCover: parseSleeve(get('sleeve')),
      notes: get('notes'), paid: get('paid'), myValue: money(get('myValue')),
      discogsId: /^\d+$/.test(get('discogsId')) ? get('discogsId') : '',
      importStatus: 'pending'
    };
    return r;
  }

  // ---------- choosing the right online match ----------
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ').replace(/\bthe\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function similarity(a, b) {
    a = norm(a); b = norm(b);
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.85;
    const A = new Set(a.split(' ')), B = new Set(b.split(' '));
    let inter = 0;
    for (const w of A) if (B.has(w)) inter++;
    return inter / Math.max(A.size, B.size);
  }
  const catKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  function scoreMatch(rec, c) {
    const t = similarity(rec.title, c.title), a = rec.artist ? similarity(rec.artist, c.artist) : 0.5;
    let score = t * 50 + a * 30;
    if (rec.barcode && c.barcode && catKey(rec.barcode) === catKey(c.barcode)) score += 40;
    if (rec.catno && c.catno && catKey(rec.catno) === catKey(c.catno)) score += 25;
    if (rec.year && c.year && rec.year === c.year) score += 8;
    if (rec.label && c.label && similarity(rec.label, c.label) >= 0.6) score += 5;
    if (/vinyl|"/i.test(c.format || '')) score += 5;
    return { score, titleSim: t, artistSim: a };
  }

  function pickBest(rec, candidates) {
    let best = null;
    for (const c of candidates || []) {
      const s = scoreMatch(rec, c);
      const strongId = (rec.barcode && catKey(rec.barcode) === catKey(c.barcode)) ||
        (rec.catno && catKey(rec.catno) === catKey(c.catno) && (s.titleSim >= 0.3 || s.artistSim >= 0.6));
      const ok = strongId || (s.titleSim >= 0.6 && (!rec.artist || s.artistSim >= 0.5));
      if (ok && (!best || s.score > best.score)) best = { ...s, match: c };
    }
    return best;
  }

  function dupKey(r) { return [norm(r.artist), norm(r.title), catKey(r.catno)].join('|'); }

  const api = { decode, detectDelimiter, parseCSV, FIELDS, detectColumns, parseCondition, parseSleeve, yearFrom, rowToRecord, norm, similarity, scoreMatch, pickBest, dupKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CsvImport = api;
})(typeof window !== 'undefined' ? window : globalThis);
