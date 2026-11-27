'use strict';
// Keeps the collection in one JSON file plus a folder of cover pictures.
// Everything lives in the user's own AppData folder, so it works offline.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EMPTY = { version: 1, records: [], settings: { textSize: 2, claudeModel: 'claude-sonnet-5-5' }, secrets: {} };

class Store {
  constructor(dataDir, crypt) {
    this.dataDir = dataDir;
    this.coversDir = path.join(dataDir, 'covers');
    this.file = path.join(dataDir, 'records.json');
    this.crypt = crypt || null; // { encrypt(str)->base64, decrypt(base64)->str } or null
    fs.mkdirSync(this.coversDir, { recursive: true });
    this.data = this._read();
  }

  _read() {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        const d = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (d && Array.isArray(d.records)) {
          // Re-clean every record on load (also repairs values saved as $0 by version 1.0.0).
          return { ...EMPTY, ...d, records: d.records.map(sanitizeRecord), settings: { ...EMPTY.settings, ...(d.settings || {}) }, secrets: d.secrets || {} };
        }
      } catch (e) { /* try the backup copy next */ }
    }
    return JSON.parse(JSON.stringify(EMPTY));
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), 'utf8');
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    fs.renameSync(tmp, this.file);
  }

  // ---- records ----
  all() { return this.data.records; }

  upsert(rec) {
    const clean = sanitizeRecord(rec);
    const i = this.data.records.findIndex(r => r.id === clean.id);
    if (i >= 0) this.data.records[i] = { ...this.data.records[i], ...clean, updatedAt: new Date().toISOString() };
    else this.data.records.unshift({ ...clean, addedAt: clean.addedAt || new Date().toISOString() });
    this.save();
    return this.data.records.find(r => r.id === clean.id);
  }

  remove(id) {
    const r = this.data.records.find(x => x.id === id);
    this.data.records = this.data.records.filter(x => x.id !== id);
    this.save();
    if (r) for (const f of [r.coverFront, r.coverBack, r.userPhoto]) this.deleteCover(f);
  }

  // ---- covers ----
  coverPath(name) {
    if (!name || !/^[A-Za-z0-9_.-]+$/.test(name)) return null;
    return path.join(this.coversDir, name);
  }

  writeCover(buffer, ext) {
    const safeExt = /^(jpg|jpeg|png|webp|gif)$/i.test(ext || '') ? ext.toLowerCase().replace('jpeg', 'jpg') : 'jpg';
    const name = crypto.randomBytes(8).toString('hex') + '.' + safeExt;
    fs.writeFileSync(path.join(this.coversDir, name), buffer);
    return name;
  }

  deleteCover(name) {
    const p = this.coverPath(name);
    if (!p) return;
    if (this.data.records.some(r => r.coverFront === name || r.coverBack === name || r.userPhoto === name)) return;
    try { fs.unlinkSync(p); } catch (e) { /* already gone */ }
  }

  // Remove pictures that no record uses (left over from cancelled look-ups).
  cleanOrphans(maxAgeMs = 24 * 3600 * 1000) {
    const used = new Set();
    for (const r of this.data.records) for (const f of [r.coverFront, r.coverBack, r.userPhoto]) if (f) used.add(f);
    let n = 0;
    for (const f of fs.readdirSync(this.coversDir)) {
      if (used.has(f)) continue;
      const p = path.join(this.coversDir, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.unlinkSync(p); n++; } } catch (e) { /* skip */ }
    }
    return n;
  }

  // ---- settings & keys ----
  publicSettings() {
    return {
      ...this.data.settings,
      hasDiscogs: !!this.getSecret('discogsToken'),
      hasClaude: !!this.getSecret('anthropicKey'),
      dataDir: this.dataDir
    };
  }

  setSettings(s) {
    const allowed = ['textSize', 'claudeModel', 'voiceRate'];
    for (const k of allowed) if (s[k] !== undefined) this.data.settings[k] = s[k];
    if (s.discogsToken !== undefined) this.setSecret('discogsToken', String(s.discogsToken).trim());
    if (s.anthropicKey !== undefined) this.setSecret('anthropicKey', String(s.anthropicKey).trim());
    this.save();
    return this.publicSettings();
  }

  setSecret(k, v) {
    if (!v) { delete this.data.secrets[k]; return; }
    this.data.secrets[k] = this.crypt ? { enc: this.crypt.encrypt(v) } : { plain: v };
  }

  getSecret(k) {
    const s = this.data.secrets[k];
    if (!s) return '';
    try { return s.enc ? this.crypt.decrypt(s.enc) : (s.plain || ''); } catch (e) { return ''; }
  }

  // ---- backup ----
  backupTo(folder) {
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(folder, 'Killion\'s Record Shelf backup ' + stamp);
    fs.mkdirSync(path.join(dest, 'covers'), { recursive: true });
    const copy = JSON.parse(JSON.stringify(this.data));
    copy.secrets = {}; // keys are tied to this computer; never copy them out
    fs.writeFileSync(path.join(dest, 'records.json'), JSON.stringify(copy, null, 1), 'utf8');
    for (const f of fs.readdirSync(this.coversDir)) fs.copyFileSync(path.join(this.coversDir, f), path.join(dest, 'covers', f));
    return dest;
  }

  restoreFrom(folder) {
    const src = path.join(folder, 'records.json');
    const d = JSON.parse(fs.readFileSync(src, 'utf8'));
    if (!d || !Array.isArray(d.records)) throw new Error('That folder does not hold a record backup.');
    const coversSrc = path.join(folder, 'covers');
    if (fs.existsSync(coversSrc)) {
      for (const f of fs.readdirSync(coversSrc)) {
        if (/^[A-Za-z0-9_.-]+$/.test(f)) fs.copyFileSync(path.join(coversSrc, f), path.join(this.coversDir, f));
      }
    }
    const keepSecrets = this.data.secrets;
    this.data = { ...EMPTY, ...d, settings: { ...EMPTY.settings, ...(d.settings || {}) }, secrets: keepSecrets };
    this.data.records = this.data.records.map(sanitizeRecord);
    this.save();
    return this.data.records.length;
  }
}

