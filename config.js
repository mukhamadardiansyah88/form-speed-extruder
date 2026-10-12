/* ============================================================
   KONFIGURASI GLOBAL
   ============================================================
   File ini isinya cuma setting. Kalau mau ganti URL GAS,
   edit di sini saja, tidak perlu buka file lain.
   ============================================================ */

const CONFIG = {

  /* ------------------------------------------------------------
     URL Web App GAS (deployment /exec)
     ------------------------------------------------------------
     Ganti nilai di bawah dengan URL deployment GAS kamu.
     Format: https://script.google.com/macros/s/AKfycb.../exec

     Catatan:
     - Gunakan URL yang berakhiran /exec (bukan /dev)
     - Jangan ada spasi, jangan ada tanda kutip tambahan
     ------------------------------------------------------------ */
  GAS_URL: 'https://script.google.com/macros/s/AKfycbzMgotAMK8mLqR9-8z7K0BKVRP0czDU7jUMis2PuplwhL_muk9zfG_RMfaLzwGC-gxt/exec',

  /* ------------------------------------------------------------
     Pengaturan Scanner (html5-qrcode)
     ------------------------------------------------------------ */
  SCANNER: {
    // Frame per second — semakin tinggi semakin responsif
    // tapi lebih boros CPU. 10-20 sudah cukup.
    FPS: 15,

    // Aspect ratio kamera
    ASPECT_RATIO: 1.0,

    // Izinkan flip (scan dari cermin / terbalik)
    DISABLE_FLIP: false,

    // Gunakan BarcodeDetector API bawaan browser kalau tersedia
    // (lebih cepat & hemat baterai di Chrome Android)
    USE_NATIVE_DETECTOR: true,

    // Jeda setelah scan sukses sebelum overlay ditutup (ms)
    // Biar user lihat hasil scan sebentar
    SUCCESS_DELAY_MS: 1400
  },

  /* ------------------------------------------------------------
     Format barcode yang didukung
     ------------------------------------------------------------ */
  SCANNER_FORMATS: [
    'QR_CODE',
    'CODE_128',
    'CODE_39',
    'CODE_93',
    'CODABAR',
    'EAN_13',
    'EAN_8',
    'ITF',
    'UPC_A',
    'UPC_E',
    'DATA_MATRIX',
    'PDF_417'
  ],

  /* ------------------------------------------------------------
     Tahun default database SPK
     ------------------------------------------------------------
     Kalau di sheet "Alamat" cuma ada 1 tahun (2026), biarkan
     apa adanya. Kalau nanti ada beberapa tahun, web app akan
     ambil tahun dari tanggal yang dipilih user.
     ------------------------------------------------------------ */
  DEFAULT_TAHUN: 2026

};
