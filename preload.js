'use strict';
// The only bridge between the screen and the computer. The screen cannot touch files directly.
const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r || !r.ok) throw new Error((r && r.error) || 'Something went wrong.');
  return r.value;
}

contextBridge.exposeInMainWorld('shelf', {
  load: () => call('data:load'),
  saveRecord: rec => call('record:save', rec),
  deleteRecord: id => call('record:delete', id),
  saveImage: dataUrl => call('cover:saveImage', dataUrl),
  search: params => call('lookup:search', params),
  identifyPhoto: dataUrl => call('lookup:identifyPhoto', dataUrl),
  details: mbid => call('lookup:details', mbid),
  prices: rec => call('lookup:prices', rec),
  fetchCover: rec => call('lookup:cover', rec),
  saveSettings: s => call('settings:save', s),
  testDiscogs: () => call('discogs:test'),
  openLog: () => call('open:log'),
  backup: () => call('backup:make'),
  restore: () => call('backup:restore'),
  reportPdf: () => call('report:pdf'),
  reportPrint: () => call('report:print'),
  exportCsv: csv => call('export:csv', csv),
  openExternal: url => call('open:external', url),
  openDataFolder: () => call('open:dataFolder')
});
