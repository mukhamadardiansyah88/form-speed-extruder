/* ============================================================
   APP-CORE — State, Util, JSONP, Init Dasar, Load Mesin, Sync
   Form Speed Extruder
   ============================================================
   Dibaca oleh: app-input.js, app-rekap.js (via window.APP)
   ============================================================ */

(function () {

  const APP = window.APP = window.APP || {};

  /* STATE GLOBAL */
  let daftarMesin = [];
  let kategoriMesin = {};
  let hasilInput = {};
  let pendingInput = {};

  let masterSPK = {};
  let masterSPKLoaded = false;
  let masterSPKLoading = false;

  let isSyncing = false;
  let isSaving = false;
  let toastTimer = null;
  let lastSummaryText = '';
  let lastRangkuman = { pp: -1, pe: -1, hd: -1, total: -1 };

  let rekapLoaded = false;
  let rekapRawData = [];
  let mesinMinMap = null;

  const RENTANG_SATUAN = {
    'persnelleng': { min: 1, max: 4, label: '1–4' },
    'hz':          { min: 4.0001, max: 60, label: '4,0001–60' },
    'rpm':         { min: 60.0001, max: 1800, label: '60,0001–1800' }
  };

  const SHIFT_LABEL = { 'SHIFT-PAGI': 'PAGI', 'SHIFT-SORE': 'SORE', 'SHIFT-MALAM': 'MALAM' };

  /* EKSPOR STATE & SETTER */
  APP.getDaftarMesin = function () { return daftarMesin; };
  APP.setDaftarMesin = function (v) { daftarMesin = v; };
  APP.getKategoriMesin = function () { return kategoriMesin; };
  APP.setKategoriMesin = function (v) { kategoriMesin = v; };
  APP.getHasilInput = function () { return hasilInput; };
  APP.setHasilInput = function (v) { hasilInput = v; };
  APP.getPendingInput = function () { return pendingInput; };
  APP.setPendingInput = function (v) { pendingInput = v; };
  APP.getMasterSPK = function () { return masterSPK; };
  APP.setMasterSPK = function (v) { masterSPK = v; };
  APP.getMasterSPKLoaded = function () { return masterSPKLoaded; };
  APP.setMasterSPKLoaded = function (v) { masterSPKLoaded = v; };
  APP.getMasterSPKLoading = function () { return masterSPKLoading; };
  APP.setMasterSPKLoading = function (v) { masterSPKLoading = v; };
  APP.getIsSyncing = function () { return isSyncing; };
  APP.setIsSyncing = function (v) { isSyncing = v; };
  APP.getIsSaving = function () { return isSaving; };
  APP.setIsSaving = function (v) { isSaving = v; };
  APP.getRekapLoaded = function () { return rekapLoaded; };
  APP.setRekapLoaded = function (v) { rekapLoaded = v; };
  APP.getRekapRawData = function () { return rekapRawData; };
  APP.setRekapRawData = function (v) { rekapRawData = v; };
  APP.getMesinMinMap = function () { return mesinMinMap; };
  APP.setMesinMinMap = function (v) { mesinMinMap = v; };
  APP.getLastSummaryText = function () { return lastSummaryText; };
  APP.setLastSummaryText = function (v) { lastSummaryText = v; };
  APP.getLastRangkuman = function () { return lastRangkuman; };
  APP.setLastRangkuman = function (v) { lastRangkuman = v; };
  APP.RENTANG_SATUAN = RENTANG_SATUAN;
  APP.SHIFT_LABEL = SHIFT_LABEL;

  /* UTIL */
  function $(id) { return document.getElementById(id); }
  APP.$ = $;

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
  APP.showToast = showToast;

  function speedKeAngka(str) {
    if (str == null) return null;
    const s = String(str).trim().replace(',', '.');
    if (s === '') return null;
    const n = Number(s);
    return isNaN(n) ? null : n;
  }
  APP.speedKeAngka = speedKeAngka;

  function numToComma(n) { return String(n).replace('.', ','); }
  APP.numToComma = numToComma;

  function vibrate() {
    if (navigator.vibrate) { try { navigator.vibrate([300,100,300,100,500,200,100,300]); } catch (e) {} }
  }
  APP.vibrate = vibrate;

  function ymd(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
  }
  APP.ymd = ymd;

  function ymdToDate(ymdStr) {
    const parts = ymdStr.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  APP.ymdToDate = ymdToDate;

  function ymdToDDMMYY(ymdStr) {
    if (!ymdStr || ymdStr.length < 10) return ymdStr;
    return ymdStr.substring(8,10) + '-' + ymdStr.substring(5,7) + '-' + ymdStr.substring(2,4);
  }
  APP.ymdToDDMMYY = ymdToDDMMYY;

  function ymdToLocale(ymdStr) {
    if (!ymdStr || ymdStr.length < 10) return ymdStr;
    try { return ymdToDate(ymdStr).toLocaleDateString('id-ID'); } catch (e) { return ymdStr; }
  }
  APP.ymdToLocale = ymdToLocale;

  function addDays(ymdStr, n) {
    const d = ymdToDate(ymdStr);
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  APP.addDays = addDays;

  function getTanggalShift() {
    return { tanggal: $('tanggal').value, shift: $('shift').value };
  }
  APP.getTanggalShift = getTanggalShift;

  /* FORMAT TEBAL
     Hanya 0,1 -> 0,10 dan 0,2 -> 0,20.
     Nilai lain APA ADANYA (string-based, tanpa pembulatan).
     Contoh tetap: 0,025 ; 0,0425 ; 1 ; 0,15 ; 0,10 ; 0,20 */
  function formatTebal(tebal) {
    if (tebal == null) return '';
    const s = String(tebal).trim();
    if (s === '') return '';
    if (s === '0,1') return '0,10';
    if (s === '0,2') return '0,20';
    return s;
  }
  APP.formatTebal = formatTebal;

  function formatSPKInfo(d) {
    const lebar = (d.lebar || '').trim();
    const lipatRaw = (d.lipat || '').trim();
    const lipat = (lipatRaw === '' || lipatRaw === '0') ? '' : lipatRaw;
    let ukuran = '';
    if (lebar && lipat) ukuran = lebar + '/' + lipat;
    else if (lebar) ukuran = lebar;
    else if (lipat) ukuran = '?/' + lipat;
    else ukuran = '—';
    return d.jenisPlastik + ' ' + formatTebal(d.tebal) + ' x ' + ukuran;
  }
  APP.formatSPKInfo = formatSPKInfo;

  /* BEEP (WebAudio) */
  function playBeepSuccess() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const t0 = ctx.currentTime;
      [{f:660,t:0},{f:880,t:0.06},{f:1100,t:0.12},{f:1320,t:0.18}].forEach(function (n) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = n.f;
        g.gain.setValueAtTime(0.0001, t0 + n.t);
        g.gain.exponentialRampToValueAtTime(0.55, t0 + n.t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.t + 0.11);
        o.connect(g); g.connect(ctx.destination);
        o.start(t0 + n.t); o.stop(t0 + n.t + 0.12);
      });
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 700);
    } catch (e) { console.warn('Beep sukses gagal:', e); }
  }
  APP.playBeepSuccess = playBeepSuccess;

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
      o.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + 0.19);
      o.onended = function () { try { ctx.close(); } catch (e) {} };
    } catch (e) { console.warn('Beep gagal gagal:', e); }
  }

  function playBeepFail() { beepFailOnce(); setTimeout(beepFailOnce, 230); }
  APP.playBeepFail = playBeepFail;

  /* JSONP CALL KE GAS */
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
      script.src = CONFIG.GAS_URL + '?callback=' + encodeURIComponent(cbName) + '&' + qs;
      script.onerror = function () { cleanup(); reject(new Error('JSONP gagal — cek koneksi atau URL GAS')); };
      script.onload = function () { if (!done) { cleanup(); reject(new Error('Response GAS tidak memanggil callback')); } };

      document.body.appendChild(script);
      timeoutId = setTimeout(function () { if (!done) { cleanup(); reject(new Error('JSONP timeout')); } }, 12000);
    });
  }
  APP.callGAS = callGAS;

  /* SYNC OVERLAY */
  function ensureSyncOverlay() {
    if ($('syncOverlay')) return;
    const ov = document.createElement('div');
    ov.id = 'syncOverlay';
    ov.className = 'sync-overlay';
    ov.innerHTML = '<div class="sync-spinner"><div class="ring r1"></div><div class="ring r2"></div><div class="ring r3"></div></div><div class="sync-text">Memuat Data</div>';
    document.body.appendChild(ov);
  }
  APP.ensureSyncOverlay = ensureSyncOverlay;

  function showSyncLoading() {
    isSyncing = true;
    ensureSyncOverlay();
    const ov = $('syncOverlay');
    if (ov) ov.classList.add('active');
    document.querySelectorAll('.mesin-btn').forEach(function (b) { b.disabled = true; });
    const summary = $('summary');
    if (summary) { summary.textContent = 'Memuat data...'; lastSummaryText = summary.textContent; }
  }
  APP.showSyncLoading = showSyncLoading;

  function hideSyncLoading() {
    isSyncing = false;
    const ov = $('syncOverlay');
    if (ov) ov.classList.remove('active');
    document.querySelectorAll('.mesin-btn').forEach(function (b) { b.disabled = false; });
  }
  APP.hideSyncLoading = hideSyncLoading;

  /* RANGKUMAN MESIN AKTIF */
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
  APP.updateRangkuman = updateRangkuman;

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
    const totalMesinServer = Object.keys(hasilInput).filter(function (m) { return (hasilInput[m] || []).length > 0; }).length;
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
  APP.updateSummary = updateSummary;

  /* TABS */
  function switchTab(tab) {
    const pageForm = $('pageForm'), pageRekap = $('pageRekap');
    const btnForm = $('tabForm'), btnRekap = $('tabRekap');
    if (tab === 'rekap') {
      if (pageForm) pageForm.classList.add('hidden');
      if (pageRekap) pageRekap.classList.remove('hidden');
      if (btnForm) btnForm.classList.remove('active');
      if (btnRekap) btnRekap.classList.add('active');
    } else {
      if (pageRekap) pageRekap.classList.add('hidden');
      if (pageForm) pageForm.classList.remove('hidden');
      if (btnRekap) btnRekap.classList.remove('active');
      if (btnForm) btnForm.classList.add('active');
    }
  }
  APP.switchTab = switchTab;

  /* LOAD DAFTAR MESIN */
  function loadDaftarMesin() {
    const container = $('mesinContainer');
    if (container) container.innerHTML = '<div class="loading-wrap"><span class="loading"></span> Memuat daftar mesin...</div>';
    callGAS({ action: 'getMesin' })
      .then(function (res) {
        if (!res || !res.success) throw new Error((res && res.error) || 'Gagal memuat mesin.');
        daftarMesin = res.data || [];
        buildKategoriMap();
        if (APP.renderMesin) APP.renderMesin();
        if (APP.syncData) APP.syncData();
      })
      .catch(function (err) {
        hideSyncLoading();
        if (container) container.innerHTML = '<div class="loading-wrap" style="color:#ff6b8a;">Gagal memuat mesin: ' + (err && err.message ? err.message : err) + '</div>';
      });
  }
  APP.loadDaftarMesin = loadDaftarMesin;

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
  APP.buildKategoriMap = buildKategoriMap;

  /* LOAD MASTER SPK */
  function loadMasterSPK() {
    if (masterSPKLoaded || masterSPKLoading) return;
    masterSPKLoading = true;
    const tahun = String(CONFIG.DEFAULT_TAHUN || new Date().getFullYear());
    callGAS({ action: 'getMasterSPK', tahun: tahun })
      .then(function (res) {
        if (res && res.success && res.data) { masterSPK = res.data; masterSPKLoaded = true; }
        else { console.warn('Gagal memuat master SPK:', res ? res.error : 'unknown'); }
      })
      .catch(function (err) { console.warn('Error memuat master SPK:', err); })
      .finally(function () { masterSPKLoading = false; });
  }
  APP.loadMasterSPK = loadMasterSPK;

  /* INIT */
  document.addEventListener('DOMContentLoaded', function () {
    const t = $('tanggal'); if (t) t.value = ymd(new Date());
    const s = $('shift'); if (s) s.value = 'SHIFT-PAGI';
    const ft = $('footerTahun'); if (ft) ft.textContent = new Date().getFullYear();

    if (APP.initTabs) APP.initTabs();
    if (APP.initRekapControls) APP.initRekapControls();
    if (APP.bindEvents) APP.bindEvents();

    ensureSyncOverlay();
    const ov = $('syncOverlay');
    if (ov) ov.classList.add('active');
    isSyncing = true;

    loadDaftarMesin();
    loadMasterSPK();
  });

})();
