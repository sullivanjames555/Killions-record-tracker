// Stand-in for preload.js so the screen can be tried in a normal browser (no internet, no Electron).
(() => {
  const svg = (a, b, c) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="68" cy="32" r="16" fill="${c}"/></svg>`);
  const T = (side, pos, title, length) => ({ side, pos, title, length });
  const now = Date.now();
  let records = [
    { id: 'r1', list: 'collection', title: 'Midnight Harbor', artist: 'The Velvet Tides', year: '1967', label: 'Harborline', catno: 'HL-2041', country: 'US', format: '12" Vinyl', mbid: 'm1', haveCover: true, condition: 'vgp', coverSource: 'auto',
      frontUrl: svg('#0F2D63', '#1E5BC6', '#F5B700'), backUrl: svg('#F3EEE2', '#D8D1BF', '#C9C2B0'), prices: { nm: 62, vgp: 44, vg: 25, g: 9, lowest: 30, forSale: 12, checkedAt: new Date().toISOString() },
      tracks: [T('Side A', 'A1', 'Lanterns on the Water', '3:12'), T('Side A', 'A2', 'Salt in Her Hair', '2:48'), T('Side B', 'B1', 'Midnight Harbor', '3:40'), T('Side B', 'B2', 'Last Ferry Home', '5:21')],
      credits: [{ role: 'Producer', name: 'Walt Becker' }, { role: 'Photography (cover)', name: 'June Albright' }], notes: 'Bought at Ray’s Records in 1985.', paid: '$4', addedAt: new Date(now - 1000).toISOString() },
    { id: 'r2', list: 'collection', title: 'Three Rivers Blues', artist: 'Earl Mason Trio', year: '1959', label: 'Keystone', catno: 'K-118', haveCover: true, condition: 'vg', frontUrl: svg('#C2361F', '#16181D', '#F1E7D0'), prices: { nm: 140, vgp: 110, vg: 90, g: 30 }, tracks: [], credits: [], addedAt: new Date(now - 2000).toISOString() },
    { id: 'r3', list: 'collection', title: 'Sunday Drive', artist: 'Lucy Arden', year: '1972', label: 'Meadowlark', haveCover: false, condition: 'vgp', frontUrl: svg('#2F7D5B', '#3E9B72', '#F5B700'), prices: { vgp: 15 }, tracks: [], credits: [], addedAt: new Date(now - 3000).toISOString() },
    { id: 'r4', list: 'collection', title: 'Neon Boulevard', artist: 'The Satellites', year: '1981', haveCover: null, condition: 'nm', frontUrl: svg('#1B1035', '#E0457B', '#FFB347'), prices: null, tracks: [], credits: [], addedAt: new Date(now - 4000).toISOString() },
    { id: 'r5', list: 'collection', title: 'Copper Canyon', artist: 'Dale Whitfield', year: '1975', haveCover: false, condition: 'g', prices: { g: 6 }, tracks: [], credits: [], addedAt: new Date(now - 5000).toISOString() },
    { id: 'r6', list: 'wish', title: 'Moonlight Sessions', artist: 'Ada Bell Quartet', year: '1962', frontUrl: svg('#101218', '#2B2F3A', '#F1E7D0'), prices: { vgp: 70 }, tracks: [], credits: [], addedAt: new Date(now - 6000).toISOString() }
  ];
  let settings = { textSize: 2, hasDiscogs: true, hasClaude: false, dataDir: 'C:\\Users\\Jim\\AppData\\Roaming\\Killion\'s Record Shelf' };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let n = 100;
  window.shelf = {
    load: async () => ({ records: JSON.parse(JSON.stringify(records)), settings, version: '1.0.0' }),
    saveRecord: async r => { r = { ...r, id: r.id || 'n' + (n++), addedAt: r.addedAt || new Date().toISOString() }; const i = records.findIndex(x => x.id === r.id); if (i >= 0) records[i] = r; else records.unshift(r); return r; },
    deleteRecord: async id => { records = records.filter(r => r.id !== id); return true; },
    saveImage: async d => ({ name: 'img' + (n++) + '.jpg', url: d }),
    search: async () => { await wait(300); return [
      { mbid: 'x1', title: 'Kind of Blue', artist: 'Miles Davis', year: '1959', label: 'Columbia', catno: 'CL 1355', country: 'US', format: '12" Vinyl', thumb: svg('#0b2a5c', '#3a6fc4', '#ffffff') },
      { mbid: 'x2', title: 'Kind of Blue', artist: 'Miles Davis', year: '1971', label: 'Columbia', catno: 'PC 8163', country: 'US', format: '12" Vinyl', thumb: 'https://invalid.example/none.jpg' }]; },
    identifyPhoto: async () => null,
    details: async mbid => { await wait(400); return { mbid, title: 'Kind of Blue', artist: 'Miles Davis', year: '1959', label: 'Columbia', catno: 'CL 1355', country: 'US', format: '12" Vinyl', coverSource: 'auto',
      coverFront: 'f.jpg', frontUrl: svg('#0b2a5c', '#3a6fc4', '#ffffff'), discogsId: '1234', prices: { nm: 220, vgp: 120, vg: 70, g: 25 },
      tracks: [T('Side A', 'A1', 'So What', '9:22'), T('Side A', 'A2', 'Freddie Freeloader', '9:46'), T('Side B', 'B1', 'All Blues', '11:33')], credits: [{ role: 'Producer', name: 'Teo Macero' }] }; },
    prices: async r => ({ prices: r.prices, discogsId: r.discogsId || '1' }),
    fetchCover: async () => null,
    saveSettings: async s => { settings = { ...settings, ...s }; return settings; },
    backup: async () => null, restore: async () => null, reportPdf: async () => null, reportPrint: async () => true,
    exportCsv: async () => null, openExternal: async () => true, openDataFolder: async () => true
  };
})();
