'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Store } = require('./src/store');
const lookup = require('./src/lookup');

let win = null;
let store = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function crypt() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return {
      encrypt: s => safeStorage.encryptString(s).toString('base64'),
      decrypt: b => safeStorage.decryptString(Buffer.from(b, 'base64'))
    };
  } catch (e) { return null; }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 640,
    title: 'My Record Shelf',
    backgroundColor: '#FFFFFF',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // Never navigate away from the app; open web links in the normal browser.
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); openSafe(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { openSafe(url); return { action: 'deny' }; });

  // Ctrl + / Ctrl - / Ctrl 0 to zoom, F5 to reload, F12 for support.
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const wc = win.webContents;
    if (input.control && (input.key === '=' || input.key === '+')) { wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4)); e.preventDefault(); }
    else if (input.control && input.key === '-') { wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -2)); e.preventDefault(); }
    else if (input.control && input.key === '0') { wc.setZoomLevel(0); e.preventDefault(); }
    else if (input.key === 'F5') { wc.reload(); e.preventDefault(); }
    else if (input.key === 'F12') { wc.toggleDevTools(); e.preventDefault(); }
  });
}

function openSafe(url) {
  if (/^https:\/\//i.test(url)) shell.openExternal(url);
}

app.whenReady().then(() => {
  if (!gotLock) return;
  store = new Store(app.getPath('userData'), crypt());
  try { store.cleanOrphans(); } catch (e) { /* not important */ }

  // Only the webcam is allowed (for photographing covers).
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media'));
  session.defaultSession.setPermissionCheckHandler((wc, perm) => perm === 'media');

  registerIpc();
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------------------------------------------------------------------------
function coverUrl(name) {
  const p = store.coverPath(name);
  return p && fs.existsSync(p) ? pathToFileURL(p).toString() : '';
}

function withUrls(r) {
  return { ...r, frontUrl: coverUrl(r.coverFront), backUrl: coverUrl(r.coverBack), photoUrl: coverUrl(r.userPhoto) };
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('That picture could not be read.');
  return { buffer: Buffer.from(m[2], 'base64'), ext: m[1] === 'jpeg' ? 'jpg' : m[1] };
}

function friendly(e) {
  const msg = (e && e.message) || String(e);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|took too long/i.test(msg)) {
    return 'The computer could not reach the internet. Check the connection and try again.';
  }
  if (e && e.status === 401) return 'The Discogs key in Settings was not accepted. Please check it.';
  if (e && e.status === 429) return 'The music database is busy. Please wait a minute and try again.';
  if (e && e.status === 503) return 'The music database is busy right now. Please try again in a moment.';
  return msg;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: friendly(e) }; }
  });
}

async function getPrices(rec) {
  const token = store.getSecret('discogsToken');
  if (!token) return { prices: null, discogsId: rec.discogsId || '' };
  let id = rec.discogsId;
  let cover = '';
  if (!id) {
    const hit = await lookup.discogsFind(rec, token);
    if (hit) { id = hit.id; cover = hit.cover; }
  }
  if (!id) return { prices: null, discogsId: '' };
  return { prices: await lookup.prices(id, token), discogsId: id, discogsCover: cover };
}

function registerIpc() {
  handle('data:load', () => ({
    records: store.all().map(withUrls),
    settings: store.publicSettings(),
    version: app.getVersion()
  }));

  handle('record:save', rec => withUrls(store.upsert(rec)));
  handle('record:delete', id => { store.remove(String(id)); return true; });

  handle('cover:saveImage', dataUrl => {
    const { buffer, ext } = dataUrlToBuffer(dataUrl);
    if (buffer.length > 15 * 1024 * 1024) throw new Error('That picture is too large.');
    const name = store.writeCover(buffer, ext);
    return { name, url: coverUrl(name) };
  });

  handle('lookup:search', params => lookup.search(params || {}));

  handle('lookup:identifyPhoto', async dataUrl => {
    const key = store.getSecret('anthropicKey');
    if (!key) return null;
    return lookup.identifyPhoto(dataUrl, key, store.data.settings.claudeModel);
  });

  // Fetch songs, credits, cover pictures and value for one chosen release.
  handle('lookup:details', async mbid => {
    const d = await lookup.details(String(mbid));
    const covers = await lookup.coverUrls(d.mbid, d.rgid);
    let priceInfo = { prices: null, discogsId: d.discogsId };
    try { priceInfo = await getPrices(d); } catch (e) { priceInfo.priceError = friendly(e); }
    if (!covers.front && priceInfo.discogsCover) covers.front = priceInfo.discogsCover;
    const out = { ...d, discogsId: priceInfo.discogsId || d.discogsId, prices: priceInfo.prices, priceError: priceInfo.priceError || '' };
    for (const side of ['front', 'back']) {
      if (!covers[side]) continue;
      try {
        const img = await lookup.download(covers[side]);
        if (img) {
          const name = store.writeCover(img.buffer, img.ext);
          out[side === 'front' ? 'coverFront' : 'coverBack'] = name;
          out[side === 'front' ? 'frontUrl' : 'backUrl'] = coverUrl(name);
        }
      } catch (e) { /* picture is a bonus; carry on without it */ }
    }
    out.coverSource = out.coverFront ? 'auto' : '';
    return out;
  });

  handle('lookup:prices', async rec => {
    const p = await getPrices(rec || {});
    return { prices: p.prices, discogsId: p.discogsId };
  });

  handle('lookup:cover', async rec => {
    if (!rec || !rec.mbid) return null;
    const covers = await lookup.coverUrls(rec.mbid, rec.rgid);
    const out = {};
    for (const side of ['front', 'back']) {
      if (!covers[side]) continue;
      const img = await lookup.download(covers[side]).catch(() => null);
      if (img) out[side] = store.writeCover(img.buffer, img.ext);
    }
    return { coverFront: out.front || '', coverBack: out.back || '', frontUrl: coverUrl(out.front), backUrl: coverUrl(out.back) };
  });

  handle('settings:save', s => store.setSettings(s || {}));

  handle('backup:make', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose where to save the backup (a USB stick is ideal)', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return store.backupTo(r.filePaths[0]);
  });

  handle('backup:restore', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose the backup folder (it is named "My Record Shelf backup ...")', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    return store.restoreFrom(r.filePaths[0]);
  });

  handle('report:pdf', async () => {
    const r = await dialog.showSaveDialog(win, { title: 'Save the value report', defaultPath: path.join(app.getPath('documents'), 'Record collection value report.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'Letter', margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
    fs.writeFileSync(r.filePath, pdf);
    shell.openPath(r.filePath);
    return r.filePath;
  });

  handle('report:print', () => new Promise(resolve => win.webContents.print({ printBackground: true }, ok => resolve(ok))));

  handle('export:csv', async csv => {
    const r = await dialog.showSaveDialog(win, { title: 'Save as a spreadsheet', defaultPath: path.join(app.getPath('documents'), 'My records.csv'), filters: [{ name: 'Spreadsheet (CSV)', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, '﻿' + String(csv), 'utf8');
    return r.filePath;
  });

  handle('open:external', url => { openSafe(String(url)); return true; });
  handle('open:dataFolder', () => shell.openPath(store.dataDir));
}
