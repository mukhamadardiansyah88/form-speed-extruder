/* ============================================================
   FORM SPEED EXTRUDER — BACKEND API
   ============================================================
   Support JSONP (via doGet + parameter callback) dan JSON biasa
   (via doPost).

   Aksi:
   - getMesin        : daftar nama mesin
   - getMesinDetail  : semua mesin + satuan + min + max
   - getMasterSPK    : kirim SELURUH database SPK untuk cache
   - getData         : ambil baris Inputan by Tanggal + Shift
   - getRekap        : ambil baris Inputan untuk rentang tanggal
   - tambahData      : append 1 baris
   - tambahBanyak    : append banyak baris (ANTI-DOBEL)
   - editData        : update No SPK & Speed by ID
   - hapusData       : hapus baris by ID
   - ping            : health check
   ============================================================ */

/* ------------------------------------------------------------
   KONFIGURASI
   ------------------------------------------------------------ */
const SHEET_MESIN   = 'Mesin';
const SHEET_ALAMAT  = 'Alamat';
const SHEET_INPUTAN = 'Inputan';

const CACHE_KEY_DB  = 'DB_SPK_CACHE';
const CACHE_TTL     = 21600; // 6 jam (detik)

const HEADER_INPUTAN = ['ID', 'Tanggal', 'Shift', 'Mesin', 'No SPK', 'Speed'];

/* ------------------------------------------------------------
   ENTRY POINT: doGet (JSONP + GET biasa)
   ------------------------------------------------------------ */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  const callback = params.callback;

  if (typeof params.row === 'string') {
    try { params.row = JSON.parse(params.row); } catch (err) {
      return jsonResponseWithCallback(
        { success: false, error: 'row bukan JSON valid: ' + err.message },
        callback
      );
    }
  }

  if (typeof params.rows === 'string') {
    try { params.rows = JSON.parse(params.rows); } catch (err) {
      return jsonResponseWithCallback(
        { success: false, error: 'rows bukan JSON valid: ' + err.message },
        callback
      );
    }
  }

  const result = handleRequest(params);
  return jsonResponseWithCallback(result, callback);
}

/* ------------------------------------------------------------
   ENTRY POINT: doPost (JSON biasa)
   ------------------------------------------------------------ */
function doPost(e) {
  let params = {};
  try {
    if (e && e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return jsonResponse({ success: false, error: 'Body bukan JSON valid: ' + err.message });
  }
  return jsonResponse(handleRequest(params));
}

/* ------------------------------------------------------------
   HANDLE REQUEST: routing
   ------------------------------------------------------------ */
function handleRequest(params) {
  try {
    const action = String(params.action || '').trim();

    switch (action) {
      case 'getMesin':
        return { success: true, data: getDaftarMesin() };

      case 'getMesinDetail':
        return { success: true, data: getMesinDetail() };

      case 'getMasterSPK':
        return { success: true, data: getDatabaseSPK(params.tahun) };

      case 'getData':
        return getData(params.tanggal, params.shift);

      case 'getRekap':
        return getRekap(params.tanggalAwal, params.tanggalAkhir);

      case 'tambahData':
        return tambahData(params.row || params);

      case 'tambahBanyak':
        return tambahBanyak(params.rows);

      case 'editData':
        return editData(params);

      case 'hapusData':
        return hapusData(params.id);

      case 'ping':
        return { success: true, message: 'pong' };

      default:
        return { success: false, error: 'Action tidak dikenal: ' + action };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/* ------------------------------------------------------------
   HELPER: Response JSON
   ------------------------------------------------------------ */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------
   HELPER: Response JSON atau JSONP
   ------------------------------------------------------------ */
function jsonResponseWithCallback(obj, callback) {
  const json = JSON.stringify(obj);

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------
   HELPER: Ambil sheet Inputan + pastikan header benar
   ------------------------------------------------------------ */
function getSheetInputan_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_INPUTAN);
  if (!sheet) sheet = ss.insertSheet(SHEET_INPUTAN);

  ensureHeaderInputan_(sheet);
  return sheet;
}

function ensureHeaderInputan_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), HEADER_INPUTAN.length);
  const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  let sesuai = true;
  for (let i = 0; i < HEADER_INPUTAN.length; i++) {
    if (String(current[i] || '').trim() !== HEADER_INPUTAN[i]) {
      sesuai = false;
      break;
    }
  }

  if (!sesuai) {
    sheet.getRange(1, 1, 1, HEADER_INPUTAN.length)
      .setValues([HEADER_INPUTAN])
      .setFontWeight('bold');
  }
}

