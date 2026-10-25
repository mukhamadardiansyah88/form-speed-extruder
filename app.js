/* ============================================================
   APP — Logic Form Speed Extruder
   ============================================================
   - Sumber kebenaran data = GAS (getData per Tanggal+Shift).
   - Simpan per aksi: tambahBanyak / editData / hapusData.
   - Tombol Simpan global = batch pending, 1 request (tambahBanyak).
   - UI kaku: overlay tidak menutup saat klik luar / Escape.
   - Beep sukses/gagal saat cari SPK.
   - Loading sync = overlay full screen (neon).
   - Rangkuman mesin aktif per jenis (PP/PE/HD) + total.
   - Debounce cariSPK (400ms).
   - Validasi satuan instan; validasi Min/Max ditunda 800ms.
   ============================================================ */

(function () {

  /* ------------------------------------------------------------
     STATE GLOBAL
     ------------------------------------------------------------ */
  let daftarMesin = [];
  let kategoriMesin = {};
  let hasilInput = {};
  let pendingInput = {};

  let currentMesin = null;
  let currentKategori = null;
  let currentSPKData = null;
  let currentSPKValid = false;
  let toastTimer = null;
  let lookupSeq = 0;
  let lookupDebounceTimer = null;
  let speedDebounceTimer = null;
  let satuanDebounceTimer = null;

  let currentMesinInfo = { satuan: '', minSpeed: null, maxSpeed: null };
  let speedError = false;
  let speedWarning = false;
  let lastSpeedStatus = 'none';

  let formMode = 'tambah';
  let editId = null;
  let pendingEditIndex = null;
  let formOriginList = false;

  let listMesin = null;

  let confirmId = null;
  let confirmMesin = null;
  let pendingDeleteIndex = null;

  let isSyncing = false;

  let lastRangkuman = { pp: -1, pe: -1, hd: -1, total: -1 };
  let lastSummaryText = '';

  const RENTANG_SATUAN = {
    'persnelleng': { min: 1, max: 4, label: '1–4' },
    'hz':          { min: 4.0001, max: 60, label: '4,0001–60' },
    'rpm':         { min: 60.0001, max: 1800, label: '60,0001–1800' }
  };

  /* ------------------------------------------------------------
     UTIL
     ------------------------------------------------------------ */
  function $(id) { return document.getElementById(id); }

  function showToast(msg, type) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.remove('error', 'success');
    if (type === 'error') t.classList.add('error');
    if (type === 'success') t.classList.add('success');
    t.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  function getTahunDariTanggal() {
    const val = $('tanggal').value;
    if (val && val.length >= 4) return val.substring(0, 4);
    return String(CONFIG.DEFAULT_TAHUN || new Date().getFullYear());
  }

  function getTanggalShift() {
    return { tanggal: $('tanggal').value, shift: $('shift').value };
  }

  function speedKeAngka(str) {
    if (str == null) return null;
    const s = String(str).trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  function vibrate() {
    if (navigator.vibrate) {
      try { navigator.vibrate([300, 100, 300, 100, 500, 200, 100, 300]); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------
     BEEP (WebAudio)
     ------------------------------------------------------------ */
  function playBeepSuccess() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const t0 = ctx.currentTime;
      const notes = [
        { f: 660,  t: 0 },
        { f: 880,  t: 0.06 },
        { f: 1100, t: 0.12 },
        { f: 1320, t: 0.18 }
      ];
      notes.forEach(function (n) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = n.f;
        g.gain.setValueAtTime(0.0001, t0 + n.t);
        g.gain.exponentialRampToValueAtTime(0.55, t0 + n.t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + 0.11);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0 + n.t);
        o.stop(t0 + n.t + 0.12);
      });
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 700);
    } catch (e) { console.warn('Beep sukses gagal:', e); }
  }

  function beepFailOnce() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const t0 = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(400, t0);
      o.frequency.setValueAtTime(200, t0 + 0.09);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.8, t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.19);
      o.onended = function () { try { ctx.close(); } catch (e) {} };
    } catch (e) { console.warn('Beep gagal gagal:', e); }
  }

  function playBeepFail() {
    beepFailOnce();
    setTimeout(beepFailOnce, 230);
  }

  /* ------------------------------------------------------------
     JSONP CALL KE GAS
     ------------------------------------------------------------ */
  function callGAS(params) {
    return new Promise(function (resolve, reject) {
      const cbName = 'jsonp_cb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      const script = document.createElement('script');

      let done = false;
      let timeoutId = null;

      function cleanup() {
        if (done) return;
        done = true;
        if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script) {
          script.onload = null;
          script.onerror = null;
          if (script.parentNode) script.parentNode.removeChild(script);
        }
      }

      window[cbName] = function (data) { cleanup(); resolve(data); };

      const qs = new URLSearchParams(params).toString();
      const url = CONFIG.GAS_URL + '?callback=' + encodeURIComponent(cbName) + '&' + qs;

      script.src = url;
      script.onerror = function () {
        cleanup();
        reject(new Error('JSONP gagal — cek koneksi atau URL GAS'));
      };
      script.onload = function () {
        if (!done) { cleanup(); reject(new Error('Response GAS tidak memanggil callback')); }
      };

      document.body.appendChild(script);

      timeoutId = setTimeout(function () {
        if (!done) { cleanup(); reject(new Error('JSONP timeout')); }
      }, 12000);
    });
  }

  /* ------------------------------------------------------------
     INIT
     ------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    initTanggal();
    initShift();
    initFooterTahun();
    ensureSyncOverlay();
    bindEvents();
    loadDaftarMesin();
  });

  function initTanggal() {
    const el = $('tanggal');
    if (!el) return;
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    el.value = yyyy + '-' + mm + '-' + dd;
  }

  function initShift() {
    const el = $('shift');
    if (el) el.value = 'SHIFT-PAGI';
  }

  function initFooterTahun() {
    const el = $('footerTahun');
    if (el) el.textContent = new Date().getFullYear();
  }

  /* ------------------------------------------------------------
     SYNC OVERLAY
     ------------------------------------------------------------ */
  function ensureSyncOverlay() {
    if ($('syncOverlay')) return;
    const ov = document.createElement('div');
    ov.id = 'syncOverlay';
    ov.className = 'sync-overlay';
    ov.innerHTML =
      '<div class="sync-spinner">' +
        '<div class="ring r1"></div>' +
        '<div class="ring r2"></div>' +
        '<div class="ring r3"></div>' +
      '</div>' +
      '<div class="sync-text">Memuat Data</div>';
    document.body.appendChild(ov);
  }

  function showSyncLoading() {
    isSyncing = true;
    ensureSyncOverlay();
    const ov = $('syncOverlay');
    if (ov) ov.classList.add('active');
    document.querySelectorAll('.mesin-btn').forEach(function (b) { b.disabled = true; });
    const summary = $('summary');
    if (summary) { summary.textContent = 'Memuat data...'; lastSummaryText = summary.textContent; }
  }

  function hideSyncLoading() {
    isSyncing = false;
    const ov = $('syncOverlay');
    if (ov) ov.classList.remove('active');
    document.querySelectorAll('.mesin-btn').forEach(function (b) { b.disabled = false; });
  }

  /* ------------------------------------------------------------
     BIND EVENTS
     ------------------------------------------------------------ */
  function bindEvents() {
    const btnCloseInput = $('btnCloseInput');
    if (btnCloseInput) btnCloseInput.addEventListener('click', closeInputOverlay);

    const btnCancelInput = $('btnCancelInput');
    if (btnCancelInput) btnCancelInput.addEventListener('click', closeInputOverlay);

    const btnOk = $('btnOk');
    if (btnOk) btnOk.addEventListener('click', onOk);

    const btnScan = $('btnScan');
    if (btnScan) btnScan.addEventListener('click', openScanner);

    const spkInput = $('spkInput');
    if (spkInput) {
      spkInput.addEventListener('input', onSPKInputChange);
      spkInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); flushSPKLookup(); }
      });
    }

    const speedInput = $('speedInput');
    if (speedInput) speedInput.addEventListener('input', onSpeedChange);

    const btnSimpan = $('btnSimpan');
    if (btnSimpan) btnSimpan.addEventListener('click', onSimpan);

    const tanggal = $('tanggal');
    if (tanggal) tanggal.addEventListener('change', onKontrolChange);

    const shift = $('shift');
    if (shift) shift.addEventListener('change', onKontrolChange);

    const btnCloseList = $('btnCloseList');
    if (btnCloseList) btnCloseList.addEventListener('click', closeListOverlay);

    const btnTambahBaris = $('btnTambahBaris');
    if (btnTambahBaris) btnTambahBaris.addEventListener('click', onTambahBarisClick);

    const btnCloseConfirm = $('btnCloseConfirm');
    if (btnCloseConfirm) btnCloseConfirm.addEventListener('click', closeConfirmOverlay);

    const btnCancelConfirm = $('btnCancelConfirm');
    if (btnCancelConfirm) btnCancelConfirm.addEventListener('click', closeConfirmOverlay);

    const btnYesConfirm = $('btnYesConfirm');
    if (btnYesConfirm) btnYesConfirm.addEventListener('click', onHapusConfirmed);
  }

  /* ------------------------------------------------------------
     LOAD DAFTAR MESIN
     ------------------------------------------------------------ */
  function loadDaftarMesin() {
    const container = $('mesinContainer');
    if (container) {
      container.innerHTML =
        '<div class="loading-wrap"><span class="loading"></span> Memuat daftar mesin...</div>';
    }

    callGAS({ action: 'getMesin' })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.error) || 'Gagal memuat mesin.');
        daftarMesin = res.data || [];
        buildKategoriMap();
        renderMesin();
        syncData();
      })
      .catch(function (err) {
        if (container) {
          container.innerHTML =
            '<div class="loading-wrap" style="color:#ff6b8a;">Gagal memuat mesin: ' +
            (err && err.message ? err.message : err) + '</div>';
        }
      });
  }

  function buildKategoriMap() {
    kategoriMesin = {};
    daftarMesin.forEach(function (nama) {
      const kode = nama.substring(0, 2).toUpperCase();
      let kat = '';
      if (kode === 'PP') kat = 'PP';
      else if (kode === 'PE') kat = 'PE';
      else if (kode === 'HD') kat = 'HD';
      else kat = 'LAIN';
      kategoriMesin[nama] = kat;
    });
  }

  /* ------------------------------------------------------------
     SYNC DATA
     ------------------------------------------------------------ */
  function syncData() {
    const ctx = getTanggalShift();
    if (!ctx.tanggal || !ctx.shift) return;

    showSyncLoading();

    callGAS({ action: 'getData', tanggal: ctx.tanggal, shift: ctx.shift })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.error) || 'Gagal memuat data.');
        const data = res.data || [];

        hasilInput = {};
        data.forEach(function (row) {
          const mesin = String(row.mesin || '').trim();
          if (!mesin) return;
          if (!hasilInput[mesin]) hasilInput[mesin] = [];
          hasilInput[mesin].push({ id: row.id, noSPK: row.noSPK, speed: row.speed });
        });

        hideSyncLoading();
        refreshMesinButtons();
        updateSummary();

        const overlayList = $('overlayList');
        if (overlayList && overlayList.classList.contains('active') && listMesin) {
          renderList(listMesin);
        }
      })
      .catch(function (err) {
        hideSyncLoading();
        const summary = $('summary');
        if (summary) { summary.textContent = 'Gagal memuat data.'; lastSummaryText = summary.textContent; }
        showToast('Gagal memuat data: ' + (err && err.message ? err.message : err), 'error');
        updateRangkuman();
      });
  }

  function onKontrolChange() {
    pendingInput = {};
    syncData();
  }

  /* ------------------------------------------------------------
     RENDER MESIN
     ------------------------------------------------------------ */
  function renderMesin() {
    const container = $('mesinContainer');
    if (!container) return;
    container.innerHTML = '';

    const groups = { PP: [], PE: [], HD: [], LAIN: [] };
    daftarMesin.forEach(function (nama) {
      const kat = kategoriMesin[nama] || 'LAIN';
      if (!groups[kat]) groups[kat] = [];
      groups[kat].push(nama);
    });

    const order = ['PP', 'PE', 'HD', 'LAIN'];
    const label = { PP: 'PP', PE: 'PE', HD: 'HD', LAIN: 'LAINNYA' };

    let ada = false;
    order.forEach(function (kat) {
      const list = groups[kat];
      if (!list || list.length === 0) return;
      ada = true;

      const section = document.createElement('div');
      section.className = 'kategori-section kategori-' + kat.toLowerCase();

      const title = document.createElement('div');
      title.className = 'kategori-title';
      title.textContent = label[kat] + ' (' + list.length + ')';
      section.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'mesin-grid';

      list.forEach(function (nama) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mesin-btn';
        btn.textContent = nama;
        btn.dataset.mesin = nama;
        if (hasilInput[nama] && hasilInput[nama].length > 0) btn.classList.add('filled');
        if (pendingInput[nama] && pendingInput[nama].length > 0) btn.classList.add('filled');
        btn.addEventListener('click', function () { onMesinClick(nama); });
        grid.appendChild(btn);
      });

      section.appendChild(grid);
      container.appendChild(section);
    });

    if (!ada) container.innerHTML = '<div class="loading-wrap">Tidak ada mesin terdaftar.</div>';
    if (isSyncing) showSyncLoading();
    updateSummary();
  }

  function refreshMesinButtons() {
    document.querySelectorAll('.mesin-btn').forEach(function (btn) {
      const nama = btn.dataset.mesin;
      const adaServer = hasilInput[nama] && hasilInput[nama].length > 0;
      const adaPending = pendingInput[nama] && pendingInput[nama].length > 0;
      if (adaServer || adaPending) btn.classList.add('filled');
      else btn.classList.remove('filled');
    });
  }

  /* ------------------------------------------------------------
     KLIK MESIN
     ------------------------------------------------------------ */
  function onMesinClick(namaMesin) {
    if (isSyncing) return;

    const adaServer = hasilInput[namaMesin] && hasilInput[namaMesin].length > 0;
    const adaPending = pendingInput[namaMesin] && pendingInput[namaMesin].length > 0;

    if (adaServer || adaPending) openListOverlay(namaMesin);
    else openInputOverlay(namaMesin, 'tambah', null, null, false);
  }

  /* ------------------------------------------------------------
     OVERLAY LIST
     ------------------------------------------------------------ */
  function openListOverlay(namaMesin) {
    listMesin = namaMesin;
    currentKategori = kategoriMesin[namaMesin] || 'LAIN';
    const title = $('listTitle');
    if (title) title.textContent = namaMesin + ' · ' + currentKategori;
    renderList(namaMesin);
    const overlay = $('overlayList');
    if (overlay) overlay.classList.add('active');
  }

  function closeListOverlay() {
    const overlay = $('overlayList');
    if (overlay) overlay.classList.remove('active');
    listMesin = null;
  }

  function renderList(namaMesin) {
    const container = $('listContainer');
    if (!container) return;
    container.innerHTML = '';

    const serverRows = (hasilInput[namaMesin] || []).slice();
    const pendingRows = (pendingInput[namaMesin] || []).slice();

    if (serverRows.length === 0 && pendingRows.length === 0) {
      container.innerHTML = '<div class="list-empty">Belum ada data untuk mesin ini.</div>';
      return;
    }

    serverRows.forEach(function (row) { container.appendChild(buildCard(row, false, null)); });
    pendingRows.forEach(function (row, idx) { container.appendChild(buildCard(row, true, idx)); });
  }

  function buildCard(row, isPending, pendingIndex) {
    const card = document.createElement('div');
    card.className = 'data-card';

    const info = document.createElement('div');
    info.className = 'card-info';

    const f1 = document.createElement('div');
    f1.className = 'card-field';
    const l1 = document.createElement('div');
    l1.className = 'card-label';
    l1.textContent = 'No SPK';
    const v1 = document.createElement('div');
    v1.className = 'card-value';
    v1.textContent = row.noSPK || '—';
    f1.appendChild(l1); f1.appendChild(v1);

    const f2 = document.createElement('div');
    f2.className = 'card-field';
    const l2 = document.createElement('div');
    l2.className = 'card-label';
    l2.textContent = 'Speed';
    const v2 = document.createElement('div');
    v2.className = 'card-value';
    v2.textContent = row.speed || '—';
    f2.appendChild(l2); f2.appendChild(v2);

    info.appendChild(f1); info.appendChild(f2);
    card.appendChild(info);

    if (isPending) {
      const badge = document.createElement('div');
      badge.className = 'card-label';
      badge.style.color = 'var(--neon-yellow)';
      badge.textContent = 'Belum tersimpan';
      card.appendChild(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'btn-edit';
    btnEdit.textContent = '✏️ Edit';
    btnEdit.addEventListener('click', function () {
      if (isPending) openInputOverlay(listMesin, 'edit', null, pendingIndex, true);
      else openInputOverlay(listMesin, 'edit', row.id, null, true);
    });

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-delete';
    btnDelete.textContent = '🗑️ Hapus';
    btnDelete.addEventListener('click', function () {
      if (isPending) openConfirmOverlay(null, listMesin, pendingIndex);
      else openConfirmOverlay(row.id, listMesin, null);
    });

    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);
    card.appendChild(actions);

    return card;
  }

  function onTambahBarisClick() {
    if (!listMesin) return;
    openInputOverlay(listMesin, 'tambah', null, null, true);
  }

  /* ------------------------------------------------------------
     OVERLAY INPUT
     ------------------------------------------------------------ */
  function openInputOverlay(namaMesin, mode, id, pIndex, fromList) {
    closeConfirmOverlay();
    const overlayList = $('overlayList');
    if (overlayList) overlayList.classList.remove('active');

    formMode = mode || 'tambah';
    editId = id || null;
    pendingEditIndex = (typeof pIndex === 'number') ? pIndex : null;
    currentMesin = namaMesin;
    currentKategori = kategoriMesin[namaMesin] || 'LAIN';
    currentSPKData = null;
    currentSPKValid = false;
    currentMesinInfo = { satuan: '', minSpeed: null, maxSpeed: null };
    speedError = false;
    speedWarning = false;
    lastSpeedStatus = 'none';
    formOriginList = !!fromList;

    const title = $('modalTitle');
    if (title) {
      title.textContent = namaMesin + ' · ' + currentKategori +
        (formMode === 'edit' ? ' · Edit Baris' : ' · Tambah Baris');
    }

    const spkInput = $('spkInput');
    const speedInput = $('speedInput');

    let initSPK = '';
    let initSpeed = '';

    if (formMode === 'edit') {
      if (pendingEditIndex !== null) {
        const p = (pendingInput[namaMesin] || [])[pendingEditIndex];
        if (p) { initSPK = p.noSPK || ''; initSpeed = p.speed || ''; }
      } else if (editId) {
        const rows = hasilInput[namaMesin] || [];
        const found = rows.find(function (r) { return r.id === editId; });
        if (found) { initSPK = found.noSPK || ''; initSpeed = found.speed || ''; }
      }
    }

    spkInput.value = initSPK;
    speedInput.value = initSpeed;

    resetSPKInfo();
    if (initSPK) onSPKInputChange(true);
    else $('btnOk').disabled = true;

    if (initSpeed) onSpeedChange(true);

    const overlay = $('overlayInput');
    if (overlay) overlay.classList.add('active');
    setTimeout(function () { spkInput.focus(); }, 120);
  }

  function closeInputOverlay() {
    const overlay = $('overlayInput');
    if (overlay) overlay.classList.remove('active');

    const wasFromList = formOriginList;

    currentMesin = null;
    currentKategori = null;
    currentSPKData = null;
    currentSPKValid = false;
    currentMesinInfo = { satuan: '', minSpeed: null, maxSpeed: null };
    speedError = false;
    speedWarning = false;
    lastSpeedStatus = 'none';
    editId = null;
    pendingEditIndex = null;
    formMode = 'tambah';
    formOriginList = false;

    if (lookupDebounceTimer) { clearTimeout(lookupDebounceTimer); lookupDebounceTimer = null; }
    if (speedDebounceTimer) { clearTimeout(speedDebounceTimer); speedDebounceTimer = null; }
    if (satuanDebounceTimer) { clearTimeout(satuanDebounceTimer); satuanDebounceTimer = null; }

    if (wasFromList && listMesin) {
      const overlayList = $('overlayList');
      if (overlayList) overlayList.classList.add('active');
      renderList(listMesin);
    }
  }

  /* ------------------------------------------------------------
     SPK INFO
     ------------------------------------------------------------ */
  function resetSPKInfo() {
    const box = $('spkInfo');
    const val = $('spkInfoValue');
    if (!box || !val) return;
    box.classList.remove('error', 'success', 'warning');
    val.textContent = '—';
  }

  function setSPKInfo(text, state) {
    const box = $('spkInfo');
    const val = $('spkInfoValue');
    if (!box || !val) return;
    box.classList.remove('error', 'success', 'warning');
    if (state === 'error') box.classList.add('error');
    if (state === 'warning') box.classList.add('warning');
    if (state === 'success') box.classList.add('success');
    val.textContent = text;
  }

  /* ------------------------------------------------------------
     SPK LOOKUP (debounce 400ms)
     ------------------------------------------------------------ */
  function onSPKInputChange(immediate) {
    const el = $('spkInput');

    const before = el.value;
    const after = before.replace(/[^0-9]/g, '');
    if (before !== after) el.value = after;

    const noSPK = after.trim();
    if (noSPK === '') {
      if (lookupDebounceTimer) { clearTimeout(lookupDebounceTimer); lookupDebounceTimer = null; }
      resetSPKInfo();
      currentSPKData = null;
      currentSPKValid = false;
      currentMesinInfo = { satuan: '', minSpeed: null, maxSpeed: null };
      validateSpeed();
      return;
    }

    setSPKInfo('Mencari No SPK ' + noSPK + ' ...', '');

    if (lookupDebounceTimer) { clearTimeout(lookupDebounceTimer); lookupDebounceTimer = null; }

    if (immediate) { runSPKLookup(noSPK); return; }

    lookupDebounceTimer = setTimeout(function () {
      lookupDebounceTimer = null;
      runSPKLookup(noSPK);
    }, 400);
  }

  function flushSPKLookup() {
    if (lookupDebounceTimer) { clearTimeout(lookupDebounceTimer); lookupDebounceTimer = null; }
    const el = $('spkInput');
    const noSPK = (el.value || '').replace(/[^0-9]/g, '').trim();
    if (noSPK !== '') runSPKLookup(noSPK);
  }

  function runSPKLookup(noSPK) {
    const tahun = getTahunDariTanggal();
    const kategori = currentKategori;
    const mesin = currentMesin;
    const seq = ++lookupSeq;

    callGAS({ action: 'cariSPK', noSPK: noSPK, kategori: kategori, tahun: tahun, mesin: mesin })
      .then(function (res) {
        if (seq !== lookupSeq) return;
        handleLookupResult(res);
      })
      .catch(function (err) {
        if (seq !== lookupSeq) return;
        currentSPKData = null;
        currentSPKValid = false;
        setSPKInfo('Error: ' + (err && err.message ? err.message : err), 'error');
        playBeepFail(); vibrate();
        validateSpeed();
      });
  }

  function handleLookupResult(res) {
    if (res && res.mesinInfo) {
      currentMesinInfo = {
        satuan: res.mesinInfo.satuan || '',
        minSpeed: (res.mesinInfo.minSpeed != null ? res.mesinInfo.minSpeed : null),
        maxSpeed: (res.mesinInfo.maxSpeed != null ? res.mesinInfo.maxSpeed : null)
      };
    } else {
      currentMesinInfo = { satuan: '', minSpeed: null, maxSpeed: null };
    }

    if (!res || !res.success) {
      currentSPKData = null; currentSPKValid = false;
      setSPKInfo((res && res.error) || 'Gagal mencari SPK.', 'error');
      playBeepFail(); vibrate();
      validateSpeed();
      return;
    }
    if (!res.found) {
      currentSPKData = null; currentSPKValid = false;
      setSPKInfo(res.error || 'No SPK tidak ditemukan.', 'error');
      playBeepFail(); vibrate();
      validateSpeed();
      return;
    }
    if (!res.valid) {
      currentSPKData = res.data || null; currentSPKValid = false;
      setSPKInfo(res.error || 'Jenis plastik tidak cocok.', 'error');
      playBeepFail(); vibrate();
      validateSpeed();
      return;
    }

    currentSPKData = res.data;
    currentSPKValid = true;
    const teks = formatSPKInfo(res.data);
    setSPKInfo(teks, 'success');
    playBeepSuccess();
    validateSpeed(true);
  }

  function formatSPKInfo(d) {
    const lebar = (d.lebar || '').trim();
    const lipat = (d.lipat || '').trim();
    let ukuran = '';
    if (lebar && lipat) ukuran = lebar + '/' + lipat;
    else if (lebar) ukuran = lebar;
    else if (lipat) ukuran = '?/' + lipat;
    else ukuran = '—';

    return 'Order ' + d.jenisPlastik + ' ' + d.tebal + ' x ' + ukuran;
  }

  /* ------------------------------------------------------------
     SPEED: satuan instan, Min/Max tunda 800ms
     ------------------------------------------------------------ */
  function onSpeedChange(immediate) {
    const el = $('speedInput');
    let v = el.value;

    v = v.replace(/\./g, ',');
    v = v.replace(/[^0-9,]/g, '');

    const firstComma = v.indexOf(',');
    if (firstComma !== -1) {
      const head = v.substring(0, firstComma + 1);
      const tail = v.substring(firstComma + 1).replace(/,/g, '');
      v = head + tail;
    }

    if (v !== el.value) el.value = v;

    if (speedDebounceTimer) { clearTimeout(speedDebounceTimer); speedDebounceTimer = null; }
    if (satuanDebounceTimer) { clearTimeout(satuanDebounceTimer); satuanDebounceTimer = null; }

    validasiSatuanSaja();

    if (immediate) {
      validateSpeed();
      return;
    }

    speedDebounceTimer = setTimeout(function () {
      speedDebounceTimer = null;
      validateMinMaxSaja();
    }, 800);
  }

  function validasiSatuanSaja() {
    const el = $('speedInput');
    const raw = (el.value || '').trim();
    const nilai = speedKeAngka(raw);

    speedError = false;

    if (raw === '' || nilai === null) {
      updateOkState();
      return;
    }

    const satuanKey = String(currentMesinInfo.satuan || '').trim().toLowerCase();
    if (satuanKey !== '' && RENTANG_SATUAN[satuanKey]) {
      const r = RENTANG_SATUAN[satuanKey];
      if (nilai < r.min || nilai > r.max) {
        speedError = true;
        const labelSatuan = currentMesinInfo.satuan;
        setSPKInfo(
          'Speed ' + raw + ' di luar rentang ' + labelSatuan + ' (' + r.label + ')',
          'error'
        );
        if (lastSpeedStatus !== 'error') { playBeepFail(); vibrate(); }
        lastSpeedStatus = 'error';
        updateOkState();
        return;
      }
    }

    updateOkState();
  }

  function validateMinMaxSaja() {
    const el = $('speedInput');
    const raw = (el.value || '').trim();
    const nilai = speedKeAngka(raw);

    if (speedError) return;

    speedWarning = false;

    if (raw === '' || nilai === null) {
      if (currentSPKValid && currentSPKData && lastSpeedStatus !== 'error') {
        setSPKInfo(formatSPKInfo(currentSPKData), 'success');
      }
      lastSpeedStatus = 'none';
      updateOkState();
      return;
    }

    const min = currentMesinInfo.minSpeed;
    const max = currentMesinInfo.maxSpeed;
    if (min != null && max != null) {
      if (nilai < min || nilai > max) {
        speedWarning = true;
        const satuanTeks = currentMesinInfo.satuan ? ' (' + currentMesinInfo.satuan + ')' : '';
        let ket = '';
        if (nilai < min) ket = 'di bawah Min ' + numToComma(min);
        else ket = 'di atas Max ' + numToComma(max);
        setSPKInfo(
          'Speed ' + raw + ' ' + ket + satuanTeks + ' — periksa kembali',
          'warning'
        );
        if (lastSpeedStatus !== 'warning') { playBeepFail(); vibrate(); }
        lastSpeedStatus = 'warning';
        updateOkState();
        return;
      }
    }

    if (currentSPKValid && currentSPKData) {
      setSPKInfo(formatSPKInfo(currentSPKData), 'success');
    }
    lastSpeedStatus = 'none';
    updateOkState();
  }

  function validateSpeed(fromSPKSuccess) {
    validasiSatuanSaja();
    if (speedError) return;
    validateMinMaxSaja();
  }

  function numToComma(n) {
    return String(n).replace('.', ',');
  }

  function updateOkState() {
    const speedOk = $('speedInput').value.trim() !== '';
    const spkOk = currentSPKValid;
    const satuanOk = !speedError;
    $('btnOk').disabled = !(spkOk && speedOk && satuanOk);
  }

  /* ------------------------------------------------------------
     SCANNER
     ------------------------------------------------------------ */
  function openScanner() {
    Scanner.open(
      function (barcode) {
        const el = $('spkInput');
        if (el) {
          el.value = barcode;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          onSPKInputChange(true);
        }
      },
      function () { /* closed tanpa scan */ }
    );
  }

  /* ------------------------------------------------------------
     OK
     ------------------------------------------------------------ */
  function onOk() {
    if (!currentSPKValid || !currentSPKData || !currentMesin) return;
    if (speedError) return;

    const speed = $('speedInput').value.trim();
    if (speed === '') return;

    const noSPK = currentSPKData.noSPK;
    const mesin = currentMesin;
    const mode = formMode;
    const id = editId;

    if (mode === 'edit' && pendingEditIndex !== null) {
      const rows = pendingInput[mesin] || [];
      if (rows[pendingEditIndex]) {
        rows[pendingEditIndex].noSPK = noSPK;
        rows[pendingEditIndex].speed = speed;
        pendingInput[mesin] = rows;
      }
      closeInputOverlay();
      refreshMesinButtons();
      updateSummary();
      if (listMesin) renderList(listMesin);
      showToast('Baris diperbarui (belum tersimpan).', 'success');
      return;
    }

    if (mode === 'edit' && id) {
      const btnOk = $('btnOk');
      btnOk.disabled = true;
      callGAS({ action: 'editData', id: id, noSPK: noSPK, speed: speed })
        .then(function (res) {
          btnOk.disabled = false;
          if (!res || !res.success) {
            showToast('Gagal edit: ' + ((res && res.error) || 'unknown'), 'error');
            return;
          }
          closeInputOverlay();
          showToast('Baris diperbarui.', 'success');
          syncData();
        })
        .catch(function (err) {
          btnOk.disabled = false;
          showToast('Gagal edit: ' + (err && err.message ? err.message : err), 'error');
        });
      return;
    }

    if (!pendingInput[mesin]) pendingInput[mesin] = [];
    pendingInput[mesin].push({ noSPK: noSPK, speed: speed });

    closeInputOverlay();
    refreshMesinButtons();
    updateSummary();
    if (listMesin) renderList(listMesin);
    showToast('Baris ditambahkan. Tekan Simpan untuk mengirim.', 'success');
  }

  /* ------------------------------------------------------------
     KONFIRMASI HAPUS
     ------------------------------------------------------------ */
  function openConfirmOverlay(id, mesin, pIndex) {
    confirmId = id || null;
    confirmMesin = mesin || null;
    pendingDeleteIndex = (typeof pIndex === 'number') ? pIndex : null;

    const txt = $('confirmText');
    if (txt) {
      if (id) txt.textContent = 'Yakin hapus data ini? Tindakan tidak bisa dibatalkan.';
      else txt.textContent = 'Yakin hapus baris yang belum tersimpan ini?';
    }

    const overlay = $('overlayConfirm');
    if (overlay) overlay.classList.add('active');
  }

  function closeConfirmOverlay() {
    const overlay = $('overlayConfirm');
    if (overlay) overlay.classList.remove('active');
    confirmId = null;
    confirmMesin = null;
    pendingDeleteIndex = null;
  }

  function onHapusConfirmed() {
    const id = confirmId;
    const mesin = confirmMesin;
    const pIdx = pendingDeleteIndex;

    if (id) {
      const btnYes = $('btnYesConfirm');
      btnYes.disabled = true;
      callGAS({ action: 'hapusData', id: id })
        .then(function (res) {
          btnYes.disabled = false;
          if (!res || !res.success) {
            showToast('Gagal hapus: ' + ((res && res.error) || 'unknown'), 'error');
            return;
          }
          closeConfirmOverlay();
          showToast('Data dihapus.', 'success');
          syncData();
        })
        .catch(function (err) {
          btnYes.disabled = false;
          showToast('Gagal hapus: ' + (err && err.message ? err.message : err), 'error');
        });
      return;
    }

    if (mesin && typeof pIdx === 'number') {
      const rows = pendingInput[mesin] || [];
      rows.splice(pIdx, 1);
      if (rows.length === 0) delete pendingInput[mesin];
      else pendingInput[mesin] = rows;
    }

    closeConfirmOverlay();
    refreshMesinButtons();
    updateSummary();
    if (listMesin) renderList(listMesin);
    showToast('Baris dihapus.', 'success');
  }

  /* ------------------------------------------------------------
     SIMPAN (batch pending) — SATU request tambahBanyak
     ------------------------------------------------------------ */
  function onSimpan() {
    const ctx = getTanggalShift();
    if (!ctx.tanggal) { showToast('Tanggal belum diisi.', 'error'); return; }

    const rows = [];
    Object.keys(pendingInput).forEach(function (mesin) {
      const list = pendingInput[mesin] || [];
      list.forEach(function (r) {
        rows.push({
          tanggal: ctx.tanggal,
          shift: ctx.shift,
          mesin: mesin,
          noSPK: r.noSPK,
          speed: r.speed
        });
      });
    });

    if (rows.length === 0) { showToast('Belum ada baris baru untuk disimpan.', 'error'); return; }

    const btn = $('btnSimpan');
    btn.disabled = true;
    btn.textContent = '⏳ Menyimpan...';

    callGAS({ action: 'tambahBanyak', rows: JSON.stringify(rows) })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = '💾 Simpan ke Sheet Inputan';

        if (!res || !res.success) {
          showToast('Gagal simpan: ' + ((res && res.error) || 'unknown'), 'error');
          return;
        }

        const jumlah = res.jumlah != null ? res.jumlah : rows.length;
        pendingInput = {};
        updateSummary();
        showToast('Berhasil disimpan: ' + jumlah + ' baris.', 'success');
        syncData();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = '💾 Simpan ke Sheet Inputan';
        showToast('Gagal simpan: ' + (err && err.message ? err.message : err), 'error');
      });
  }

  /* ------------------------------------------------------------
     RANGKUMAN MESIN AKTIF
     ------------------------------------------------------------ */
  function hitungRangkuman() {
    const aktif = {};

    Object.keys(hasilInput).forEach(function (mesin) {
      if ((hasilInput[mesin] || []).length > 0) aktif[mesin] = true;
    });
    Object.keys(pendingInput).forEach(function (mesin) {
      if ((pendingInput[mesin] || []).length > 0) aktif[mesin] = true;
    });

    let pp = 0, pe = 0, hd = 0;
    Object.keys(aktif).forEach(function (mesin) {
      const kat = kategoriMesin[mesin] || 'LAIN';
      if (kat === 'PP') pp++;
      else if (kat === 'PE') pe++;
      else if (kat === 'HD') hd++;
    });

    return { pp: pp, pe: pe, hd: hd, total: pp + pe + hd };
  }

  function setAngkaRangkuman(idEl, nilai, key) {
    const el = $(idEl);
    if (!el) return;
    if (String(el.textContent) === String(nilai)) { lastRangkuman[key] = nilai; return; }
    el.textContent = nilai;
    lastRangkuman[key] = nilai;
  }

  function updateRangkuman() {
    const r = hitungRangkuman();
    setAngkaRangkuman('rPP', r.pp, 'pp');
    setAngkaRangkuman('rPE', r.pe, 'pe');
    setAngkaRangkuman('rHD', r.hd, 'hd');
    setAngkaRangkuman('rTotal', r.total, 'total');
  }

  /* ------------------------------------------------------------
     SUMMARY
     ------------------------------------------------------------ */
  function updateSummary() {
    const el = $('summary');
    const btn = $('btnSimpan');
    if (!el || !btn) return;

    updateRangkuman();

    if (isSyncing) {
      const txt = 'Memuat data...';
      if (lastSummaryText !== txt) { el.textContent = txt; lastSummaryText = txt; }
      btn.disabled = true;
      return;
    }

    let totalServer = 0;
    Object.keys(hasilInput).forEach(function (m) { totalServer += (hasilInput[m] || []).length; });

    let totalPending = 0;
    Object.keys(pendingInput).forEach(function (m) { totalPending += (pendingInput[m] || []).length; });

    const totalMesinServer = Object.keys(hasilInput).filter(function (m) {
      return (hasilInput[m] || []).length > 0;
    }).length;

    let txt;
    if (totalServer === 0 && totalPending === 0) {
      txt = 'Belum ada data untuk tanggal & shift ini.';
      btn.disabled = true;
    } else {
      txt = totalServer + ' baris · ' + totalMesinServer + ' mesin tersimpan';
      if (totalPending > 0) txt += ' · ' + totalPending + ' baris baru belum disimpan';
      btn.disabled = (totalPending === 0);
    }

    if (lastSummaryText !== txt) { el.textContent = txt; lastSummaryText = txt; }
  }

})();
