'use strict';
/* Killion's Record Shelf — the screen.
   Everything the user sees is built here. Data and internet look-ups go through window.shelf (preload.js). */
{
  const api = window.shelf;
  const main = document.getElementById('main');
  const modalWrap = document.getElementById('modal');
  const toastEl = document.getElementById('toast');

  const COND = [
    { id: 'nm', label: 'Like new' },
    { id: 'vgp', label: 'Very good' },
    { id: 'vg', label: 'Good' },
    { id: 'g', label: 'Worn' }
  ];
  const condLabel = id => (COND.find(c => c.id === id) || COND[1]).label;
  const TEXT_SIZES = { 1: '16px', 2: '18px', 3: '21px' };

  const S = {
    records: [], settings: {}, version: '',
    view: 'records', selId: null, filter: 'all', sort: 'recent', q: '', side: 'front',
    add: freshAdd(), pickTarget: null
  };
  function freshAdd() {
    return { stage: 'start', photo: null, back: null, matches: [], draft: null, msg: '', name: '', code: '', forList: 'collection' };
  }

  // ---------------- small helpers ----------------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => (/^(file:|https:|data:image\/)/.test(u || '') ? u : '');
  function money(n) {
    if (n == null || !isFinite(n)) return '';
    const whole = n >= 10 || Number.isInteger(n);
    const opts = { style: 'currency', currency: 'USD', maximumFractionDigits: whole ? 0 : 2, minimumFractionDigits: whole ? 0 : 2 };
    return new Intl.NumberFormat('en-US', opts).format(n);
  }
  // The value to show, best source first: your own value, Discogs' price for the
  // condition you picked, the cheapest copy of this pressing for sale, the cheapest of any pressing.
  function valueInfo(r) {
    if (!r) return null;
    const mine = parseMoney(r.myValue);
    if (mine) return { amount: mine, label: 'Your value', source: 'mine' };
    const p = r.prices;
    if (!p) return null;
    const c = r.condition || 'vgp';
    if (p[c] > 0) return { amount: p[c], label: 'Worth about (' + condLabel(c).toLowerCase() + ')', source: 'cond' };
    if (p.lowest > 0) return { amount: p.lowest, label: 'Cheapest copy for sale now', source: 'lowest' };
    if (p.anyLowest > 0) return { amount: p.anyLowest, label: 'Cheapest copy of any version for sale', source: 'any' };
    return null;
  }
  const amountFor = r => { const v = valueInfo(r); return v ? v.amount : null; };
  function parseMoney(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[$,\s]/g, '')); return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null; }
  function valueNotes(r) {
    const v = valueInfo(r), p = r.prices, note = (p && p.note) || '';
    const out = [];
    if (!v) {
      if (!S.settings.hasDiscogs) out.push('Add your free Discogs key in Settings to see values.');
      else if (!p) out.push('The value hasn’t been checked yet.');
      else if (note.includes('noMatch')) out.push('Discogs couldn’t find this record. Check the album name and artist (or add the catalog number), then check again. Or type your own value.');
      else if (note.includes('noneForSale')) out.push('Nobody has this record for sale on Discogs right now, so there is no price to go by. You can type your own value.');
      else out.push('No price was found on Discogs.');
    }
    if (v && (v.source === 'lowest' || v.source === 'any') && note.includes('needsSeller')) {
      out.push('For a value that matches the condition, fill in Seller Settings on the Discogs account (see Settings).');
    }
    if (p && p.checkedAt && v && v.source !== 'mine') {
      const n = v.source === 'any' ? p.anyForSale : p.forSale;
      out.push('From Discogs, checked ' + dateText(p.checkedAt) + (n ? ' · ' + n + ' for sale now' : ''));
    }
    return out;
  }
  function dateText(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function toast(msg, bad) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('bad', !!bad);
    toastEl.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove('show'), bad ? 6000 : 3200);
  }
  const icon = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    box: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h6l2 2h10v10H3z"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>'
  };

  // ---------------- modal dialogs (built in, large print) ----------------
  function modal(html, opts = {}) {
    return new Promise(resolve => {
      modalWrap.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div>';
      modalWrap.hidden = false;
      const first = modalWrap.querySelector('[data-modal]');
      if (first) first.focus();
      modal.close = v => { modalWrap.hidden = true; modalWrap.innerHTML = ''; modal.close = null; if (opts.onClose) opts.onClose(); resolve(v); };
    });
  }
  modalWrap.addEventListener('click', e => {
    const b = e.target.closest('[data-modal]');
    if (b && modal.close) modal.close(b.dataset.modal);
    else if (e.target === modalWrap && modal.close) modal.close('cancel');
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.close) modal.close('cancel');
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.closest('form[data-form="edit"]')) e.preventDefault();
  });
  function confirmBox(text, yes, no) {
    return modal('<p>' + esc(text) + '</p><div class="row"><button class="btn primary" data-modal="yes">' + esc(yes) +
      '</button><button class="btn" data-modal="no">' + esc(no) + '</button></div>').then(v => v === 'yes');
  }

  // ---------------- pictures ----------------
  function readImage(file, max = 1400) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) return reject(new Error('Please choose a picture file (JPG or PNG).'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('That picture could not be opened.'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('That picture could not be opened.'));
        img.onload = () => resolve(shrink(img, img.naturalWidth, img.naturalHeight, max));
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function shrink(src, w, h, max) {
    const k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  }
  const filePick = document.createElement('input');
  filePick.type = 'file'; filePick.accept = 'image/*'; filePick.hidden = true;
  document.body.appendChild(filePick);
  function choosePhoto(target) { S.pickTarget = target; filePick.value = ''; filePick.click(); }
  filePick.addEventListener('change', async () => {
    const f = filePick.files && filePick.files[0];
    if (!f) return;
    try { routePhoto(S.pickTarget, await readImage(f)); } catch (e) { toast(e.message, true); }
  });
  function routePhoto(target, dataUrl) {
    if (!target) return;
    if (target.type === 'add-front') onFrontPhoto(dataUrl);
    else if (target.type === 'add-back') { S.add.back = { dataUrl }; renderAdd(); }
    else if (target.type === 'detail') setOwnPhoto(target.id, target.side, dataUrl);
    else if (target.type === 'edit') setEditPhoto(target.side, dataUrl);
  }

  // Drag-and-drop of photos straight from a folder.
  document.addEventListener('dragover', e => {
    e.preventDefault();
    const z = e.target.closest && e.target.closest('[data-drop]');
    document.querySelectorAll('[data-drop]').forEach(d => d.classList.toggle('over', d === z));
  });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.querySelectorAll('[data-drop]').forEach(d => d.classList.remove('over')); });
  document.addEventListener('drop', async e => {
    e.preventDefault();
    document.querySelectorAll('[data-drop]').forEach(d => d.classList.remove('over'));
    const z = e.target.closest && e.target.closest('[data-drop]');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!z || !f) return;
    try {
      const dataUrl = await readImage(f);
      if (z.dataset.drop === 'front') onFrontPhoto(dataUrl);
      else if (z.dataset.drop === 'back') { S.add.back = { dataUrl }; renderAdd(); }
    } catch (err) { toast(err.message, true); }
  });

  // Webcam
  async function webcam(target) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1600 }, height: { ideal: 1200 } }, audio: false });
    } catch (e) {
      toast('No webcam was found, or it is being used by another program.', true);
      return;
    }
    const stop = () => stream.getTracks().forEach(t => t.stop());
    const p = modal('<h2>Hold the cover up to the camera</h2><div class="camera"><video autoplay playsinline muted></video>' +
      '<p class="muted">Fill the screen with the front of the sleeve, then press the yellow button.</p>' +
      '<div class="row"><button class="btn yellow tall" data-modal="snap">' + icon.camera + 'Take the picture</button>' +
      '<button class="btn" data-modal="cancel">Cancel</button></div></div>', { wide: true, onClose: () => {} });
    const video = modalWrap.querySelector('video');
    video.srcObject = stream;
    let shot = null;
    const snapBtn = modalWrap.querySelector('[data-modal="snap"]');
    snapBtn.addEventListener('click', () => { if (video.videoWidth) shot = shrink(video, video.videoWidth, video.videoHeight, 1400); }, { capture: true });
    const v = await p;
    stop();
    if (v === 'snap' && shot) routePhoto(target, shot);
  }

  // ---------------- data ----------------
  async function load() {
    try {
      const d = await api.load();
      S.records = d.records || [];
      S.settings = d.settings || {};
      S.version = d.version || '';
    } catch (e) { toast(e.message, true); }
    applyTextSize();
    go('records');
  }
  const byId = id => S.records.find(r => r.id === id);
  async function saveRec(r) {
    const saved = await api.saveRecord(r);
    const i = S.records.findIndex(x => x.id === saved.id);
    if (i >= 0) S.records[i] = saved; else S.records.unshift(saved);
    return saved;
  }
  function applyTextSize() {
    document.documentElement.style.fontSize = TEXT_SIZES[S.settings.textSize || 2] || '18px';
  }
  async function setTextSize(n) {
    n = Math.max(1, Math.min(3, n));
    S.settings.textSize = n;
    applyTextSize();
    try { S.settings = await api.saveSettings({ textSize: n }); } catch (e) { /* still applied for now */ }
    if (S.view === 'settings') renderSettings();
  }

  // ---------------- navigation ----------------
  function go(view) {
    S.view = view;
    const navView = view === 'edit' && S.edit ? (S.edit.isNew ? 'add' : (S.edit.rec.list === 'wish' ? 'wish' : 'records')) : view;
    document.querySelectorAll('.nav-btn').forEach(b => {
      const on = b.dataset.view === navView;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    stopSpeaking();
    if (view === 'records' || view === 'wish') renderShelf();
    else if (view === 'add') renderAdd();
    else if (view === 'edit' && S.edit) renderEdit();
    else if (view === 'report') renderReport();
    else if (view === 'settings') renderSettings();
    else if (view === 'help') renderHelp();
    main.scrollTop = 0;
  }

  // ---------------- My Records / Wish list ----------------
  function listRecords() {
    const list = S.view === 'wish' ? 'wish' : 'collection';
    return S.records.filter(r => r.list === list);
  }
  function visibleRecords() {
    const q = S.q.trim().toLowerCase();
    let rs = listRecords().filter(r => {
      if (S.view === 'records' && S.filter === 'have' && r.haveCover !== true) return false;
      if (S.view === 'records' && S.filter === 'need' && r.haveCover !== false) return false;
      if (!q) return true;
      return [r.title, r.artist, r.label, r.year, r.catno, r.notes].join(' ').toLowerCase().includes(q);
    });
    const by = {
      recent: (a, b) => String(b.addedAt).localeCompare(String(a.addedAt)),
      artist: (a, b) => sortName(a.artist).localeCompare(sortName(b.artist)) || a.title.localeCompare(b.title),
      title: (a, b) => sortName(a.title).localeCompare(sortName(b.title)),
      value: (a, b) => (amountFor(b) || 0) - (amountFor(a) || 0),
      year: (a, b) => String(a.year || '9999').localeCompare(String(b.year || '9999'))
    };
    return rs.sort(by[S.sort] || by.recent);
  }
  const sortName = s => String(s || '').replace(/^the\s+/i, '').toLowerCase();

  function renderShelf() {
    const wish = S.view === 'wish';
    const all = listRecords();
    const total = all.reduce((t, r) => t + (amountFor(r) || 0), 0);
    const need = all.filter(r => r.haveCover === false).length;
    if (!all.length) {
      main.innerHTML = '<div class="page-head"><h1>' + (wish ? 'Wish list' : 'My Records') + '</h1></div>' +
        '<div class="empty"><div class="disc spin" aria-hidden="true"></div>' +
        '<h2>' + (wish ? 'Your wish list is empty' : 'Your shelf is empty') + '</h2>' +
        '<p>' + (wish ? 'When you find a record you would like to own, press "Add to my wish list" and it will wait for you here.'
          : 'Add your first record. A photo of the cover, the barcode or just the name is enough.') + '</p>' +
        '<button class="btn yellow tall" data-action="go-add" data-list="' + (wish ? 'wish' : 'collection') + '">' + icon.plus +
        (wish ? 'Add to my wish list' : 'Add a record') + '</button></div>';
      return;
    }
    const sub = wish
      ? all.length + (all.length === 1 ? ' record' : ' records') + ' I would like to find'
      : all.length + (all.length === 1 ? ' record' : ' records') + (total ? ' · worth about <strong>' + esc(money(total)) + '</strong>' : '') +
        (need ? ' · <strong class="need-count">' + need + ' still need a cover</strong>' : '');
    const chips = wish ? '' : [['all', 'All records'], ['have', 'Have cover'], ['need', 'Need a cover (' + need + ')']]
      .map(([id, l]) => '<button class="chip" data-action="filter" data-id="' + id + '" aria-pressed="' + (S.filter === id) + '">' + esc(l) + '</button>').join('');
    main.innerHTML =
      '<div class="page-head"><div><h1>' + (wish ? 'Wish list' : 'My Records') + '</h1><div class="sub">' + sub + '</div></div>' +
      '<label class="search">' + icon.search + '<span hidden>Find a record</span><input id="q" type="search" placeholder="Find a record or artist" value="' + esc(S.q) + '" aria-label="Find a record or artist"></label></div>' +
      '<div class="shelf"><section class="shelf-list"><div class="toolbar">' + chips +
      '<div class="sort"><label for="sort" class="label">Sort by</label><select id="sort" class="input">' +
      [['recent', 'Newest first'], ['artist', 'Artist A–Z'], ['title', 'Title A–Z'], ['value', 'Most valuable'], ['year', 'Oldest first']]
        .map(([v, l]) => '<option value="' + v + '"' + (S.sort === v ? ' selected' : '') + '>' + l + '</option>').join('') +
      '</select></div></div><div id="grid" class="grid"></div></section>' +
      '<section id="detail" class="detail" aria-label="Selected record"></section></div>';
    renderGrid();
  }

  function coverImg(r, cls) {
    const u = safeUrl(r.frontUrl || r.photoUrl);
    return u ? '<img class="' + cls + '" src="' + esc(u) + '" alt="" loading="lazy">' : '<div class="' + cls + ' cover-blank" aria-hidden="true"></div>';
  }
  function badge(r) {
    if (r.list === 'wish') return '';
    if (r.haveCover === true) return '<span class="badge have">' + icon.check + 'Have cover</span>';
    if (r.haveCover === false) return '<span class="badge need">' + icon.box + 'Need cover</span>';
    return '<span class="badge unknown">Cover: not marked</span>';
  }

  function renderGrid() {
    const grid = document.getElementById('grid');
    if (!grid) return;
    const rs = visibleRecords();
    if (!rs.find(r => r.id === S.selId)) S.selId = rs[0] ? rs[0].id : null;
    grid.innerHTML = rs.length ? rs.map(r => {
      const amt = amountFor(r);
      return '<button class="tile" data-action="select" data-id="' + esc(r.id) + '" aria-pressed="' + (r.id === S.selId) + '">' +
        coverImg(r, 'cover') + '<span class="t">' + esc(r.title || 'Untitled') + '</span><span class="a">' + esc(r.artist) + '</span>' +
        (amt != null ? '<span class="v">' + esc(money(amt)) + '</span>' : '') + badge(r) + '</button>';
    }).join('') : '<p class="muted" style="grid-column: 1 / -1; font-size: 1.1rem">No records match. Try a different word, or press "All records".</p>';
    renderDetail();
  }

  function valueBox(r) {
    const v = valueInfo(r);
    const q = encodeURIComponent(((r.artist || '') + ' ' + (r.title || '')).trim());
    const dUrl = r.discogsId ? 'https://www.discogs.com/release/' + encodeURIComponent(r.discogsId) : 'https://www.discogs.com/search/?type=release&q=' + q;
    const eUrl = 'https://www.ebay.com/sch/i.html?_nkw=' + q + '+vinyl&LH_Sold=1&LH_Complete=1';
    return '<div class="value-box">' +
      '<div class="lbl">' + esc(v ? v.label : 'Value') + '</div>' +
      (v ? '<div class="amt">' + esc(money(v.amount)) + '</div>' : '') +
      valueNotes(r).map(t => '<div class="note">' + esc(t) + '</div>').join('') +
      (S.settings.hasDiscogs ? '<button class="btn refresh" data-action="refresh-value" data-id="' + esc(r.id) + '">' + icon.refresh + 'Check today’s value</button>' : '') +
      '<div class="links"><button class="btn" data-action="open" data-url="' + esc(dUrl) + '">See on Discogs</button>' +
      '<button class="btn" data-action="open" data-url="' + esc(eUrl) + '">eBay sold prices</button></div></div>';
  }

  function songsHtml(r) {
    if (!r.tracks || !r.tracks.length) return '';
    let html = '<div class="songs"><h2>Songs</h2>', side = null;
    for (const t of r.tracks) {
      if (t.side !== side) { side = t.side; if (side) html += '<div class="side-name">' + esc(side) + '</div>'; }
      html += '<div class="song"><span>' + esc((t.pos ? t.pos + '. ' : '') + t.title) + '</span><span class="len">' + esc(t.length) + '</span></div>';
    }
    return html + '</div>';
  }
  function creditsHtml(r) {
    if (!r.credits || !r.credits.length) return '';
    return '<div><h2>From the sleeve</h2><dl class="credits">' +
      r.credits.map(c => '<dt>' + esc(c.role) + '</dt><dd>' + esc(c.name) + '</dd>').join('') + '</dl></div>';
  }

  function renderDetail() {
    const box = document.getElementById('detail');
    if (!box) return;
    const r = byId(S.selId);
    if (!r) { box.innerHTML = '<p class="muted">Click a record to see everything about it.</p>'; return; }
    const front = safeUrl(r.frontUrl || r.photoUrl), back = safeUrl(r.backUrl);
    const showUrl = S.side === 'back' ? back : front;
    const picNote = S.side === 'back'
      ? (back ? 'Back of the sleeve' : 'No picture of the back yet')
      : (r.frontUrl ? (r.coverSource === 'photo' ? 'Your own photo' : 'Picture found automatically') : (r.photoUrl ? 'Your own photo' : 'No picture yet'));
    const coverBlock = showUrl
      ? '<img class="cover" src="' + esc(showUrl) + '" alt="' + (S.side === 'back' ? 'Back' : 'Front') + ' of the sleeve of ' + esc(r.title) + '">'
      : '<div class="cover cover-blank" aria-hidden="true"></div>';
    const meta = [r.year, r.label, r.catno, r.country, r.format].filter(Boolean).join(' · ');
    const inCollection = r.list !== 'wish';
    box.innerHTML =
      '<div class="big-cover" data-key="' + esc(r.id + S.side) + '">' + coverBlock + '</div>' +
      '<div class="seg" role="group" aria-label="Which side of the sleeve">' +
      '<button data-action="side" data-id="front" aria-pressed="' + (S.side === 'front') + '">Front cover</button>' +
      '<button data-action="side" data-id="back" aria-pressed="' + (S.side === 'back') + '">Back cover</button></div>' +
      '<div class="pic-line"><span>' + esc(picNote) + '</span><span class="row">' +
      (!showUrl && r.mbid ? '<button class="btn" data-action="find-cover" data-id="' + esc(r.id) + '">' + icon.refresh + 'Find the picture</button>' : '') +
      '<button class="btn" data-action="own-photo" data-id="' + esc(r.id) + '">' + icon.folder + 'Use my own photo</button></span></div>' +
      (inCollection ? '<fieldset class="box"><legend>Do I have the cover for this record?</legend><div class="choice-grid">' +
        '<button class="choice have" data-action="have" data-id="' + esc(r.id) + '" data-v="yes" aria-pressed="' + (r.haveCover === true) + '">Yes, I have it</button>' +
        '<button class="choice need" data-action="have" data-id="' + esc(r.id) + '" data-v="no" aria-pressed="' + (r.haveCover === false) + '">No, I need one</button></div></fieldset>' : '') +
      '<div><h2 class="rec-title">' + esc(r.title || 'Untitled') + '</h2><div class="rec-artist">' + esc(r.artist) + '</div><div class="rec-meta">' + esc(meta) + '</div></div>' +
      '<button class="btn blue-line tall" data-action="edit" data-id="' + esc(r.id) + '">' + icon.pencil + 'Edit all the details</button>' +
      (inCollection ? '<fieldset class="box"><legend>What shape is the record in?</legend><div class="choice-grid">' +
        COND.map(c => '<button class="choice" data-action="condition" data-id="' + esc(r.id) + '" data-v="' + c.id + '" aria-pressed="' + ((r.condition || 'vgp') === c.id) + '">' + c.label + '</button>').join('') +
        '</div></fieldset>' : '') +
      valueBox(r) +
      (inCollection ? '' : '<button class="btn yellow tall" data-action="got-it" data-id="' + esc(r.id) + '">' + icon.check + 'I got it! Move to my records</button>') +
      '<button class="btn blue-line tall" data-action="speak" data-id="' + esc(r.id) + '">' + icon.speaker + '<span id="speak-label">Read it to me</span></button>' +
      songsHtml(r) + creditsHtml(r) +
      '<div class="notes-box"><h2>My notes</h2>' +
      '<div class="field"><label for="paid">What I paid</label><input id="paid" class="input" data-field="paid" data-id="' + esc(r.id) + '" value="' + esc(r.paid) + '" placeholder="For example: $4 at a yard sale"></div>' +
      '<div class="field"><label for="notes">Notes</label><textarea id="notes" class="input" data-field="notes" data-id="' + esc(r.id) + '" placeholder="Where I got it, who gave it to me, any scratches…">' + esc(r.notes) + '</textarea></div>' +
      '<div class="small muted">Saved automatically.</div></div>' +
      '<div class="row">' + (r.mbid ? '<button class="btn" data-action="relookup" data-id="' + esc(r.id) + '">' + icon.refresh + 'Look it up again</button>' : '') +
      '<button class="btn danger" data-action="delete" data-id="' + esc(r.id) + '">Remove this record</button></div>' +
      (r.addedAt ? '<div class="small muted">Added ' + esc(dateText(r.addedAt)) + '</div>' : '');
  }

  async function setEditPhoto(side, dataUrl) {
    if (!S.edit) return;
    try {
      const img = await api.saveImage(dataUrl);
      const r = S.edit.rec;
      if (side === 'back') { r.coverBack = img.name; r.backUrl = img.url; }
      else { r.coverFront = img.name; r.frontUrl = img.url; r.coverSource = 'photo'; }
      markDirty();
      const c = document.getElementById('e-covers'); if (c) c.innerHTML = editCoversHtml(r);
    } catch (e) { toast(e.message, true); }
  }

  async function setOwnPhoto(id, side, dataUrl) {
    const r = byId(id);
    if (!r) return;
    try {
      const img = await api.saveImage(dataUrl);
      const upd = side === 'back' ? { ...r, coverBack: img.name } : { ...r, coverFront: img.name, coverSource: 'photo' };
      await saveRec(upd);
      toast('Picture changed');
      renderGrid();
    } catch (e) { toast(e.message, true); }
  }

  // ---------------- read aloud (uses the voices built into Windows) ----------------
  function stopSpeaking() { try { speechSynthesis.cancel(); } catch (e) { /* none */ } }
  function speak(r) {
    if (!('speechSynthesis' in window)) { toast('This computer has no reading voice installed.', true); return; }
    if (speechSynthesis.speaking) { stopSpeaking(); setSpeakLabel(false); return; }
    const amt = amountFor(r);
    const parts = [
      (r.title || 'This record') + (r.artist ? ', by ' + r.artist + '.' : '.'),
      r.year ? 'Released in ' + r.year + (r.label ? ' on ' + r.label : '') + '.' : (r.label ? 'On ' + r.label + '.' : ''),
      amt != null ? 'It is worth about ' + money(amt) + '.' : '',
      r.list !== 'wish' && r.haveCover === true ? 'You have the cover.' : '',
      r.list !== 'wish' && r.haveCover === false ? 'You still need a cover for this one.' : ''
    ];
    if (r.tracks && r.tracks.length) {
      let side = null;
      parts.push('The songs are:');
      for (const t of r.tracks) {
        if (t.side && t.side !== side) { side = t.side; parts.push(side + '.'); }
        parts.push(t.title + '.');
      }
    }
    if (r.notes) parts.push('Your notes say: ' + r.notes);
    const u = new SpeechSynthesisUtterance(parts.filter(Boolean).join(' '));
    u.rate = S.settings.voiceRate || 0.9;
    u.lang = 'en-US';
    u.onend = u.onerror = () => setSpeakLabel(false);
    speechSynthesis.speak(u);
    setSpeakLabel(true);
  }
  function setSpeakLabel(on) { const l = document.getElementById('speak-label'); if (l) l.textContent = on ? 'Stop reading' : 'Read it to me'; }

  // ---------------- Add a record ----------------
  function loader(text) { return '<div class="loader"><div class="disc" aria-hidden="true"></div><div>' + esc(text) + '</div></div>'; }

  function renderAdd() {
    const a = S.add;
    const wish = a.forList === 'wish';
    const front = a.photo
      ? '<img class="preview" src="' + esc(a.photo.dataUrl) + '" alt="Your photo of the cover"><div class="drop-title">Got your photo</div>' +
        '<button class="btn" data-action="pick-photo">' + icon.folder + 'Use a different photo</button>'
      : '<div class="sleeve-art bob" aria-hidden="true"></div><div class="drop-title">Drag a photo of the cover here</div><div class="muted">or</div>' +
        '<div class="row" style="justify-content:center"><button class="btn primary tall" data-action="pick-photo">' + icon.folder + 'Choose a photo on my computer</button>' +
        '<button class="btn blue-line tall" data-action="webcam">' + icon.camera + 'Use my webcam</button></div>';
    main.innerHTML =
      '<div class="page-head"><div><h1>' + (wish ? 'Add to my wish list' : 'Add a record') + '</h1>' +
      '<div class="sub">Show us the cover and we’ll fill in the rest.</div></div>' +
      '<div class="seg" role="group" aria-label="Where should it go" style="min-width: 22rem">' +
      '<button data-action="for-list" data-id="collection" aria-pressed="' + !wish + '">I own it</button>' +
      '<button data-action="for-list" data-id="wish" aria-pressed="' + wish + '">I want it</button></div></div>' +
      '<div class="add-wrap"><section class="add-left">' +
      '<div class="step"><div class="step-num' + (a.photo ? ' done' : '') + '">1</div><h2>Show us the front cover</h2></div>' +
      '<div class="drop" data-drop="front">' + front + '</div>' +
      '<div class="back-slot" data-drop="back">' +
      (a.back ? '<img class="thumb" src="' + esc(a.back.dataUrl) + '" alt="Your photo of the back">' : '<div class="thumb" aria-hidden="true"></div>') +
      '<div style="flex:1"><div style="font-weight:700">' + (a.back ? 'Back cover added' : 'Add the back cover too (optional)') + '</div>' +
      '<div class="small muted">Helps if we can’t find a picture of the back.</div></div>' +
      '<button class="btn" data-action="pick-back">' + (a.back ? 'Change' : 'Add photo') + '</button></div>' +
      '<div class="label muted" style="margin-top:.3rem">No photo? Try another way — we’ll find the cover picture for you</div>' +
      '<div class="other-ways">' +
      '<form class="way" data-form="name"><label for="nameq" class="label">Type the name</label>' +
      '<input id="nameq" class="input" value="' + esc(a.name) + '" placeholder="Artist and album" autocomplete="off">' +
      '<button class="btn primary" type="submit">' + icon.search + 'Find it</button></form>' +
      '<form class="way" data-form="code"><label for="codeq" class="label">Barcode or catalog number</label>' +
      '<input id="codeq" class="input" value="' + esc(a.code) + '" placeholder="On the back or the spine" autocomplete="off">' +
      '<button class="btn primary" type="submit">' + icon.search + 'Find it</button></form></div>' +
      '</section><section class="add-right" id="add-right" aria-live="polite">' + addRight() + '</section></div>';
  }

  function addRight() {
    const a = S.add;
    switch (a.stage) {
      case 'identifying': return loader('Looking at your photo…');
      case 'searching': return loader('Searching for your record…');
      case 'loading': return loader('Getting the cover, songs and value…');
      case 'needName':
        return '<div class="step"><div class="step-num">2</div><h2>Now tell us the name</h2></div>' +
          '<p style="font-size:1.1rem;margin:0">' + esc(a.msg || 'We saved your photo.') + '</p>' +
          '<p style="font-size:1.1rem;margin:0">Type the artist and album, or the barcode, on the left and press <strong>Find it</strong>.</p>' +
          (!S.settings.hasClaude ? '<p class="muted" style="margin:0">Tip: to have photos read for you automatically, add an Anthropic key in Settings.</p>' : '');
      case 'matches':
        return '<div class="step"><div class="step-num">2</div><h2>Which one is yours?</h2></div>' +
          '<p class="muted" style="margin:0">Records were made in many versions. Pick the one that matches your label and year.</p>' +
          a.matches.map(m => '<button class="match" data-action="pick-match" data-id="' + esc(m.mbid) + '">' +
            '<img src="' + esc(safeUrl(m.thumb)) + '" alt="" loading="lazy" data-hide-broken>' +
            '<span><span class="mt">' + esc(m.title) + '</span><br><span class="ma">' + esc(m.artist) + '</span><br>' +
            '<span class="mm">' + esc([m.year, m.label, m.catno, m.country, m.format].filter(Boolean).join(' · ')) + '</span></span>' +
            '<span class="pick">This one</span></button>').join('') +
          '<button class="btn" data-action="manual">None of these — I’ll type it in myself</button>';
      case 'loading-edit': return loader('Opening the form…');
      case 'error':
        return '<h2>Something went wrong</h2><p style="font-size:1.1rem;margin:0">' + esc(a.msg) + '</p>' +
          '<div class="row"><button class="btn primary" data-action="add-reset">Start again</button><button class="btn" data-action="manual">Type it in myself</button></div>';
      default:
        return '<div class="step"><div class="step-num">2</div><h2>Check it’s right</h2></div>' +
          '<div class="empty" style="padding:1.5rem .5rem"><div class="disc" aria-hidden="true" style="width:6rem;height:6rem"></div>' +
          '<p>Your record will show up here with its cover, songs and value.</p></div>';
    }
  }

  function setStage(stage, extra) {
    const was = S.add.stage;
    Object.assign(S.add, extra || {}, { stage });
    const r = document.getElementById('add-right');
    if (!r || S.view !== 'add') return;
    r.innerHTML = addRight();
    if (stage !== was && stage !== 'start') r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function onFrontPhoto(dataUrl) {
    S.add.photo = { dataUrl };
    S.add.matches = []; S.add.draft = null;
    if (S.view !== 'add') go('add'); else renderAdd();
    if (!S.settings.hasClaude) { setStage('needName', { msg: 'We saved your photo.' }); focusName(); return; }
    setStage('identifying');
    let id = null;
    try { id = await api.identifyPhoto(dataUrl); } catch (e) { setStage('needName', { msg: e.message }); focusName(); return; }
    if (!id || !(id.title || id.barcode || id.catno)) { setStage('needName', { msg: 'We couldn’t read the name from the photo.' }); focusName(); return; }
    S.add.name = [id.artist, id.title].filter(Boolean).join(' ');
    S.add.code = id.barcode || id.catno || '';
    const nameEl = document.getElementById('nameq'); if (nameEl) nameEl.value = S.add.name;
    const codeEl = document.getElementById('codeq'); if (codeEl) codeEl.value = S.add.code;
    const tries = [];
    if (id.barcode) tries.push({ barcode: id.barcode });
    if (id.catno) tries.push({ catno: id.catno });
    if (id.title) tries.push({ artist: id.artist, title: id.title });
    if (id.title) tries.push({ text: S.add.name });
    await runSearch(tries, 'We read “' + S.add.name + '” but couldn’t find it in the music database.');
  }
  function focusName() { const n = document.getElementById('nameq'); if (n) n.focus(); }

  async function runSearch(tries, notFoundMsg) {
    setStage('searching');
    try {
      for (const t of tries) {
        const m = await api.search(t);
        if (m && m.length) { setStage('matches', { matches: m }); return; }
      }
      setStage(S.add.photo ? 'needName' : 'error', { msg: notFoundMsg || 'Nothing was found. Check the spelling, or try the barcode.' });
    } catch (e) { setStage('error', { msg: e.message }); }
  }

  async function pickMatch(mbid) {
    setStage('loading');
    try {
      const d = await api.details(mbid);
      const rec = { ...d, list: S.add.forList, condition: 'vgp', haveCover: null };
      await attachAddPhotos(rec);
      openEditor(rec, { isNew: true, fromLookup: true });
    } catch (e) { setStage('error', { msg: e.message }); }
  }

  // Photos taken on the Add page become the record's pictures (unless a cleaner one was found online).
  async function attachAddPhotos(rec) {
    if (S.add.photo) {
      const img = await api.saveImage(S.add.photo.dataUrl);
      rec.userPhoto = img.name; rec.photoUrl = img.url;
      if (!rec.coverFront) { rec.coverFront = img.name; rec.frontUrl = img.url; rec.coverSource = 'photo'; }
    }
    if (S.add.back && !rec.coverBack) {
      const img = await api.saveImage(S.add.back.dataUrl);
      rec.coverBack = img.name; rec.backUrl = img.url;
    }
  }

  async function openManual() {
    setStage('loading-edit');
    const rec = { list: S.add.forList, condition: 'vgp', haveCover: null, title: '', artist: '' };
    const code = (S.add.code || '').trim();
    if (code) { if (/^[\d\s-]{8,}$/.test(code)) rec.barcode = code.replace(/\D/g, ''); else rec.catno = code; }
    const parts = (S.add.name || '').split(/\s+[-–—]\s+/);
    if (parts.length === 2) { rec.artist = parts[0]; rec.title = parts[1]; } else rec.title = S.add.name || '';
    try { await attachAddPhotos(rec); } catch (e) { toast(e.message, true); }
    openEditor(rec, { isNew: true, fromLookup: false });
  }

  // ---------------- The full-page record form ----------------
  function openEditor(rec, opts) {
    S.edit = { rec: JSON.parse(JSON.stringify(rec)), isNew: !!opts.isNew, fromLookup: !!opts.fromLookup, dirty: false };
    S.edit.songsText = songsToText(S.edit.rec.tracks);
    go('edit');
  }
  function songsToText(tracks) {
    return (tracks || []).map(t => [t.pos, t.title, t.length].filter(Boolean).join('   ')).join('\n');
  }
  function textToSongs(text) {
    return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const m = /^([A-Za-z]?\d{1,2}[a-z]?)[.)]?\s+(.+?)(?:\s+(\d{1,2}:\d{2}))?$/.exec(l);
      if (m) return { side: /^[A-Za-z]/.test(m[1]) ? 'Side ' + m[1][0].toUpperCase() : '', pos: m[1], title: m[2], length: m[3] || '' };
      const t = /^(.+?)\s+(\d{1,2}:\d{2})$/.exec(l);
      return t ? { side: '', pos: '', title: t[1], length: t[2] } : { side: '', pos: '', title: l, length: '' };
    });
  }

  function editCoversHtml(r) {
    const front = safeUrl(r.frontUrl || r.photoUrl), back = safeUrl(r.backUrl);
    const src = r.coverSource === 'photo' ? 'Your own photo' : (r.frontUrl ? 'Found automatically' : '');
    return '<div class="label">Front cover</div>' +
      (front ? '<img class="cover" src="' + esc(front) + '" alt="Front cover">' : '<div class="cover cover-blank" aria-hidden="true"></div>') +
      (src ? '<div class="small muted">' + esc(src) + '</div>' : '') +
      '<div class="row">' + '<button class="btn" type="button" data-action="edit-photo" data-side="front">' + icon.folder + (front ? 'Change picture' : 'Add a picture') + '</button>' +
      (!front && r.mbid ? '<button class="btn" type="button" data-action="edit-find-cover">' + icon.refresh + 'Find it for me</button>' : '') + '</div>' +
      '<div class="label" style="margin-top:.6rem">Back cover</div>' +
      (back ? '<img class="cover back-cover" src="' + esc(back) + '" alt="Back cover">' : '<div class="cover cover-blank back-cover" aria-hidden="true"></div>') +
      '<div class="row"><button class="btn" type="button" data-action="edit-photo" data-side="back">' + icon.folder + (back ? 'Change picture' : 'Add a picture') + '</button></div>';
  }

  function editValueHtml(r) {
    const v = valueInfo(r);
    return '<div class="value-box"><div class="lbl">' + esc(v ? v.label : 'Value') + '</div>' +
      (v ? '<div class="amt">' + esc(money(v.amount)) + '</div>' : '') +
      valueNotes(r).map(t => '<div class="note">' + esc(t) + '</div>').join('') + '</div>';
  }

  function choiceGroup(key, options, current, cols) {
    return '<div class="choice-grid" style="grid-template-columns:repeat(' + (cols || options.length) + ',minmax(0,1fr))">' +
      options.map(([v, label, cls]) => '<button type="button" class="choice' + (cls ? ' ' + cls : '') + '" data-action="edit-choice" data-k="' + key + '" data-v="' + v + '" aria-pressed="' + (String(current) === v) + '">' + esc(label) + '</button>').join('') + '</div>';
  }

  function renderEdit() {
    const E = S.edit, r = E.rec;
    const field = (id, label, v, ph, full) => '<div class="field' + (full ? ' full' : '') + '"><label for="e-' + id + '">' + label + '</label>' +
      '<input id="e-' + id + '" name="' + id + '" class="input" value="' + esc(v || '') + '" placeholder="' + esc(ph || '') + '" autocomplete="off"></div>';
    const title = E.isNew ? (E.fromLookup ? 'Check the details, then save' : 'Type in the details') : 'Edit record';
    const sub = E.isNew && E.fromLookup ? 'We filled in what we found. Change anything that isn’t right.' : 'Fill in what you know. Only the album name is needed.';
    main.innerHTML = '<form data-form="edit" class="editor" novalidate>' +
      '<div class="page-head"><div><h1>' + esc(title) + '</h1><div class="sub">' + esc(sub) + ' Nothing is saved until you press <strong>Save</strong>.</div></div></div>' +
      '<div class="editor-grid">' +
      '<section class="edit-covers" id="e-covers">' + editCoversHtml(r) + '</section>' +
      '<div class="edit-main">' +
      '<section class="edit-section"><h2>About the record</h2><div class="fields">' +
      field('title', 'Album name', r.title, 'For example: Elvis', true) + field('artist', 'Artist or band', r.artist, 'For example: Elvis Presley', true) +
      field('year', 'Year', r.year, 'For example: 1956') + field('country', 'Country', r.country, 'For example: US') +
      field('label', 'Record label', r.label, 'For example: RCA Victor') + field('catno', 'Catalog number', r.catno, 'On the spine or centre label') +
      field('barcode', 'Barcode', r.barcode, 'Newer records only') + field('format', 'Format', r.format, 'For example: 12" Vinyl') +
      '</div></section>' +
      '<section class="edit-section"><h2>Where does it go?</h2>' + choiceGroup('list', [['collection', 'My records'], ['wish', 'My wish list']], r.list || 'collection') + '</section>' +
      '<section class="edit-section" id="e-cover-q"' + (r.list === 'wish' ? ' hidden' : '') + '><h2>Do I have the cover for this record?</h2>' +
      choiceGroup('haveCover', [['true', 'Yes, I have it', 'have'], ['false', 'No, I need one', 'need'], ['null', 'Not sure']], r.haveCover === true ? 'true' : r.haveCover === false ? 'false' : 'null') + '</section>' +
      '<section class="edit-section"><h2>What shape is the record in?</h2>' + choiceGroup('condition', COND.map(c => [c.id, c.label]), r.condition || 'vgp', 4) + '</section>' +
      '<section class="edit-section"><h2>Value</h2><div id="e-value">' + editValueHtml(r) + '</div>' +
      '<div class="row">' + (S.settings.hasDiscogs ? '<button class="btn primary" type="button" data-action="edit-check-value">' + icon.refresh + 'Check the value now</button>' : '<button class="btn" type="button" data-view="settings">Set up values in Settings</button>') + '</div>' +
      '<div class="field"><label for="e-myValue">Or type your own value</label><input id="e-myValue" name="myValue" class="input money" value="' + esc(r.myValue || '') + '" placeholder="$" inputmode="decimal" autocomplete="off">' +
      '<div class="small muted">If you type a value here, it is used instead of the Discogs price.</div></div></section>' +
      '<section class="edit-section"><h2>My notes</h2><div class="fields">' + field('paid', 'What I paid', r.paid, 'For example: $4 at a yard sale', true) +
      '<div class="field full"><label for="e-notes">Notes</label><textarea id="e-notes" name="notes" class="input" placeholder="Where I got it, who gave it to me, any scratches…">' + esc(r.notes || '') + '</textarea></div></div></section>' +
      '<section class="edit-section"><h2>Songs</h2><div class="field"><label for="e-songs">One song per line. You can start a line with its side and number, like <strong>A1</strong>, and end it with the length, like <strong>3:12</strong>.</label>' +
      '<textarea id="e-songs" name="songs" class="input songs-box" placeholder="A1  Heartbreak Hotel  2:08">' + esc(E.songsText) + '</textarea></div></section>' +
      '</div></div>' +
      '<div class="save-bar"><span class="muted" id="e-dirty"></span>' +
      '<button class="btn tall" type="button" data-action="edit-cancel">Cancel</button>' +
      '<button class="btn yellow tall" type="submit">' + icon.check + 'Save</button></div></form>';
    main.scrollTop = 0;
    const t = document.getElementById('e-title'); if (t && !r.title) t.focus();
  }

  function readEditForm() {
    const E = S.edit, r = E.rec, f = main.querySelector('form[data-form="edit"]');
    if (!f) return r;
    for (const k of ['title', 'artist', 'year', 'country', 'label', 'catno', 'barcode', 'format', 'paid', 'notes', 'myValue']) {
      const el = f.elements[k]; if (el) r[k] = el.value.trim();
    }
    const songs = f.elements.songs ? f.elements.songs.value : E.songsText;
    if (songs.trim() !== E.songsText.trim()) { r.tracks = textToSongs(songs); E.songsText = songs; }
    return r;
  }
  function refreshEditValue() { const box = document.getElementById('e-value'); if (box && S.edit) box.innerHTML = editValueHtml(S.edit.rec); }
  function markDirty() { if (S.edit) { S.edit.dirty = true; const d = document.getElementById('e-dirty'); if (d) d.textContent = 'Not saved yet'; } }

  async function saveEditor() {
    const r = readEditForm();
    if (!r.title) { toast('Please type the album name.', true); const t = document.getElementById('e-title'); if (t) t.focus(); return; }
    if (r.myValue && !parseMoney(r.myValue)) { toast('The value should be a number, like 25 or $25.', true); return; }
    try {
      const saved = await saveRec(r);
      const wasNew = S.edit.isNew;
      S.edit = null;
      if (wasNew) S.add = freshAdd();
      S.selId = saved.id; S.side = 'front'; S.filter = 'all'; S.q = '';
      toast(wasNew ? (saved.list === 'wish' ? 'Added to your wish list' : 'Added to your records') : 'Saved');
      go(saved.list === 'wish' ? 'wish' : 'records');
    } catch (e) { toast(e.message, true); }
  }

  async function cancelEditor() {
    const E = S.edit;
    if (E && (E.dirty || E.isNew) && !(await confirmBox(E.isNew ? 'Leave without adding this record?' : 'Leave without saving your changes?', 'Yes, leave', 'No, stay here'))) return;
    const back = E && E.isNew ? 'add' : (E && E.rec.list === 'wish' ? 'wish' : 'records');
    S.edit = null;
    if (back === 'add' && S.add.stage === 'loading-edit') S.add.stage = 'start';
    go(back);
  }

  // ---------------- Value report ----------------
  function renderReport() {
    const rs = S.records.filter(r => r.list !== 'wish').sort((a, b) => sortName(a.artist).localeCompare(sortName(b.artist)) || sortName(a.title).localeCompare(sortName(b.title)));
    const total = rs.reduce((t, r) => t + (amountFor(r) || 0), 0);
    const priced = rs.filter(r => amountFor(r) != null).length;
    const need = rs.filter(r => r.haveCover === false).length;
    const wish = S.records.filter(r => r.list === 'wish').length;
    main.innerHTML =
      '<div class="page-head"><div><h1>Value report</h1><div class="sub">Prepared ' + esc(dateText(new Date().toISOString())) + '</div></div>' +
      '<div class="row no-print">' + (S.settings.hasDiscogs ? '<button class="btn blue-line" data-action="update-all" id="update-all">' + icon.refresh + (S.updating ? 'Stop checking' : 'Update all values') + '</button>' : '') +
      '<button class="btn primary" data-action="print">Print</button><button class="btn" data-action="pdf">Save as PDF</button>' +
      '<button class="btn" data-action="csv">Save as a spreadsheet</button></div></div>' +
      '<div class="stats"><div class="stat"><div class="n">' + rs.length + '</div><div class="l">records</div></div>' +
      '<div class="stat"><div class="n">' + esc(money(total) || '$0') + '</div><div class="l">total value (' + priced + ' with a value)</div></div>' +
      '<div class="stat"><div class="n">' + need + '</div><div class="l">still need a cover</div></div>' +
      '<div class="stat"><div class="n">' + wish + '</div><div class="l">on the wish list</div></div></div>' +
      (rs.length ? '<div style="overflow-x:auto"><table class="report-table"><thead><tr><th>Artist</th><th>Album</th><th>Year</th><th>Label and number</th><th>Shape</th><th>Cover</th><th class="num">Value</th></tr></thead><tbody>' +
        rs.map(r => '<tr><td>' + esc(r.artist) + '</td><td>' + esc(r.title) + '</td><td>' + esc(r.year) + '</td><td>' + esc([r.label, r.catno].filter(Boolean).join(' ')) +
          '</td><td>' + esc(condLabel(r.condition)) + '</td><td>' + (r.haveCover === true ? 'Have it' : r.haveCover === false ? 'Need one' : '—') +
          '</td><td class="num">' + esc(amountFor(r) != null ? money(amountFor(r)) : '—') + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="6">Total</td><td class="num">' + esc(money(total) || '$0') + '</td></tr></tfoot></table></div>' +
        '<p class="muted small">Values are estimates from Discogs sales, checked on the dates shown in each record. They are a guide, not an appraisal.</p>'
        : '<p class="muted">No records yet.</p>');
  }
  function csv() {
    const cell = v => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const head = ['Artist', 'Album', 'Year', 'Label', 'Catalog number', 'Barcode', 'Country', 'List', 'Shape', 'Have cover', 'Value (USD)', 'Value checked', 'What I paid', 'Notes', 'Added'];
    const rows = S.records.map(r => [r.artist, r.title, r.year, r.label, r.catno, r.barcode, r.country, r.list === 'wish' ? 'Wish list' : 'My records',
      condLabel(r.condition), r.haveCover === true ? 'Yes' : r.haveCover === false ? 'No' : '', amountFor(r) != null ? amountFor(r) : '',
      r.prices && r.prices.checkedAt ? dateText(r.prices.checkedAt) : '', r.paid, r.notes, dateText(r.addedAt)]);
    return [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  }

  // ---------------- Settings ----------------
  function renderSettings() {
    const s = S.settings;
    const status = on => '<span class="key-status ' + (on ? 'on' : 'off') + '">' + (on ? 'Turned on' : 'Not set up yet') + '</span>';
    main.innerHTML = '<div class="page-head"><h1>Settings</h1></div>' +
      '<section class="panel"><h2>Text size</h2><div class="choice-grid" style="grid-template-columns:repeat(3,1fr)">' +
      [[1, 'Normal'], [2, 'Large'], [3, 'Extra large']].map(([n, l]) => '<button class="choice" data-action="text-size" data-v="' + n + '" aria-pressed="' + ((s.textSize || 2) === n) + '">' + l + '</button>').join('') +
      '</div><p class="muted">You can also hold Ctrl and press + or − to zoom.</p></section>' +

      '<section class="panel"><h2>Record values (Discogs)</h2><div>' + status(s.hasDiscogs) + '</div>' +
      '<p>Values come from real sales on Discogs, the biggest record marketplace. It needs a free personal key:</p>' +
      '<ol style="margin:0;padding-left:1.4rem;font-size:1.05rem"><li>Make a free account at Discogs.</li><li>Open <a class="link" href="#" data-action="open" data-url="https://www.discogs.com/settings/developers">Discogs › Settings › Developers</a> and press <strong>Generate new token</strong>.</li><li>Copy the token and paste it below.</li></ol>' +
      '<form data-form="discogs" class="row"><label for="dkey" hidden>Discogs token</label><input id="dkey" type="password" class="input" style="flex:1 1 18rem" placeholder="' + (s.hasDiscogs ? 'Saved. Paste a new one to replace it.' : 'Paste your Discogs token here') + '" autocomplete="off">' +
      '<button class="btn primary" type="submit">Save</button>' + (s.hasDiscogs ? '<button class="btn" type="button" data-action="clear-key" data-id="discogsToken">Remove</button>' : '') + '</form>' +
      (s.hasDiscogs ? '<div class="row"><button class="btn blue-line" data-action="test-discogs">' + icon.check + 'Test my Discogs key</button></div><div id="dtest" aria-live="polite"></div>' : '') +
      '<p class="muted">For a value that matches each record’s condition, Discogs also asks you to fill in <a class="link" href="#" data-action="open" data-url="https://www.discogs.com/settings/seller">Seller Settings</a> once (you never have to sell anything). Until then, the app shows the cheapest copy for sale.</p></section>' +

      '<section class="panel"><h2>Read photos automatically (optional)</h2><div>' + status(s.hasClaude) + '</div>' +
      '<p>With this turned on, a photo of a cover is enough: Claude reads the name and catalog number for you. It needs an Anthropic API key from the Claude Console, and each photo costs a small amount (usually around a cent).</p>' +
      '<p class="muted">Without it, photos are still saved as covers and you type the name or barcode instead.</p>' +
      '<form data-form="claude" class="row"><label for="ckey" hidden>Anthropic API key</label><input id="ckey" type="password" class="input" style="flex:1 1 18rem" placeholder="' + (s.hasClaude ? 'Saved. Paste a new one to replace it.' : 'Paste your Anthropic API key here') + '" autocomplete="off">' +
      '<button class="btn primary" type="submit">Save</button>' + (s.hasClaude ? '<button class="btn" type="button" data-action="clear-key" data-id="anthropicKey">Remove</button>' : '') + '</form>' +
      '<p class="small muted">Keys are kept on this computer only, locked with Windows’ own protection, and are never put in backups.</p></section>' +

      '<section class="panel"><h2>Keep my collection safe</h2><p>Make a backup now and then, for example onto a USB stick.</p>' +
      '<div class="row"><button class="btn primary" data-action="backup">Back up my collection</button><button class="btn" data-action="restore">Restore from a backup</button>' +
      '<button class="btn" data-action="data-folder">Show where it is saved</button><button class="btn" data-action="open-log">Open the look-up log</button></div>' +
      '<p class="small muted">Saved in: ' + esc(s.dataDir || '') + '</p></section>' +
      '<p class="small muted">Killion\'s Record Shelf ' + esc(S.version) + '. Record details from MusicBrainz and the Cover Art Archive; values from Discogs.</p>';
  }

  // ---------------- Help ----------------
  function renderHelp() {
    const qa = [
      ['How do I add a record?', 'Press "Add a record" on the left. Drag a photo of the cover into the blue box, choose one from your computer, or hold the cover up to the webcam. You can also just type the name, or the barcode from the back.'],
      ['Why does it show several versions?', 'Most records were pressed many times, in different years and countries. Pick the one whose label, year and catalog number match yours. The catalog number is usually on the spine and the centre label.'],
      ['Where do the cover pictures come from?', 'They are found automatically in a free online library of album covers. If there isn’t one, your own photo is used. You can always press "Use my own photo" to change it.'],
      ['How do I mark that I have the cover?', 'Click a record, then press "Yes, I have it" or "No, I need one". Press "Need a cover" at the top of My Records to see every record that still needs one.'],
      ['How is the value worked out?', 'From Discogs, the biggest record marketplace. Best is its price for the shape you chose (this needs Seller Settings filled in on the Discogs account). Otherwise it shows the cheapest copy for sale now, or the cheapest copy of any version of that album. You can always type your own value instead. Values are a guide, not an appraisal.'],
      ['How do I change a record\u2019s details?', 'Click the record, then press "Edit all the details". Change anything you like, then press the yellow Save button at the bottom. Nothing changes until you press Save.'],
      ['A record has no value. What can I do?', 'Open Settings and press "Test my Discogs key". Then click the record, press "Edit all the details", check the album name and artist, and press "Check the value now". If nobody is selling it, type your own value.'],
      ['The words are too small.', 'Press "A +" at the bottom left, or choose Extra large in Settings.'],
      ['Can it read a record out loud?', 'Yes. Click a record and press "Read it to me".'],
      ['How do I keep my collection safe?', 'Go to Settings and press "Back up my collection". Put the backup on a USB stick.']
    ];
    main.innerHTML = '<div class="page-head"><h1>Help</h1></div><section class="panel">' +
      qa.map(([q, a]) => '<div><p class="help-q">' + esc(q) + '</p><p class="help-a">' + esc(a) + '</p></div>').join('') + '</section>';
  }

  // ---------------- clicks ----------------
  const actions = {
    'go-add': el => { S.add = freshAdd(); S.add.forList = el.dataset.list || 'collection'; go('add'); },
    'filter': el => { S.filter = el.dataset.id; renderShelf(); },
    'select': el => { S.selId = el.dataset.id; S.side = 'front'; stopSpeaking(); document.querySelectorAll('.tile').forEach(t => t.setAttribute('aria-pressed', String(t.dataset.id === S.selId))); renderDetail();
      const d = document.getElementById('detail'); if (d && d.getBoundingClientRect().top > window.innerHeight * 0.6) d.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
    'side': el => { S.side = el.dataset.id; renderDetail(); },
    'own-photo': el => choosePhoto({ type: 'detail', id: el.dataset.id, side: S.side }),
    'find-cover': async el => {
      const r = byId(el.dataset.id); if (!r) return;
      toast('Looking for the picture…');
      try {
        const c = await api.fetchCover(r);
        if (c && (c.coverFront || c.coverBack)) {
          await saveRec({ ...r, coverFront: c.coverFront || r.coverFront, coverBack: c.coverBack || r.coverBack, coverSource: c.coverFront ? 'auto' : r.coverSource });
          toast('Picture found'); renderGrid();
        } else toast('No picture could be found. You can use your own photo.', true);
      } catch (e) { toast(e.message, true); }
    },
    'have': async el => {
      const r = byId(el.dataset.id); if (!r) return;
      await saveRec({ ...r, haveCover: el.dataset.v === 'yes' });
      renderShelf();
    },
    'condition': async el => {
      const r = byId(el.dataset.id); if (!r) return;
      await saveRec({ ...r, condition: el.dataset.v });
      renderShelf();
    },
    'refresh-value': async el => {
      const r = byId(el.dataset.id); if (!r) return;
      el.disabled = true; el.lastChild.textContent = 'Checking…';
      try {
        const p = await api.prices(r);
        await saveRec({ ...r, prices: p.prices || r.prices, discogsId: p.discogsId || r.discogsId });
        toast(p.prices ? 'Value updated' : 'No recent sales found');
      } catch (e) { toast(e.message, true); }
      renderShelf();
    },
    'open': el => api.openExternal(el.dataset.url),
    'speak': el => { const r = byId(el.dataset.id); if (r) speak(r); },
    'got-it': async el => {
      const r = byId(el.dataset.id); if (!r) return;
      await saveRec({ ...r, list: 'collection', addedAt: new Date().toISOString() });
      S.selId = r.id; toast('Moved to your records'); go('records');
    },
    'relookup': async el => {
      const r = byId(el.dataset.id); if (!r || !r.mbid) return;
      toast('Looking it up again…');
      try {
        const d = await api.details(r.mbid);
        const keepOwn = r.coverSource === 'photo';
        await saveRec({ ...r, title: d.title || r.title, artist: d.artist || r.artist, year: d.year || r.year, label: d.label || r.label, catno: d.catno || r.catno,
          country: d.country || r.country, format: d.format || r.format, tracks: d.tracks.length ? d.tracks : r.tracks, credits: d.credits.length ? d.credits : r.credits,
          discogsId: d.discogsId || r.discogsId, prices: d.prices || r.prices,
          coverFront: keepOwn ? r.coverFront : (d.coverFront || r.coverFront), coverBack: d.coverBack || r.coverBack,
          coverSource: keepOwn ? 'photo' : (d.coverFront ? 'auto' : r.coverSource) });
        toast('Updated'); renderShelf();
      } catch (e) { toast(e.message, true); }
    },
    'delete': async el => {
      const r = byId(el.dataset.id); if (!r) return;
      if (!(await confirmBox('Remove “' + (r.title || 'this record') + '” from your records? This can’t be undone.', 'Yes, remove it', 'No, keep it'))) return;
      try { await api.deleteRecord(r.id); S.records = S.records.filter(x => x.id !== r.id); toast('Removed'); renderShelf(); } catch (e) { toast(e.message, true); }
    },
    // add a record
    'for-list': el => { S.add.forList = el.dataset.id; renderAdd(); },
    'pick-photo': () => choosePhoto({ type: 'add-front' }),
    'pick-back': () => choosePhoto({ type: 'add-back' }),
    'webcam': () => webcam({ type: 'add-front' }),
    'pick-match': el => pickMatch(el.dataset.id),
    'manual': () => openManual(),
    'edit': el => { const r = byId(el.dataset.id); if (r) openEditor(r, { isNew: false }); },
    'edit-choice': el => {
      const k = el.dataset.k, raw = el.dataset.v;
      const v = k === 'haveCover' ? (raw === 'true' ? true : raw === 'false' ? false : null) : raw;
      S.edit.rec[k] = v; markDirty();
      el.parentElement.querySelectorAll('.choice').forEach(b => b.setAttribute('aria-pressed', String(b === el)));
      if (k === 'list') { const q = document.getElementById('e-cover-q'); if (q) q.hidden = v === 'wish'; }
      if (k === 'condition') refreshEditValue();
    },
    'edit-photo': el => choosePhoto({ type: 'edit', side: el.dataset.side }),
    'edit-find-cover': async () => {
      const r = readEditForm();
      toast('Looking for the picture…');
      try {
        const c = await api.fetchCover(r);
        if (c && (c.coverFront || c.coverBack)) {
          if (c.coverFront) { r.coverFront = c.coverFront; r.frontUrl = c.frontUrl; r.coverSource = 'auto'; }
          if (c.coverBack && !r.coverBack) { r.coverBack = c.coverBack; r.backUrl = c.backUrl; }
          markDirty(); document.getElementById('e-covers').innerHTML = editCoversHtml(r); toast('Picture found');
        } else toast('No picture could be found. You can add your own photo.', true);
      } catch (e) { toast(e.message, true); }
    },
    'edit-check-value': async el => {
      const r = readEditForm();
      if (!r.title) { toast('Please type the album name first.', true); return; }
      el.disabled = true; el.lastChild.textContent = 'Checking…';
      try {
        const p = await api.prices(r);
        r.prices = p.prices; r.discogsId = p.discogsId || r.discogsId; markDirty();
        toast(valueInfo(r) ? 'Value found' : 'No value found');
      } catch (e) { toast(e.message, true); }
      el.disabled = false; el.lastChild.textContent = 'Check the value now';
      refreshEditValue();
    },
    'edit-cancel': () => cancelEditor(),
    'add-reset': () => { const l = S.add.forList; S.add = freshAdd(); S.add.forList = l; renderAdd(); },
    // report
    'update-all': async () => {
      if (S.updating) { S.updating = false; return; }
      const list = S.records.filter(r => !parseMoney(r.myValue));
      if (!list.length) { toast('Nothing to check.'); return; }
      S.updating = true; renderReport();
      let found = 0, i = 0;
      for (const r of list) {
        if (!S.updating) break;
        i++;
        const b = document.getElementById('update-all');
        if (b) b.lastChild.textContent = 'Stop checking (' + i + ' of ' + list.length + ')';
        try {
          const p = await api.prices(r);
          const cur = byId(r.id) || r;
          await saveRec({ ...cur, prices: p.prices || cur.prices, discogsId: p.discogsId || cur.discogsId });
          if (valueInfo(byId(r.id))) found++;
        } catch (e) { toast(e.message, true); if (/key|internet/i.test(e.message)) break; }
        await new Promise(res => setTimeout(res, 4000)); // stay well inside Discogs' limit of 60 look-ups a minute
      }
      S.updating = false;
      toast('Checked ' + i + ' records. ' + found + ' have a value.');
      if (S.view === 'report') renderReport();
    },
    'print': () => api.reportPrint().catch(e => toast(e.message, true)),
    'pdf': async () => { try { const p = await api.reportPdf(); if (p) toast('Saved the report'); } catch (e) { toast(e.message, true); } },
    'csv': async () => { try { const p = await api.exportCsv(csv()); if (p) toast('Saved the spreadsheet'); } catch (e) { toast(e.message, true); } },
    // settings
    'text-smaller': () => setTextSize((S.settings.textSize || 2) - 1),
    'text-bigger': () => setTextSize((S.settings.textSize || 2) + 1),
    'text-size': el => setTextSize(Number(el.dataset.v)),
    'clear-key': async el => {
      try { S.settings = await api.saveSettings({ [el.dataset.id]: '' }); toast('Key removed'); renderSettings(); } catch (e) { toast(e.message, true); }
    },
    'backup': async () => { try { const p = await api.backup(); if (p) toast('Backup saved'); } catch (e) { toast(e.message, true); } },
    'restore': async () => {
      if (!(await confirmBox('Restoring replaces the records on this computer with the ones in the backup. Go ahead?', 'Yes, restore', 'Cancel'))) return;
      try { const n = await api.restore(); if (n != null) { toast('Restored ' + n + ' records'); await load(); } } catch (e) { toast(e.message, true); }
    },
    'data-folder': () => api.openDataFolder(),
    'open-log': () => api.openLog(),
    'test-discogs': async el => {
      const out = document.getElementById('dtest');
      el.disabled = true;
      out.innerHTML = '<p class="muted">Testing…</p>';
      try {
        const t = await api.testDiscogs();
        out.innerHTML = '<p><span class="key-status on">The key works</span>' + (t.username ? ' (Discogs account: ' + esc(t.username) + ')' : '') + '.</p>' +
          (t.conditionPrices ? '<p><span class="key-status on">Values by condition are turned on.</span></p>'
            : '<p><span class="key-status off">Values by condition are not available yet.</span> Fill in Seller Settings on Discogs (link below), then test again. Until then you’ll see the cheapest copy for sale.</p>');
      } catch (e) { out.innerHTML = '<p><span class="key-status off">' + esc(e.message) + '</span></p>'; }
      el.disabled = false;
    }
  };

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-view]');
    if (nav) {
      e.preventDefault();
      if (S.view === 'edit' && S.edit && S.edit.dirty) {
        confirmBox('Leave without saving your changes?', 'Yes, leave', 'No, stay here').then(ok => { if (ok) { S.edit = null; go(nav.dataset.view); } });
        return;
      }
      if (S.view === 'edit') S.edit = null;
      go(nav.dataset.view); return;
    }
    const el = e.target.closest('[data-action]');
    if (!el || modalWrap.contains(el)) return;
    e.preventDefault();
    const fn = actions[el.dataset.action];
    if (fn) Promise.resolve(fn(el)).catch(err => toast(err.message, true));
  });

  document.addEventListener('submit', async e => {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    if (kind === 'name') {
      const t = form.querySelector('input').value.trim();
      S.add.name = t;
      if (!t) { toast('Please type the artist and album.', true); return; }
      const parts = t.split(/\s+[-–—]\s+/);
      const tries = parts.length === 2 ? [{ artist: parts[0], title: parts[1] }, { text: t }] : [{ text: t }];
      await runSearch(tries);
    } else if (kind === 'code') {
      const c = form.querySelector('input').value.trim();
      S.add.code = c;
      if (!c) { toast('Please type the barcode or catalog number.', true); return; }
      const digits = c.replace(/\D/g, '');
      const tries = digits.length >= 8 && digits.length === c.replace(/[\s-]/g, '').length ? [{ barcode: digits }, { catno: c }] : [{ catno: c }, { text: c }];
      await runSearch(tries, 'Nothing was found for that number. Check it, or type the name instead.');
    } else if (kind === 'edit') {
      await saveEditor();
    } else if (kind === 'discogs' || kind === 'claude') {
      const v = form.querySelector('input').value.trim();
      if (!v) { toast('Please paste the key first.', true); return; }
      try {
        S.settings = await api.saveSettings(kind === 'discogs' ? { discogsToken: v } : { anthropicKey: v });
        toast('Key saved'); renderSettings();
      } catch (err) { toast(err.message, true); }
    }
  });

  main.addEventListener('input', e => {
    if (e.target.id === 'q') { S.q = e.target.value; renderGrid(); }
    if (S.view === 'edit' && e.target.closest('form[data-form="edit"]')) {
      markDirty();
      if (e.target.id === 'e-myValue') { S.edit.rec.myValue = e.target.value; refreshEditValue(); }
    }
  });
  main.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'sort') { S.sort = t.value; renderGrid(); return; }
    if (t.dataset && t.dataset.field) {
      const r = byId(t.dataset.id); if (!r) return;
      try { await saveRec({ ...r, [t.dataset.field]: t.value }); toast('Saved'); } catch (err) { toast(err.message, true); }
    }
  });
  // Hide search thumbnails that have no picture.
  main.addEventListener('error', e => {
    if (e.target.tagName === 'IMG' && e.target.hasAttribute('data-hide-broken')) e.target.style.visibility = 'hidden';
  }, true);

  load();
}