/* ------------------------------------------------------------
   HELPER: Normalisasi tanggal ke yyyy-mm-dd (string)
   ------------------------------------------------------------ */
function normalizeTanggal_(val) {
  if (val == null || val === '') return '';
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return s;
}

/* ------------------------------------------------------------
   HELPER: Angka dari sel (koma→titik), null kalau kosong
   ------------------------------------------------------------ */
function toNumber_(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'number' && !isNaN(val)) return val;
  const s = String(val).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return isNaN(n) ? null : n;
}

/* ------------------------------------------------------------
   DAFTAR MESIN
   ------------------------------------------------------------ */
function getDaftarMesin() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_MESIN);
  if (!sheet) throw new Error('Sheet "' + SHEET_MESIN + '" tidak ditemukan.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const list = [];
  for (let i = 0; i < values.length; i++) {
    const nama = String(values[i][0]).trim();
    if (nama !== '') list.push(nama);
  }
  return list;
}

/* ------------------------------------------------------------
   DETAIL SEMUA MESIN
   ------------------------------------------------------------ */
function getMesinDetail() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_MESIN);
  if (!sheet) throw new Error('Sheet "' + SHEET_MESIN + '" tidak ditemukan.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 4).getValues();
  const out = [];
  for (let i = 0; i < values.length; i++) {
    const nama = String(values[i][0] || '').trim();
    if (nama === '') continue;
    out.push({
      mesin: nama,
      satuan: String(values[i][1] || '').trim(),
      minSpeed: toNumber_(values[i][2]),
      maxSpeed: toNumber_(values[i][3])
    });
  }
  return out;
}

/* ------------------------------------------------------------
   AMBIL ID FILE DATABASE SPK BERDASARKAN TAHUN
   ------------------------------------------------------------ */
function getIdFileDatabase(tahun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_ALAMAT);
  if (!sheet) throw new Error('Sheet "' + SHEET_ALAMAT + '" tidak ditemukan.');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Sheet "' + SHEET_ALAMAT + '" kosong.');

  const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  const targetTahun = String(tahun).trim();

  for (let i = 0; i < values.length; i++) {
    const th = String(values[i][0]).trim();
    const id = String(values[i][1]).trim();
    if (th === targetTahun && id !== '') return id;
  }
  throw new Error('ID file database untuk tahun ' + targetTahun + ' tidak ditemukan di sheet "' + SHEET_ALAMAT + '".');
}

/* ------------------------------------------------------------
   BACA & PARSE DATABASE SPK DARI DRIVE (DENGAN CACHE)
   ------------------------------------------------------------ */
function getDatabaseSPK(tahun) {
  const targetTahun = String(tahun || new Date().getFullYear()).trim();
  const cacheKey = CACHE_KEY_DB + '_' + targetTahun;
  const cache = CacheService.getScriptCache();

  const cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* lanjut baca ulang */ }
  }

  const fileId = getIdFileDatabase(targetTahun);
  let file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    throw new Error('Gagal membuka file database SPK (ID: ' + fileId + '): ' + e.message);
  }

  const content = file.getBlob().getDataAsString('UTF-8');
  const lines = content.split(/\r?\n/);
  if (lines.length < 2) throw new Error('File database SPK kosong atau tidak valid.');

  const headers = lines[0].split('%').map(function (h) { return h.trim().toLowerCase(); });
  const idxNoSPK = headers.indexOf('no spk');
  const idxJenis = headers.indexOf('jenis plastik');
  const idxTebal = headers.indexOf('tebal (mm)');
  const idxLebar = headers.indexOf('lebar (cm)');
  const idxLipat = headers.indexOf('lipat (cm)');

  if (idxNoSPK === -1) throw new Error('Kolom "No SPK" tidak ditemukan di header database.');
  if (idxJenis === -1) throw new Error('Kolom "Jenis Plastik" tidak ditemukan di header database.');
  if (idxTebal === -1) throw new Error('Kolom "Tebal (mm)" tidak ditemukan di header database.');
  if (idxLebar === -1) throw new Error('Kolom "Lebar (cm)" tidak ditemukan di header database.');

  const db = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.trim() === '') continue;

    const parts = line.split('%');
    const noSPK = String(parts[idxNoSPK] || '').trim();
    if (noSPK === '') continue;

    const jenis = String(parts[idxJenis] || '').trim();
    const kode = jenis.substring(0, 2).toUpperCase();

    db[noSPK] = {
      noSPK: noSPK,
      jenisPlastik: jenis,
      kodeJenis: kode,
      tebal: String(parts[idxTebal] || '').trim(),
      lebar: String(parts[idxLebar] || '').trim(),
      lipat: idxLipat !== -1 ? String(parts[idxLipat] || '').trim() : ''
    };
  }

  try {
    cache.put(cacheKey, JSON.stringify(db), CACHE_TTL);
  } catch (e) {
    // data terlalu besar untuk cache, abaikan
  }

  return db;
}

