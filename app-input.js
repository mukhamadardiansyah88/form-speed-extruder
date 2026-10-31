/* ============================================================
   APP-INPUT — Overlay List, Input SPK/Speed, Scanner Hook,
                OK/Edit/Hapus, Simpan Batch
   Form Speed Extruder
   ============================================================
   Bergantung pada: app-core.js (window.APP)
   ============================================================ */

(function () {

  const APP = window.APP = window.APP || {};
  const $ = APP.$;
  const showToast = APP.showToast;
  const callGAS = APP.callGAS;
  const vibrate = APP.vibrate;
  const speedKeAngka = APP.speedKeAngka;
  const numToComma = APP.numToComma;
  const formatSPKInfo = APP.formatSPKInfo;
  const playBeepSuccess = APP.playBeepSuccess;
  const playBeepFail = APP.playBeepFail;
  const RENTANG_SATUAN = APP.RENTANG_SATUAN;

  /* STATE LOKAL INPUT */
  let currentMesin = null;
  let currentKategori = null;
  let currentSPKData = null;
  let currentSPKValid = false;
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

  let lookupSeq = 0;
  let lookupDebounceTimer = null;
  let speedDebounceTimer = null;
  let satuanDebounceTimer = null;

  /* RENDER MESIN */
  function renderMesin() {
    const container = $('mesinContainer');
    if (!container) return;
    container.innerHTML = '';

    const daftarMesin = APP.getDaftarMesin();
    const kategoriMesin = APP.getKategoriMesin();
    const hasilInput = APP.getHasilInput();
    const pendingInput = APP.getPendingInput();

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
    APP.updateSummary();
  }
  APP.renderMesin = renderMesin;

  function refreshMesinButtons() {
    const hasilInput = APP.getHasilInput();
    const pendingInput = APP.getPendingInput();
    document.querySelectorAll('.mesin-btn').forEach(function (btn) {
      const nama = btn.dataset.mesin;
      const adaServer = hasilInput[nama] && hasilInput[nama].length > 0;
      const adaPending = pendingInput[nama] && pendingInput[nama].length > 0;
      if (adaServer || adaPending) btn.classList.add('filled');
      else btn.classList.remove('filled');
    });
  }

  /* SYNC DATA */
  function syncData() {
    const ctx = APP.getTanggalShift();
    if (!ctx.tanggal || !ctx.shift) { APP.hideSyncLoading(); return; }

    APP.showSyncLoading();

    callGAS({ action: 'getData', tanggal: ctx.tanggal, shift: ctx.shift })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.error) || 'Gagal memuat data.');
        const data = res.data || [];

        const hasilInput = {};
        data.forEach(function (row) {
          const mesin = String(row.mesin || '').trim();
          if (!mesin) return;
          if (!hasilInput[mesin]) hasilInput[mesin] = [];
          hasilInput[mesin].push({ id: row.id, noSPK: row.noSPK, speed: row.speed });
        });
        APP.setHasilInput(hasilInput);

        APP.hideSyncLoading();
        refreshMesinButtons();
        APP.updateSummary();

        const overlayList = $('overlayList');
        if (overlayList && overlayList.classList.contains('active') && listMesin) {
          renderList(listMesin);
        }
      })
      .catch(function (err) {
        APP.hideSyncLoading();
        const summary = $('summary');
        if (summary) { summary.textContent = 'Gagal memuat data.'; APP.setLastSummaryText(summary.textContent); }
        showToast('Gagal memuat data: ' + (err && err.message ? err.message : err), 'error');
        APP.updateRangkuman();
      });
  }
  APP.syncData = syncData;

  function onKontrolChange() {
    APP.setPendingInput({});
    syncData();
  }
  APP.onKontrolChange = onKontrolChange;

  /* KLIK MESIN */
  function onMesinClick(namaMesin) {
    if (APP.getIsSyncing()) return;
    const hasilInput = APP.getHasilInput();
    const pendingInput = APP.getPendingInput();
    const adaServer = hasilInput[namaMesin] && hasilInput[namaMesin].length > 0;
    const adaPending = pendingInput[namaMesin] && pendingInput[namaMesin].length > 0;
    if (adaServer || adaPending) openListOverlay(namaMesin);
    else openInputOverlay(namaMesin, 'tambah', null, null, false);
  }

  /* OVERLAY LIST */
  function openListOverlay(namaMesin) {
    listMesin = namaMesin;
    const kategoriMesin = APP.getKategoriMesin();
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

    const hasilInput = APP.getHasilInput();
    const pendingInput = APP.getPendingInput();
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

  /* OVERLAY INPUT */
  function openInputOverlay(namaMesin, mode, id, pIndex, fromList) {
    closeConfirmOverlay();
    const overlayList = $('overlayList');
    if (overlayList) overlayList.classList.remove('active');

    const kategoriMesin = APP.getKategoriMesin();
    const hasilInput = APP.getHasilInput();
    const pendingInput = APP.getPendingInput();

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
      title.textContent = namaMesin + ' · ' + currentKategori + (formMode === 'edit' ? ' · Edit Baris' : ' · Tambah Baris');
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
  APP.closeInputOverlay = closeInputOverlay;

  /* SPK INFO */
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

  /* SPK LOOKUP (OFFLINE - CACHE) */
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
  APP.onSPKInputChange = onSPKInputChange;

  function flushSPKLookup() {
    if (lookupDebounceTimer) { clearTimeout(lookupDebounceTimer); lookupDebounceTimer = null; }
    const el = $('spkInput');
    const noSPK = (el.value || '').replace(/[^0-9]/g, '').trim();
    if (noSPK !== '') runSPKLookup(noSPK);
  }
  APP.flushSPKLookup = flushSPKLookup;

  function runSPKLookup(noSPK) {
    const seq = ++lookupSeq;

    if (!APP.getMasterSPKLoaded()) {
      if (APP.getMasterSPKLoading()) {
        setTimeout(function () { if (seq === lookupSeq) runSPKLookup(noSPK); }, 500);
        return;
      } else {
        APP.loadMasterSPK();
        setTimeout(function () { if (seq === lookupSeq) runSPKLookup(noSPK); }, 1000);
        return;
      }
    }

    const masterSPK = APP.getMasterSPK();
    const key = String(noSPK).trim();
    const data = masterSPK[key];

    let infoMesin = { satuan: '', minSpeed: null, maxSpeed: null };
    const mesinMinMap = APP.getMesinMinMap();

    if (!mesinMinMap) {
      callGAS({ action: 'getMesinDetail' }).then(function (res) {
        if (res && res.success && res.data) {
          const map = {};
          res.data.forEach(function (row) {
            const nama = String(row.mesin || '').trim();
            if (!nama) return;
            map[nama] = {
              minSpeed: (row.minSpeed != null ? Number(row.minSpeed) : null),
              satuan: String(row.satuan || '').trim()
            };
          });
          APP.setMesinMinMap(map);
        }
      });
      infoMesin = { satuan: '', minSpeed: null, maxSpeed: null };
    } else {
      const cachedMesin = mesinMinMap[currentMesin];
      if (cachedMesin) {
        infoMesin = {
          satuan: cachedMesin.satuan || '',
          minSpeed: cachedMesin.minSpeed,
          maxSpeed: null
        };
      }
    }

    const res = { success: true, found: !!data, valid: false, error: '', data: data, mesinInfo: infoMesin };

    if (!data) {
      res.error = 'No SPK "' + key + '" tidak ditemukan di database.';
    } else {
      const kategoriMesinUpper = String(currentKategori || '').toUpperCase();
      const kodeSPK = data.kodeJenis;
      if (kodeSPK !== kategoriMesinUpper) {
        res.error = 'Jenis plastik tidak cocok! Mesin: ' + kategoriMesinUpper + ' · SPK: ' + kodeSPK;
      } else {
        res.valid = true;
      }
    }

    handleLookupResult(res);
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

  /* SPEED: satuan instan, Min/Max tunda 800ms */
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

    if (immediate) { validateSpeed(); return; }

    speedDebounceTimer = setTimeout(function () {
      speedDebounceTimer = null;
      validateMinMaxSaja();
    }, 800);
  }
  APP.onSpeedChange = onSpeedChange;

  function validasiSatuanSaja() {
    const el = $('speedInput');
    const raw = (el.value || '').trim();
    const nilai = speedKeAngka(raw);
    speedError = false;
    if (raw === '' || nilai === null) { updateOkState(); return; }

    const satuanKey = String(currentMesinInfo.satuan || '').trim().toLowerCase();
    if (satuanKey !== '' && RENTANG_SATUAN[satuanKey]) {
      const r = RENTANG_SATUAN[satuanKey];
      if (nilai < r.min || nilai > r.max) {
        speedError = true;
        const labelSatuan = currentMesinInfo.satuan;
        setSPKInfo('Speed ' + raw + ' di luar rentang ' + labelSatuan + ' (' + r.label + ')', 'error');
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
        setSPKInfo('Speed ' + raw + ' ' + ket + satuanTeks + ' — periksa kembali', 'warning');
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

  function updateOkState() {
    const speedOk = $('speedInput').value.trim() !== '';
    const spkOk = currentSPKValid;
    const satuanOk = !speedError;
    $('btnOk').disabled = !(spkOk && speedOk && satuanOk);
  }

  /* SCANNER */
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
      function () {}
    );
  }
  APP.openScanner = openScanner;

  /* OK */
  function onOk() {
    if (!currentSPKValid || !currentSPKData || !currentMesin) return;
    if (speedError) return;

    const speed = $('speedInput').value.trim();
    if (speed === '') return;

    const noSPK = currentSPKData.noSPK;
    const mesin = currentMesin;
    const mode = formMode;
    const id = editId;

    const pendingInput = APP.getPendingInput();
    const hasilInput = APP.getHasilInput();

    if (mode === 'edit' && pendingEditIndex !== null) {
      const rows = pendingInput[mesin] || [];
      if (rows[pendingEditIndex]) {
        rows[pendingEditIndex].noSPK = noSPK;
        rows[pendingEditIndex].speed = speed;
        pendingInput[mesin] = rows;
        APP.setPendingInput(pendingInput);
      }
      closeInputOverlay();
      refreshMesinButtons();
      APP.updateSummary();
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
          if (!res || !res.success) { showToast('Gagal edit: ' + ((res && res.error) || 'unknown'), 'error'); return; }
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
    APP.setPendingInput(pendingInput);

    closeInputOverlay();
    refreshMesinButtons();
    APP.updateSummary();
    if (listMesin) renderList(listMesin);
    showToast('Baris ditambahkan. Tekan Simpan untuk mengirim.', 'success');
  }
  APP.onOk = onOk;

  /* KONFIRMASI HAPUS */
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
  APP.closeConfirmOverlay = closeConfirmOverlay;

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
          if (!res || !res.success) { showToast('Gagal hapus: ' + ((res && res.error) || 'unknown'), 'error'); return; }
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
      const pendingInput = APP.getPendingInput();
      const rows = pendingInput[mesin] || [];
      rows.splice(pIdx, 1);
      if (rows.length === 0) delete pendingInput[mesin];
      else pendingInput[mesin] = rows;
      APP.setPendingInput(pendingInput);
    }

    closeConfirmOverlay();
    refreshMesinButtons();
    APP.updateSummary();
    if (listMesin) renderList(listMesin);
    showToast('Baris dihapus.', 'success');
  }
  APP.onHapusConfirmed = onHapusConfirmed;

  /* SIMPAN (batch pending) */
  function onSimpan() {
    if (APP.getIsSaving()) return;

    const ctx = APP.getTanggalShift();
    if (!ctx.tanggal) { showToast('Tanggal belum diisi.', 'error'); return; }

    const pendingInput = APP.getPendingInput();
    const rows = [];
    Object.keys(pendingInput).forEach(function (mesin) {
      const list = pendingInput[mesin] || [];
      list.forEach(function (r) {
        rows.push({ tanggal: ctx.tanggal, shift: ctx.shift, mesin: mesin, noSPK: r.noSPK, speed: r.speed });
      });
    });

    if (rows.length === 0) { showToast('Belum ada baris baru untuk disimpan.', 'error'); return; }

    const btn = $('btnSimpan');
    APP.setIsSaving(true);
    btn.disabled = true;
    btn.textContent = '⏳ Menyimpan...';

    callGAS({ action: 'tambahBanyak', rows: JSON.stringify(rows) })
      .then(function (res) {
        btn.disabled = false;
        btn.textContent = '💾 Simpan ke Sheet Inputan';
        APP.setIsSaving(false);

        if (!res || !res.success) { showToast('Gagal simpan: ' + ((res && res.error) || 'unknown'), 'error'); return; }

        const jumlah = res.jumlah != null ? res.jumlah : rows.length;
        APP.setPendingInput({});
        APP.updateSummary();

        if (res.duplikat > 0) {
          showToast('Disimpan: ' + jumlah + ' baris. ' + res.duplikat + ' baris dilewati (duplikat).', 'success');
        } else {
          showToast('Berhasil disimpan: ' + jumlah + ' baris.', 'success');
        }

        syncData();
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = '💾 Simpan ke Sheet Inputan';
        APP.setIsSaving(false);
        showToast('Gagal simpan: ' + (err && err.message ? err.message : err), 'error');
      });
  }
  APP.onSimpan = onSimpan;

  /* BIND EVENTS (khusus tab input) */
  function bindEvents() {
    const btnCloseInput = $('btnCloseInput'); if (btnCloseInput) btnCloseInput.addEventListener('click', closeInputOverlay);
    const btnCancelInput = $('btnCancelInput'); if (btnCancelInput) btnCancelInput.addEventListener('click', closeInputOverlay);
    const btnOk = $('btnOk'); if (btnOk) btnOk.addEventListener('click', onOk);
    const btnScan = $('btnScan'); if (btnScan) btnScan.addEventListener('click', openScanner);

    const spkInput = $('spkInput');
    if (spkInput) {
      spkInput.addEventListener('input', onSPKInputChange);
      spkInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); flushSPKLookup(); } });
    }
    const speedInput = $('speedInput'); if (speedInput) speedInput.addEventListener('input', onSpeedChange);
    const btnSimpan = $('btnSimpan'); if (btnSimpan) btnSimpan.addEventListener('click', onSimpan);

    const tanggal = $('tanggal'); if (tanggal) tanggal.addEventListener('change', onKontrolChange);
    const shift = $('shift'); if (shift) shift.addEventListener('change', onKontrolChange);

    const btnCloseList = $('btnCloseList'); if (btnCloseList) btnCloseList.addEventListener('click', closeListOverlay);
    const btnTambahBaris = $('btnTambahBaris'); if (btnTambahBaris) btnTambahBaris.addEventListener('click', onTambahBarisClick);

    const btnCloseConfirm = $('btnCloseConfirm'); if (btnCloseConfirm) btnCloseConfirm.addEventListener('click', closeConfirmOverlay);
    const btnCancelConfirm = $('btnCancelConfirm'); if (btnCancelConfirm) btnCancelConfirm.addEventListener('click', closeConfirmOverlay);
    const btnYesConfirm = $('btnYesConfirm'); if (btnYesConfirm) btnYesConfirm.addEventListener('click', onHapusConfirmed);
  }
  APP.bindEvents = bindEvents;

})();
