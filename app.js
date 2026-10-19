/* ============================================================
   APP — Logic Form Speed Extruder
   ============================================================
   Arsitektur baru:
   - Sumber kebenaran data = GAS (getData per Tanggal+Shift).
   - Simpan per aksi: tambahData / editData / hapusData.
   - Tombol "Simpan" global dipertahankan, tapi fungsinya
     menyimpan baris yang masih pending di memory (batch),
     memakai tambahData berurutan.
   - UI kaku: overlay tidak menutup saat klik luar / Escape.
   - Beep sukses/gagal saat cari SPK (sukses: 4 nada sine naik;
     gagal: 2 ketukan square turun, rapat).
   - Indikator loading saat sync data.
   ============================================================ */

(function () {

  /* ------------------------------------------------------------
     STATE GLOBAL
     ------------------------------------------------------------ */
  let daftarMesin = [];
  let kategoriMesin = {};

  // hasilInput: map mesin -> array baris { id, noSPK, speed }
  let hasilInput = {};

  // pendingInput: map mesin -> array baris { noSPK, speed }
  let pendingInput = {};

  let currentMesin = null;
  let currentKategori = null;
  let currentSPKData = null;
  let currentSPKValid = false;
  let toastTimer = null;
  let lookupSeq = 0;

  // Mode form input: 'tambah' | 'edit'
  let formMode = 'tambah';
  let editId = null;
  let pendingEditIndex = null;
  let formOriginList = false;

  // Konteks overlay list
  let listMesin = null;

  // Konteks konfirmasi hapus
  let confirmId = null;
  let confirmMesin = null;
  let pendingDeleteIndex = null;

  // Status sync
  let isSyncing = false;

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

  function cssEscape(str) {
    if (window.CSS && CSS.escape) return CSS.escape(str);
    return String(str).replace(/["\\]/g, '\\$&');
  }

  function getTahunDariTanggal() {
    const val = $('tanggal').value;
    if (val && val.length >= 4) return val.substring(0, 4);
    return String(CONFIG.DEFAULT_TAHUN || new Date().getFullYear());
  }

  function getTanggalShift() {
    return {
      tanggal: $('tanggal').value,
      shift: $('shift').value
    };
  }

  /* ------------------------------------------------------------
     BEEP (WebAudio)
     ------------------------------------------------------------
     Sukses: 4 nada sine naik (660→880→1100→1320), nyaring & tegas.
     Gagal : 2 ketukan square turun (400→200), rapat (jeda ~230ms).
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
    } catch (e) {
      console.warn('Beep sukses gagal:', e);
    }
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
    } catch (e) {
      console.warn('Beep gagal gagal:', e);
    }
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

      function cleanup() {
        if (done) return;
        done = true;
        try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
        if (script && script.parentNode) script.parentNode.removeChild(script);
      }

      window[cbName] = function (data) {
        cleanup();
        resolve(data);
      };

      const qs = new URLSearchParams(params).toString();
      const url = CONFIG.GAS_URL +
        '?callback=' + encodeURIComponent(cbName) +
        '&' + qs;

      script.src = url;
      script.onerror = function () {
        cleanup();
        reject(new Error('JSONP gagal — cek koneksi atau URL GAS'));
      };

      document.body.appendChild(script);

      setTimeout(function () {
        if (!done) {
          cleanup();
          reject(new Error('JSONP timeout'));
        }
      }, 20000);
    });
  }

  /* ------------------------------------------------------------
     INIT
     ------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    initTanggal();
    initShift();
    initFooterTahun();
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
        if (e.key === 'Enter') { e.preventDefault(); onSPKInputChange(); }
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

    // Overlay List
    const btnCloseList = $('btnCloseList');
    if (btnCloseList) btnCloseList.addEventListener('click', closeListOverlay);

    const btnTambahBaris = $('btnTambahBaris');
    if (btnTambahBaris) btnTambahBaris.addEventListener('click', onTambahBarisClick);

    // Overlay Konfirmasi
    const btnCloseConfirm = $('btnCloseConfirm');
    if (btnCloseConfirm) btnCloseConfirm.addEventListener('click', closeConfirmOverlay);

    const btnCancelConfirm = $('btnCancelConfirm');
    if (btnCancelConfirm) btnCancelConfirm.addEventListener('click', closeConfirmOverlay);

    const btnYesConfirm = $('btnYesConfirm');
    if (btnYesConfirm) btnYesConfirm.addEventListener('click', onHapusConfirmed);

    // UI KAKU: tidak ada listener klik-luar, tidak ada Escape.
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
        if (!res || !res.success) {
          throw new Error((res && res.error) || 'Gagal memuat mesin.');
        }
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
     INDIKATOR LOADING SYNC
     ------------------------------------------------------------ */
  function showSyncLoading() {
    isSyncing = true;

    const container = $('mesinContainer');
    if (container) {
      container.classList.add('mesin-panel-loading');
      let ov = container.querySelector('.mesin-loading-overlay');
      if (!ov) {
        ov = document.createElement('div');
        ov.className = 'mesin-loading-overlay';
        ov.innerHTML = '<span class="loading"></span> Memuat data...';
        container.appendChild(ov);
      }
    }

    document.querySelectorAll('.mesin-btn').forEach(function (b) {
      b.disabled = true;
    });

    const summary = $('summary');
    if (summary) summary.textContent = 'Memuat data...';
  }

  function hideSyncLoading() {
    isSyncing = false;

    const container = $('mesinContainer');
    if (container) {
      container.classList.remove('mesin-panel-loading');
      const ov = container.querySelector('.mesin-loading-overlay');
      if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    }

    document.querySelectorAll('.mesin-btn').forEach(function (b) {
      b.disabled = false;
    });
  }

  /* ------------------------------------------------------------
     SYNC DATA (getData by Tanggal + Shift)
     ------------------------------------------------------------ */
  function syncData() {
    const ctx = getTanggalShift();
    if (!ctx.tanggal || !ctx.shift) return;

    showSyncLoading();

    callGAS({
      action: 'getData',
      tanggal: ctx.tanggal,
      shift: ctx.shift
    })
    .then(function (res) {
      if (!res || !res.success) {
        throw new Error((res && res.error) || 'Gagal memuat data.');
      }
      const data = res.data || [];

      hasilInput = {};
      data.forEach(function (row) {
        const mesin = String(row.mesin || '').trim();
        if (!mesin) return;
        if (!hasilInput[mesin]) hasilInput[mesin] = [];
        hasilInput[mesin].push({
          id: row.id,
          noSPK: row.noSPK,
          speed: row.speed
        });
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
      if (summary) summary.textContent = 'Gagal memuat data.';
      showToast('Gagal memuat data: ' + (err && err.message ? err.message : err), 'error');
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

    if (!ada) {
      container.innerHTML = '<div class="loading-wrap">Tidak ada mesin terdaftar.</div>';
    }

    if (isSyncing) {
      showSyncLoading();
    }

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

    if (adaServer || adaPending) {
      openListOverlay(namaMesin);
    } else {
      openInputOverlay(namaMesin, 'tambah', null, null, false);
    }
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

    serverRows.forEach(function (row) {
      container.appendChild(buildCard(row, false, null));
    });

    pendingRows.forEach(function (row, idx) {
      container.appendChild(buildCard(row, true, idx));
    });
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

    info.appendChild(f1);
    info.appendChild(f2);
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
      if (isPending) {
        openInputOverlay(listMesin, 'edit', null, pendingIndex, true);
      } else {
        openInputOverlay(listMesin, 'edit', row.id, null, true);
      }
    });

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-delete';
    btnDelete.textContent = '🗑️ Hapus';
    btnDelete.addEventListener('click', function () {
      if (isPending) {
        openConfirmOverlay(null, listMesin, pendingIndex);
      } else {
        openConfirmOverlay(row.id, listMesin, null);
      }
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
     OVERLAY INPUT (TAMBAH / EDIT)
     ------------------------------------------------------------ */
  function openInputOverlay(namaMesin, mode, id, pIndex, fromList) {
    // Tutup overlay konfirmasi dulu supaya tidak tumpang tindih
    closeConfirmOverlay();

    // Sembunyikan list sementara (biar tidak menumpuk di belakang input)
    const overlayList = $('overlayList');
    if (overlayList) overlayList.classList.remove('active');

    formMode = mode || 'tambah';
    editId = id || null;
    pendingEditIndex = (typeof pIndex === 'number') ? pIndex : null;
    currentMesin = namaMesin;
    currentKategori = kategoriMesin[namaMesin] || 'LAIN';
    currentSPKData = null;
    currentSPKValid = false;
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
    if (initSPK) {
      onSPKInputChange();
    } else {
      $('btnOk').disabled = true;
    }

    const overlay = $('overlayInput');
    if (overlay) overlay.classList.add('active');

    setTimeout(function () { spkInput.focus(); }, 120);
  }

  function closeInputOverlay() {
    const overlay = $('overlayInput');
    if (overlay) overlay.classList.remove('active');

    const wasFromList = formOriginList;
    const mesinAsal = currentMesin;

    currentMesin = null;
    currentKategori = null;
    currentSPKData = null;
    currentSPKValid = false;
    editId = null;
    pendingEditIndex = null;
    formMode = 'tambah';
    formOriginList = false;

    // Kalau asalnya dari list dan list masih punya mesin, buka lagi
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
    box.classList.remove('error', 'success');
    val.textContent = '—';
  }

  function setSPKInfo(text, state) {
    const box = $('spkInfo');
    const val = $('spkInfoValue');
    if (!box || !val) return;
    box.classList.remove('error', 'success');
    if (state === 'error') box.classList.add('error');
    if (state === 'success') box.classList.add('success');
    val.textContent = text;
  }

  /* ------------------------------------------------------------
     SPK LOOKUP (filter angka 0-9)
     ------------------------------------------------------------ */
  function onSPKInputChange() {
    const el = $('spkInput');

    const before = el.value;
    const after = before.replace(/[^0-9]/g, '');
    if (before !== after) el.value = after;

    const noSPK = after.trim();
    if (noSPK === '') {
      resetSPKInfo();
      currentSPKData = null;
      currentSPKValid = false;
      updateOkState();
      return;
    }

    setSPKInfo('Mencari No SPK ' + noSPK + ' ...', '');
    $('btnOk').disabled = true;

    const tahun = getTahunDariTanggal();
    const kategori = currentKategori;
    const seq = ++lookupSeq;

    callGAS({
      action: 'cariSPK',
      noSPK: noSPK,
      kategori: kategori,
      tahun: tahun
    })
    .then(function (res) {
      if (seq !== lookupSeq) return;
      handleLookupResult(res);
    })
    .catch(function (err) {
      if (seq !== lookupSeq) return;
      currentSPKData = null;
      currentSPKValid = false;
      setSPKInfo('Error: ' + (err && err.message ? err.message : err), 'error');
      playBeepFail();
      updateOkState();
    });
  }

  function handleLookupResult(res) {
    if (!res || !res.success) {
      currentSPKData = null;
      currentSPKValid = false;
      setSPKInfo((res && res.error) || 'Gagal mencari SPK.', 'error');
      playBeepFail();
      updateOkState();
      return;
    }

    if (!res.found) {
      currentSPKData = null;
      currentSPKValid = false;
      setSPKInfo(res.error || 'No SPK tidak ditemukan.', 'error');
      playBeepFail();
      updateOkState();
      return;
    }

    if (!res.valid) {
      currentSPKData = res.data || null;
      currentSPKValid = false;
      setSPKInfo(res.error || 'Jenis plastik tidak cocok.', 'error');
      playBeepFail();
      updateOkState();
      return;
    }

    currentSPKData = res.data;
    currentSPKValid = true;

    const teks = 'Order ' + res.data.jenisPlastik + ' ' + res.data.tebal + ' x ' + res.data.lebar;
    setSPKInfo(teks, 'success');
    playBeepSuccess();
    updateOkState();
  }

  function updateOkState() {
    const speedOk = $('speedInput').value.trim() !== '';
    $('btnOk').disabled = !(currentSPKValid && speedOk);
  }

  /* ------------------------------------------------------------
     SPEED (paksa koma)
     ------------------------------------------------------------ */
  function onSpeedChange() {
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
    updateOkState();
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
          onSPKInputChange();
        }
      },
      function () { /* closed tanpa scan */ }
    );
  }

  /* ------------------------------------------------------------
     OK (Tambah / Edit)
     ------------------------------------------------------------ */
  function onOk() {
    if (!currentSPKValid || !currentSPKData || !currentMesin) return;

    const speed = $('speedInput').value.trim();
    if (speed === '') return;

    const noSPK = currentSPKData.noSPK;
    const mesin = currentMesin;
    const mode = formMode;
    const id = editId;

    // Edit baris pending -> update lokal
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

    // Edit baris server -> editData
    if (mode === 'edit' && id) {
      const btnOk = $('btnOk');
      btnOk.disabled = true;

      callGAS({
        action: 'editData',
        id: id,
        noSPK: noSPK,
        speed: speed
      })
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

    // Tambah -> pending
    if (!pendingInput[mesin]) pendingInput[mesin] = [];
    pendingInput[mesin].push({ noSPK: noSPK, speed: speed });

    closeInputOverlay();
    refreshMesinButtons();
    updateSummary();

    if (listMesin) renderList(listMesin);

    showToast('Baris ditambahkan. Tekan Simpan untuk mengirim.', 'success');
  }

  /* ------------------------------------------------------------
     OVERLAY KONFIRMASI HAPUS
     ------------------------------------------------------------ */
  function openConfirmOverlay(id, mesin, pIndex) {
    confirmId = id || null;
    confirmMesin = mesin || null;
    pendingDeleteIndex = (typeof pIndex === 'number') ? pIndex : null;

    const txt = $('confirmText');
    if (txt) {
      if (id) {
        txt.textContent = 'Yakin hapus data ini? Tindakan tidak bisa dibatalkan.';
      } else {
        txt.textContent = 'Yakin hapus baris yang belum tersimpan ini?';
      }
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
     SIMPAN (batch untuk baris pending)
     ------------------------------------------------------------ */
  function onSimpan() {
    const ctx = getTanggalShift();
    if (!ctx.tanggal) {
      showToast('Tanggal belum diisi.', 'error');
      return;
    }

    const tasks = [];
    Object.keys(pendingInput).forEach(function (mesin) {
      const rows = pendingInput[mesin] || [];
      rows.forEach(function (r) {
        tasks.push({
          tanggal: ctx.tanggal,
          shift: ctx.shift,
          mesin: mesin,
          noSPK: r.noSPK,
          speed: r.speed
        });
      });
    });

    if (tasks.length === 0) {
      showToast('Belum ada baris baru untuk disimpan.', 'error');
      return;
    }

    const btn = $('btnSimpan');
    btn.disabled = true;
    btn.textContent = '⏳ Menyimpan...';

    let idx = 0;
    let sukses = 0;
    let gagal = 0;

    function next() {
      if (idx >= tasks.length) {
        btn.disabled = false;
        btn.textContent = '💾 Simpan ke Sheet Inputan';
        pendingInput = {};
        updateSummary();
        showToast('Selesai. Sukses: ' + sukses + ', gagal: ' + gagal, gagal > 0 ? 'error' : 'success');
        syncData();
        return;
      }

      const row = tasks[idx++];
      callGAS({
        action: 'tambahData',
        row: JSON.stringify(row)
      })
      .then(function (res) {
        if (res && res.success) sukses++;
        else gagal++;
        next();
      })
      .catch(function () {
        gagal++;
        next();
      });
    }

    next();
  }

  /* ------------------------------------------------------------
     SUMMARY
     ------------------------------------------------------------ */
  function updateSummary() {
    const el = $('summary');
    const btn = $('btnSimpan');
    if (!el || !btn) return;

    if (isSyncing) {
      el.textContent = 'Memuat data...';
      btn.disabled = true;
      return;
    }

    let totalServer = 0;
    Object.keys(hasilInput).forEach(function (m) {
      totalServer += (hasilInput[m] || []).length;
    });

    let totalPending = 0;
    Object.keys(pendingInput).forEach(function (m) {
      totalPending += (pendingInput[m] || []).length;
    });

    const totalMesinServer = Object.keys(hasilInput).filter(function (m) {
      return (hasilInput[m] || []).length > 0;
    }).length;

    if (totalServer === 0 && totalPending === 0) {
      el.textContent = 'Belum ada data untuk tanggal & shift ini.';
      btn.disabled = true;
    } else {
      let txt = totalServer + ' baris · ' + totalMesinServer + ' mesin tersimpan';
      if (totalPending > 0) txt += ' · ' + totalPending + ' baris baru belum disimpan';
      el.textContent = txt;
      btn.disabled = (totalPending === 0);
    }
  }

})();