/* ------------------------------------------------------------
   GET DATA (by Tanggal + Shift)
   ------------------------------------------------------------ */
function getData(tanggal, shift) {
  const sheet = getSheetInputan_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, data: [] };

  const tglTarget = normalizeTanggal_(tanggal);
  const shiftTarget = String(shift || '').trim();

  const values = sheet.getRange(2, 1, lastRow - 1, HEADER_INPUTAN.length).getValues();
  const out = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = String(row[0] || '').trim();
    const tgl = normalizeTanggal_(row[1]);
    const sh = String(row[2] || '').trim();
    const mesin = String(row[3] || '').trim();
    const noSPK = String(row[4] || '').trim();
    const speed = String(row[5] || '').trim();

    if (!id || !mesin) continue;
    if (tgl !== tglTarget) continue;
    if (sh !== shiftTarget) continue;

    out.push({ id: id, mesin: mesin, noSPK: noSPK, speed: speed });
  }

  return { success: true, data: out };
}

/* ------------------------------------------------------------
   GET REKAP (rentang tanggal, inklusif)
   ------------------------------------------------------------ */
function getRekap(tanggalAwal, tanggalAkhir) {
  const awal = normalizeTanggal_(tanggalAwal);
  const akhir = normalizeTanggal_(tanggalAkhir);

  if (!awal || !akhir) {
    return { success: false, error: 'Tanggal awal/akhir kosong.' };
  }
  if (awal > akhir) {
    return { success: false, error: 'Tanggal awal lebih besar dari akhir.' };
  }

  const sheet = getSheetInputan_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, data: [] };

  const values = sheet.getRange(2, 1, lastRow - 1, HEADER_INPUTAN.length).getValues();
  const out = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const id = String(row[0] || '').trim();
    const tgl = normalizeTanggal_(row[1]);
    const sh = String(row[2] || '').trim();
    const mesin = String(row[3] || '').trim();
    const noSPK = String(row[4] || '').trim();
    const speed = String(row[5] || '').trim();

    if (!id || !mesin || !tgl) continue;
    if (tgl < awal || tgl > akhir) continue;

    out.push({
      id: id,
      tanggal: tgl,
      mesin: mesin,
      noSPK: noSPK,
      shift: sh,
      speed: speed
    });
  }

  return { success: true, data: out };
}

/* ------------------------------------------------------------
   TAMBAH DATA
   ------------------------------------------------------------ */
function tambahData(row) {
  if (!row || typeof row !== 'object') {
    return { success: false, error: 'row tidak valid.' };
  }

  const tanggal = normalizeTanggal_(row.tanggal);
  const shift = String(row.shift || '').trim();
  const mesin = String(row.mesin || '').trim();
  const noSPK = String(row.noSPK || '').trim();
  const speed = String(row.speed || '').trim();

  if (!tanggal || !shift || !mesin || !noSPK || !speed) {
    return { success: false, error: 'Data tidak lengkap (tanggal/shift/mesin/noSPK/speed).' };
  }

  const sheet = getSheetInputan_();
  const id = Utilities.getUuid();
  sheet.appendRow([id, tanggal, shift, mesin, noSPK, speed]);

  return { success: true, data: { id: id } };
}

/* ------------------------------------------------------------
   TAMBAH BANYAK (DENGAN ANTI-DOBEL)
   ------------------------------------------------------------ */
