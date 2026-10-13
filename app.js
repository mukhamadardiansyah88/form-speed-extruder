/* ============================================================
   APP — Logic Form Speed Extruder
   ============================================================ */

(function () {

  /* ------------------------------------------------------------
     STATE GLOBAL
     ------------------------------------------------------------ */
  let daftarMesin = [];
  let kategoriMesin = {};
  let hasilInput = {};
  let currentMesin = null;
  let currentKategori = null;
  let currentSPKData = null;
  let currentSPKValid = false;
  let toastTimer = null;
  let lookupSeq = 0;

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

    const overlayInput = $('overlayInput');
    if (overlayInput) {
      overlayInput.addEventListener('click', function (e) {
        if (e.target.id === 'overlayInput') closeInputOverlay();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        const overlay = $('overlayInput');
        if (overlay && overlay.classList.contains('active')) closeInputOverlay();
      }
    });
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
        if (hasilInput[nama]) btn.classList.add('filled');
        btn.addEventListener('click', function () { openInputOverlay(nama); });
        grid.appendChild(btn);
      });

      section.appendChild(grid);
      container.appendChild(section);
    });

    if (!ada) {
      container.innerHTML = '<div class="loading-wrap">Tidak ada mesin terdaftar.</div>';
    }

    updateSummary();
  }

  function refreshMesinButtons() {
    document.querySelectorAll('.mesin-btn').forEach(function (btn) {
      const nama = btn.dataset.mesin;
      if (hasilInput[nama]) btn.classList.add('filled');
      else btn.classList.remove('filled');
    });
  }

  /* ------------------------------------------------------------
     OVERLAY INPUT
     ------------------------------------------------------------ */
  function openInputOverlay(namaMesin) {
    currentMesin = namaMesin;
    currentKategori = kategoriMesin[namaMesin] || 'LAIN';
    currentSPKData = null;
    currentSPKValid = false;

    $('modalTitle').textContent = namaMesin + ' · ' + currentKategori;

    const spkInput = $('spkInput');
    const speedInput = $('speedInput');

    if (hasilInput[namaMesin]) {
      const ok = confirm(
        'Mesin ' + namaMesin + ' sudah diisi:\n\n' +
        'No SPK: ' + hasilInput[namaMesin].noSPK + '\n' +
        'Speed: ' + hasilInput[namaMesin].speed + '\n\n' +
        'Edit ulang?'
      );
      if (!ok) {
        currentMesin = null;
        currentKategori = null;
        return;
      }
      spkInput.value = hasilInput[namaMesin].noSPK || '';
      speedInput.value = hasilInput[namaMesin].speed || '';
    } else {
      spkInput.value = '';
      speedInput.value = '';
    }

    resetSPKInfo();
    $('btnOk').disabled = true;
    $('overlayInput').classList.add('active');

    if (spkInput.value.trim() !== '') {
      onSPKInputChange();
    }

    setTimeout(function () { spkInput.focus(); }, 120);
  }

  function closeInputOverlay() {
    const overlay = $('overlayInput');
    if (overlay) overlay.classList.remove('active');
    currentMesin = null;
    currentKategori = null;
    currentSPKData = null;
    currentSPKValid = false;
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
     SPK LOOKUP (juga filter angka 0-9)
     ------------------------------------------------------------ */
  function onSPKInputChange() {
    const el = $('spkInput');

    // Filter: hanya angka 0-9 (SPK = angka murni)
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
      updateOkState();
    });
  }

  function handleLookupResult(res) {
    if (!res || !res.success) {
      currentSPKData = null;
      currentSPKValid = false;
      setSPKInfo((res && res.error) || 'Gagal mencari SPK.', 'error');
      updateOkState();
      return;
    }

    if (!res.found) {
      currentSPKData = null;
      currentSPKValid = false;
      setSPKInfo(res.error || 'No SPK tidak ditemukan.', 'error');
      updateOkState();
      return;
    }

    if (!res.valid) {
      currentSPKData = res.data || null;
      currentSPKValid = false;
      setSPKInfo(res.error || 'Jenis plastik tidak cocok.', 'error');
      updateOkState();
      return;
    }

    currentSPKData = res.data;
    currentSPKValid = true;

    const teks = 'Order ' + res.data.jenisPlastik + ' ' + res.data.tebal + ' x ' + res.data.lebar;
    setSPKInfo(teks, 'success');
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

    // Titik → koma (biar user yang ketik 14.6 tetap aman)
    v = v.replace(/\./g, ',');

    // Hanya angka + koma
    v = v.replace(/[^0-9,]/g, '');

    // Hanya satu koma
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
     OK
     ------------------------------------------------------------ */
  function onOk() {
    if (!currentSPKValid || !currentSPKData || !currentMesin) return;

    const speed = $('speedInput').value.trim();
    if (speed === '') return;

    hasilInput[currentMesin] = {
      noSPK: currentSPKData.noSPK,
      speed: speed
    };

    const btn = document.querySelector('.mesin-btn[data-mesin="' + cssEscape(currentMesin) + '"]');
    if (btn) btn.classList.add('filled');

    updateSummary();

    const mesinSimpan = currentMesin;
    closeInputOverlay();
    showToast('Mesin ' + mesinSimpan + ' tersimpan.', 'success');
  }

  /* ------------------------------------------------------------
     SIMPAN
     ------------------------------------------------------------ */
  function onSimpan() {
    const tanggal = $('tanggal').value;
    const shift = $('shift').value;

    if (!tanggal) {
      showToast('Tanggal belum diisi.', 'error');
      return;
    }

    const rows = [];
    Object.keys(hasilInput).forEach(function (mesin) {
      const item = hasilInput[mesin];
      if (!item || !item.noSPK || !item.speed) return;
      rows.push({
        tanggal: tanggal,
        shift: shift,
        mesin: mesin,
        noSPK: item.noSPK,
        speed: item.speed
      });
    });

    if (rows.length === 0) {
      showToast('Belum ada mesin yang diisi.', 'error');
      return;
    }

    const btn = $('btnSimpan');
    btn.disabled = true;
    btn.textContent = '⏳ Menyimpan...';

    callGAS({
      action: 'simpan',
      rows: JSON.stringify(rows)
    })
    .then(function (res) {
      btn.disabled = false;
      btn.textContent = '💾 Simpan ke Sheet Inputan';

      if (!res || !res.success) {
        showToast('Gagal simpan: ' + ((res && res.error) || 'unknown'), 'error');
        return;
      }

      showToast('Berhasil disimpan: ' + res.jumlah + ' baris.', 'success');

      hasilInput = {};
      refreshMesinButtons();
      updateSummary();
    })
    .catch(function (err) {
      btn.disabled = false;
      btn.textContent = '💾 Simpan ke Sheet Inputan';
      showToast('Gagal simpan: ' + (err && err.message ? err.message : err), 'error');
    });
  }

  /* ------------------------------------------------------------
     SUMMARY
     ------------------------------------------------------------ */
  function updateSummary() {
    const total = Object.keys(hasilInput).length;
    const el = $('summary');
    const btn = $('btnSimpan');
    if (!el || !btn) return;

    if (total === 0) {
      el.textContent = 'Belum ada mesin yang diisi.';
      btn.disabled = true;
    } else {
      el.textContent = total + ' mesin siap disimpan.';
      btn.disabled = false;
    }
  }

})();