const STR = ['id', 'list', 'title', 'artist', 'year', 'label', 'catno', 'barcode', 'country', 'format', 'mbid', 'rgid',
  'discogsId', 'coverFront', 'coverBack', 'userPhoto', 'coverSource', 'condition', 'notes', 'paid', 'myValue', 'addedAt'];

function sanitizeRecord(r) {
  const out = {};
  for (const k of STR) if (r[k] !== undefined && r[k] !== null) out[k] = String(r[k]).slice(0, 4000);
  out.id = out.id || crypto.randomBytes(8).toString('hex');
  out.list = out.list === 'wish' ? 'wish' : 'collection';
  out.haveCover = r.haveCover === true ? true : r.haveCover === false ? false : null;
  out.tracks = Array.isArray(r.tracks) ? r.tracks.slice(0, 200).map(t => ({
    side: String(t.side || ''), pos: String(t.pos || ''), title: String(t.title || ''), length: String(t.length || '')
  })) : [];
  out.credits = Array.isArray(r.credits) ? r.credits.slice(0, 100).map(c => ({ role: String(c.role || ''), name: String(c.name || '') })) : [];
  const p = r.prices;
  out.prices = p && typeof p === 'object' ? {
    nm: price(p.nm), vgp: price(p.vgp), vg: price(p.vg), g: price(p.g),
    lowest: price(p.lowest), forSale: num(p.forSale), anyLowest: price(p.anyLowest), anyForSale: num(p.anyForSale),
    currency: String(p.currency || 'USD').slice(0, 3), checkedAt: String(p.checkedAt || ''), note: String(p.note || '').slice(0, 200)
  } : null;
  return out;
}
// Missing must stay missing: Number(null) is 0, which showed up as "$0".
function num(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
function price(v) { const n = num(v); return n !== null && n > 0 ? n : null; }

module.exports = { Store, sanitizeRecord };