function tambahBanyak(rows) {
  if (!rows || !rows.length) {
    return { success: false, error: 'rows kosong.' };
  }

  const sheet = getSheetInputan_();
  const out = [];
  let gagal = 0;
  let duplikat = 0;

  // Ambil 200 baris terakhir untuk cek duplikat
  const lastRow = sheet.getLastRow();
  let existingKeys = {};
  if (lastRow > 1) {
    const startRow = Math.max(2, lastRow - 200);
    const numRows = lastRow - startRow + 1;
    const existingData = sheet.getRange(startRow, 1, numRows, HEADER_INPUTAN.length).getValues();
    
    existingData.forEach(function(r) {
      const tgl = normalizeTanggal_(r[1]);
      const shift = String(r[2] || '').trim();
      const mesin = String(r[3] || '').trim();
      const noSPK = String(r[4] || '').trim();
      const speed = String(r[5] || '').trim();
      
      if (tgl && shift && mesin && noSPK && speed) {
        const key = tgl + '|' + shift + '|' + mesin + '|' + noSPK + '|' + speed;
        existingKeys[key] = true;
      }
    });
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const tanggal = normalizeTanggal_(r.tanggal);
    const shift = String(r.shift || '').trim();
    const mesin = String(r.mesin || '').trim();
    const noSPK = String(r.noSPK || '').trim();
    const speed = String(r.speed || '').trim();

    if (!tanggal || !shift || !mesin || !noSPK || !speed) {
      gagal++;
      continue;
    }

    const key = tanggal + '|' + shift + '|' + mesin + '|' + noSPK + '|' + speed;
    if (existingKeys[key]) {
      duplikat++;
      continue;
    }

    existingKeys[key] = true; // Daftarkan agar tidak dobel di dalam batch yang sama
    out.push([Utilities.getUuid(), tanggal, shift, mesin, noSPK, speed]);
  }

  if (out.length === 0) {
    return { success: true, jumlah: 0, gagal: gagal, duplikat: duplikat };
  }

  const startRow = sheet.getLastRow() + 1;
  sheet.getRange(startRow, 1, out.length, HEADER_INPUTAN.length).setValues(out);

  return { success: true, jumlah: out.length, gagal: gagal, duplikat: duplikat };
}

/* ------------------------------------------------------------
   EDIT DATA
   ------------------------------------------------------------ */
function editData(params) {
  const id = String(params.id || '').trim();
  if (!id) return { success: false, error: 'ID kosong.' };

  const noSPK = String(params.noSPK || '').trim();
  const speed = String(params.speed || '').trim();
  if (!noSPK || !speed) {
    return { success: false, error: 'No SPK & Speed wajib diisi.' };
  }

  const sheet = getSheetInputan_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, error: 'Data kosong.' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let rowIndex = -1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) {
      rowIndex = i + 2;
      break;
    }
  }

  if (rowIndex === -1) {
    return { success: false, error: 'ID tidak ditemukan: ' + id };
  }

  sheet.getRange(rowIndex, 5).setValue(noSPK);
  sheet.getRange(rowIndex, 6).setValue(speed);

  return { success: true };
}

/* ------------------------------------------------------------
   HAPUS DATA
   ------------------------------------------------------------ */
function hapusData(id) {
  id = String(id || '').trim();
  if (!id) return { success: false, error: 'ID kosong.' };

  const sheet = getSheetInputan_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, error: 'Data kosong.' };

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let rowIndex = -1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || '').trim() === id) {
      rowIndex = i + 2;
      break;
    }
  }

  if (rowIndex === -1) {
    return { success: false, error: 'ID tidak ditemukan: ' + id };
  }

  sheet.deleteRow(rowIndex);
  return { success: true };
}

/* ------------------------------------------------------------
   MIGRASI ID
   ------------------------------------------------------------ */
function migrasiID() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_INPUTAN);
  if (!sheet) throw new Error('Sheet "' + SHEET_INPUTAN + '" tidak ada.');

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2) {
    ensureHeaderInputan_(sheet);
    return { success: true, message: 'Sheet kosong, header sudah disiapkan.' };
  }

  const a1 = String(sheet.getRange(1, 1).getValue() || '').trim();
  if (a1 !== 'ID') {
    const all = sheet.getRange(1, 1, lastRow, Math.max(lastCol, 1)).getValues();
    sheet.getRange(1, 2, all.length, all[0].length).setValues(all);
    sheet.getRange(1, 1, lastRow, 1).clearContent();
  }

  ensureHeaderInputan_(sheet);

  const values = sheet.getRange(2, 1, lastRow - 1, HEADER_INPUTAN.length).getValues();
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const id = String(values[i][0] || '').trim();
    if (id === '') {
      const newId = Utilities.getUuid();
      sheet.getRange(i + 2, 1).setValue(newId);
      count++;
    }
  }

  return { success: true, message: 'Migrasi selesai. ' + count + ' baris diberi ID.' };
}
