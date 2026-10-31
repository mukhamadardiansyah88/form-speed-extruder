/* ============================================================
   APP-REKAP — Rekap Speed (Read-Only), Detail Cell, Rekap Mesin
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
  const ymdToDDMMYY = APP.ymdToDDMMYY;
  const ymdToLocale = APP.ymdToLocale;
  const addDays = APP.addDays;
  const formatSPKInfo = APP.formatSPKInfo;
  const SHIFT_LABEL = APP.SHIFT_LABEL;

  const LONG_PRESS_DURATION = 500;
  let pressTimer = null;

  /* REKAP: KONTROL */
  function initRekapControls() {
    const awal = $('rekapTanggalAwal');
    const akhir = $('rekapTanggalAkhir');
    const btnLoad = $('btnLoadRekap');

    const today = APP.ymd(new Date());
    const hMinus6 = addDays(today, -6);

    if (awal) {
      awal.value = hMinus6;
      awal.addEventListener('change', rebuildComboAkhir);
    }
    rebuildComboAkhir();
    if (btnLoad) btnLoad.addEventListener('click', loadRekap);

    const filterShift = $('filterShift');
    const filterKategori = $('filterKategori');
    if (filterShift) filterShift.addEventListener('change', renderRekapFromCache);
    if (filterKategori) filterKategori.addEventListener('change', renderRekapFromCache);
  }
  APP.initRekapControls = initRekapControls;

  function rebuildComboAkhir() {
    const awal = $('rekapTanggalAwal');
    const akhir = $('rekapTanggalAkhir');
    if (!awal || !akhir) return;
    akhir.innerHTML = '';
    const start = awal.value;
    if (!start) return;
    for (let i = 0; i < 7; i++) {
      const tgl = addDays(start, i);
      const opt = document.createElement('option');
      opt.value = tgl;
      opt.textContent = ymdToLocale(tgl);
      akhir.appendChild(opt);
    }
    akhir.value = addDays(start, 6);
  }

  /* REKAP: LOAD */
  function loadRekap() {
    const awal = $('rekapTanggalAwal');
    const akhir = $('rekapTanggalAkhir');
    if (!awal || !akhir) return;
    const tglAwal = awal.value;
    const tglAkhir = akhir.value;
    if (!tglAwal || !tglAkhir) { showToast('Tanggal awal/akhir belum dipilih.', 'error'); return; }
    if (tglAwal > tglAkhir) { showToast('Tanggal awal > akhir.', 'error'); return; }

    const btn = $('btnLoadRekap');
    btn.disabled = true;

    APP.ensureSyncOverlay();
    const ov = $('syncOverlay');
    if (ov) ov.classList.add('active');

    const needMin = (APP.getMesinMinMap() == null);
    const pMin = needMin ? loadMesinDetail() : Promise.resolve();

    pMin.then(function () {
      return callGAS({ action: 'getRekap', tanggalAwal: tglAwal, tanggalAkhir: tglAkhir });
    })
    .then(function (res) {
      if (ov) ov.classList.remove('active');
      btn.disabled = false;
      if (!res || !res.success) { showToast('Gagal rekap: ' + ((res && res.error) || 'unknown'), 'error'); return; }
      APP.setRekapLoaded(true);
      APP.setRekapRawData(res.data || []);
      renderRekapFromCache();
      const sum = $('rekapSummary');
      if (sum) sum.textContent = APP.getRekapRawData().length + ' baris dalam rentang ' + ymdToDDMMYY(tglAwal) + ' – ' + ymdToDDMMYY(tglAkhir);
    })
    .catch(function (err) {
      if (ov) ov.classList.remove('active');
      btn.disabled = false;
      showToast('Gagal rekap: ' + (err && err.message ? err.message : err), 'error');
    });
  }

  function loadMesinDetail() {
    return callGAS({ action: 'getMesinDetail' })
      .then(function (res) {
        if (!res || !res.success || !res.data) { APP.setMesinMinMap({}); return; }
        const map = {};
        res.data.forEach(function (row) {
          const nama = String(row.mesin || '').trim();
          if (!nama) return;
          map[nama] = (row.minSpeed != null ? Number(row.minSpeed) : null);
        });
        APP.setMesinMinMap(map);
      })
      .catch(function () { APP.setMesinMinMap({}); });
  }

  function getCheckedValues(containerId) {
    const wrap = $(containerId);
    if (!wrap) return [];
    const arr = [];
    wrap.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      if (cb.checked) arr.push(cb.value);
    });
    return arr;
  }

  /* REKAP: RENDER */
  function renderRekapFromCache() {
    if (!APP.getRekapLoaded()) return;
    const table = $('rekapTable'), thead = $('rekapThead'), tbody = $('rekapTbody'), empty = $('rekapEmpty');
    if (!table || !thead || !tbody) return;

    const awal = $('rekapTanggalAwal').value;
    const akhir = $('rekapTanggalAkhir').value;
    if (!awal || !akhir) return;

    const shiftChecked = getCheckedValues('filterShift');
    const katChecked = getCheckedValues('filterKategori');

    if (shiftChecked.length === 0) {
      thead.innerHTML = ''; tbody.innerHTML = ''; table.classList.add('hidden');
      if (empty) { empty.classList.remove('hidden'); empty.textContent = 'Pilih minimal satu shift.'; }
      return;
    }

    const tanggalList = [];
    for (let i = 0; i < 7; i++) {
      const tgl = addDays(awal, i);
      if (tgl > akhir) break;
      tanggalList.push(tgl);
    }

    const kategoriMesin = APP.getKategoriMesin();
    const mesinList = APP.getDaftarMesin().filter(function (m) {
      const kat = kategoriMesin[m] || 'LAIN';
      if (kat === 'PP') return katChecked.indexOf('PP') !== -1;
      if (kat === 'PE') return katChecked.indexOf('PE') !== -1;
      if (kat === 'HD') return katChecked.indexOf('HD') !== -1;
      return false;
    });

    if (mesinList.length === 0) {
      thead.innerHTML = ''; tbody.innerHTML = ''; table.classList.add('hidden');
      if (empty) { empty.classList.remove('hidden'); empty.textContent = 'Tidak ada mesin sesuai filter.'; }
      return;
    }

    const map = {};
    APP.getRekapRawData().forEach(function (r) {
      if (shiftChecked.indexOf(r.shift) === -1) return;
      if (!map[r.mesin]) map[r.mesin] = {};
      if (!map[r.mesin][r.tanggal]) map[r.mesin][r.tanggal] = {};
      if (!map[r.mesin][r.tanggal][r.shift]) map[r.mesin][r.tanggal][r.shift] = [];
      map[r.mesin][r.tanggal][r.shift].push({ id: r.id, noSPK: r.noSPK, speed: r.speed });
    });

    /* HEADER */
    thead.innerHTML = '';
    const trTop = document.createElement('tr');
    const thMesinTop = document.createElement('th');
    thMesinTop.rowSpan = 2;
    thMesinTop.className = 'th-mesin header-mesin-top';
    thMesinTop.textContent = 'MESIN';
    trTop.appendChild(thMesinTop);

    tanggalList.forEach(function (tgl) {
      const th = document.createElement('th');
      th.colSpan = shiftChecked.length;
      th.className = 'th-group header-date';
      th.textContent = ymdToDDMMYY(tgl);
      trTop.appendChild(th);
    });
    thead.appendChild(trTop);

    const trBottom = document.createElement('tr');
    tanggalList.forEach(function () {
      shiftChecked.forEach(function (sh) {
        const th = document.createElement('th');
        th.className = 'th-shift header-shift';
        th.textContent = SHIFT_LABEL[sh] || sh;
        trBottom.appendChild(th);
      });
    });
    thead.appendChild(trBottom);

    /* BODY */
    tbody.innerHTML = '';
    const mesinMinMap = APP.getMesinMinMap() || {};

    mesinList.forEach(function (mesin) {
      const tr = document.createElement('tr');

      const tdMesin = document.createElement('td');
      tdMesin.className = 'cell-mesin cell-mesin-highlight cell-clickable';
      tdMesin.textContent = mesin;
      tr.appendChild(tdMesin);

      const contextMesin = { mesin: mesin, tanggalList: tanggalList, shiftChecked: shiftChecked };

      tdMesin.addEventListener('dblclick', function() { bukaRekapMesin(contextMesin); });
      tdMesin.addEventListener('touchstart', function() {
        pressTimer = setTimeout(function() { vibrate(); bukaRekapMesin(contextMesin); }, LONG_PRESS_DURATION);
      }, { passive: true });
      tdMesin.addEventListener('touchend', function() { if (pressTimer) clearTimeout(pressTimer); });
      tdMesin.addEventListener('touchmove', function() { if (pressTimer) clearTimeout(pressTimer); });

      const minSpeed = (mesinMinMap[mesin] != null) ? mesinMinMap[mesin] : null;

      tanggalList.forEach(function (tgl) {
        shiftChecked.forEach(function (sh) {
          const td = document.createElement('td');
          td.className = 'cell-speed';
          const arr = (map[mesin] && map[mesin][tgl] && map[mesin][tgl][sh]) || [];
          if (arr.length === 0) {
            td.textContent = '—';
          } else {
            let hasBelowMin = false;
            if (minSpeed != null) {
              arr.forEach(function (item) {
                const n = speedKeAngka(item.speed);
                if (n != null && n < minSpeed) hasBelowMin = true;
              });
            }
            td.textContent = arr.map(function(item) { return item.speed; }).join(' · ');
            if (arr.length > 1) td.classList.add('multi-data');
            if (hasBelowMin) td.classList.add('below-min');
            td.dataset.items = JSON.stringify(arr);
            td.classList.add('cell-clickable');

            const contextData = { mesin: mesin, tanggal: ymdToDDMMYY(tgl), shift: SHIFT_LABEL[sh] || sh, items: arr };
            td.addEventListener('dblclick', function() { bukaInfoDetail(contextData); });
            td.addEventListener('touchstart', function() {
              pressTimer = setTimeout(function() { vibrate(); bukaInfoDetail(contextData); }, LONG_PRESS_DURATION);
            }, { passive: true });
            td.addEventListener('touchend', function() { if (pressTimer) clearTimeout(pressTimer); });
            td.addEventListener('touchmove', function() { if (pressTimer) clearTimeout(pressTimer); });
          }
          tr.appendChild(td);
        });
      });
      tbody.appendChild(tr);
    });
    table.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
  }

  /* OVERLAY INFO DETAIL (PER CELL) */
  function bukaInfoDetail(context) {
    const items = context.items;
    if (!items || items.length === 0) return;
    const container = $('infoContainer');
    if (!container) return;
    container.innerHTML = '';
    const titleEl = document.querySelector('#overlayInfo .modal-title');
    if (titleEl) titleEl.textContent = 'Detail · ' + context.mesin + ' · ' + context.tanggal + ' · ' + context.shift;

    let adaData = false;
    const masterSPK = APP.getMasterSPK();
    items.forEach(function(item) {
      const spkData = masterSPK[item.noSPK] || {};
      const detail = {
        noSPK: item.noSPK,
        speed: item.speed,
        jenisPlastik: spkData.jenisPlastik || '—',
        tebal: spkData.tebal || '—',
        lebar: spkData.lebar || '—',
        lipat: spkData.lipat || ''
      };
      adaData = true;
      container.appendChild(buildInfoCard(detail));
    });

    if (!adaData) container.innerHTML = '<div class="list-empty">Data detail tidak ditemukan.</div>';
    const overlayInfo = $('overlayInfo');
    if (overlayInfo) overlayInfo.classList.add('active');
  }

  function buildInfoCard(d) {
    const card = document.createElement('div');
    card.className = 'info-card';

    const r1 = document.createElement('div');
    r1.className = 'info-row';
    r1.innerHTML = '<span class="info-label">No SPK</span><span class="info-value highlight">' + (d.noSPK || '—') + '</span>';
    card.appendChild(r1);

    const r2 = document.createElement('div');
    r2.className = 'info-row';
    r2.innerHTML = '<span class="info-label">Spesifikasi</span><span class="info-value">' + formatSPKInfo(d) + '</span>';
    card.appendChild(r2);

    const r3 = document.createElement('div');
    r3.className = 'info-row';
    r3.innerHTML = '<span class="info-label">Speed</span><span class="info-value highlight">' + (d.speed || '—') + '</span>';
    card.appendChild(r3);

    return card;
  }

  /* OVERLAY REKAP PER MESIN */
  function bukaRekapMesin(context) {
    const mesin = context.mesin;
    const tanggalList = context.tanggalList;
    const shiftChecked = context.shiftChecked;
    const container = $('infoContainer');
    if (!container) return;
    container.innerHTML = '';
    const titleEl = document.querySelector('#overlayInfo .modal-title');
    if (titleEl) titleEl.textContent = 'Rekap Mesin · ' + mesin;

    const masterSPK = APP.getMasterSPK();
    const mapData = {};
    APP.getRekapRawData().forEach(function (r) {
      if (r.mesin !== mesin) return;
      if (shiftChecked.indexOf(r.shift) === -1) return;
      if (!mapData[r.tanggal]) mapData[r.tanggal] = {};
      if (!mapData[r.tanggal][r.shift]) mapData[r.tanggal][r.shift] = [];
      mapData[r.tanggal][r.shift].push({ id: r.id, noSPK: r.noSPK, speed: r.speed });
    });

    let adaBaris = false;
    tanggalList.forEach(function (tgl) {
      shiftChecked.forEach(function (sh) {
        const rows = (mapData[tgl] && mapData[tgl][sh]) || [];
        if (rows.length === 0) {
          adaBaris = true;
          container.appendChild(buildRekapCard(ymdToDDMMYY(tgl), SHIFT_LABEL[sh] || sh, null, null));
        } else {
          rows.forEach(function(row) {
            adaBaris = true;
            const spkData = masterSPK[row.noSPK] || {};
            const ukuran = formatSPKInfo({
              jenisPlastik: spkData.jenisPlastik,
              tebal: spkData.tebal,
              lebar: spkData.lebar,
              lipat: spkData.lipat
            });
            container.appendChild(buildRekapCard(ymdToDDMMYY(tgl), SHIFT_LABEL[sh] || sh, ukuran, row.speed));
          });
        }
      });
    });

    if (!adaBaris) container.innerHTML = '<div class="list-empty">Tidak ada data untuk mesin ini pada rentang/filter yang dipilih.</div>';
    const overlayInfo = $('overlayInfo');
    if (overlayInfo) overlayInfo.classList.add('active');
  }

  function buildRekapCard(tanggal, shift, ukuran, speed) {
    const card = document.createElement('div');
    card.className = 'info-card';

    const r1 = document.createElement('div');
    r1.className = 'info-row';
    r1.innerHTML = '<span class="info-label">' + tanggal + '</span><span class="info-value" style="color:var(--neon-pink)">' + shift + '</span>';
    card.appendChild(r1);

    const r2 = document.createElement('div');
    r2.className = 'info-row';
    r2.innerHTML = '<span class="info-label">Ukuran</span><span class="info-value">' + (ukuran || '—') + '</span>';
    card.appendChild(r2);

    const r3 = document.createElement('div');
    r3.className = 'info-row';
    r3.innerHTML = '<span class="info-label">Speed</span><span class="info-value highlight">' + (speed || '—') + '</span>';
    card.appendChild(r3);

    return card;
  }

  function closeInfoOverlay() {
    const overlayInfo = $('overlayInfo');
    if (overlayInfo) overlayInfo.classList.remove('active');
  }
  APP.closeInfoOverlay = closeInfoOverlay;

  /* BIND EVENTS (khusus overlay info) */
  document.addEventListener('DOMContentLoaded', function () {
    const btnCloseInfo = $('btnCloseInfo');
    if (btnCloseInfo) btnCloseInfo.addEventListener('click', closeInfoOverlay);
    const btnTutupInfo = $('btnTutupInfo');
    if (btnTutupInfo) btnTutupInfo.addEventListener('click', closeInfoOverlay);
  });

})();
