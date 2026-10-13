/* ============================================================
   SCANNER — html5-qrcode wrapper
   ============================================================
   Fix:
   - Instance baru setiap kali open (hindari bug "paused")
   - Callback tetap dipanggil setelah scan sukses
   ============================================================ */

const Scanner = (function () {

  let scanner = null;
  let isScanning = false;
  let onResultCallback = null;
  let onCloseCallback = null;

  /* ------------------------------------------------------------
     UTIL: Beep
     ------------------------------------------------------------ */
  function playBeep() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'square';
      osc.frequency.setValueAtTime(1200, ctx.currentTime);
      osc.frequency.setValueAtTime(1800, ctx.currentTime + 0.06);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.9, ctx.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
      osc.onended = () => ctx.close();
    } catch (e) {
      console.warn('Beep gagal:', e);
    }
  }

  /* ------------------------------------------------------------
     UTIL: Getar
     ------------------------------------------------------------ */
  function vibrateStrong() {
    if (navigator.vibrate) {
      try {
        navigator.vibrate([300, 100, 300, 100, 500, 200, 100, 300]);
      } catch (e) {}
    }
  }

  /* ------------------------------------------------------------
     UI: Ambil elemen
     ------------------------------------------------------------ */
  function getEls() {
    return {
      overlay: document.getElementById('overlayScanner'),
      wrapper: document.getElementById('scannerWrapper'),
      status: document.getElementById('scannerStatus'),
      qrReader: document.getElementById('qr-reader')
    };
  }

  function setStatus(html, isSuccess) {
    const { status } = getEls();
    if (!status) return;
    status.className = 'scanner-status' + (isSuccess ? ' success' : '');
    status.innerHTML = html;
  }

  /* ------------------------------------------------------------
     MAP: Format string → enum
     ------------------------------------------------------------ */
  function mapFormats(formatStrings) {
    const map = {
      'QR_CODE':     Html5QrcodeSupportedFormats.QR_CODE,
      'CODE_128':    Html5QrcodeSupportedFormats.CODE_128,
      'CODE_39':     Html5QrcodeSupportedFormats.CODE_39,
      'CODE_93':     Html5QrcodeSupportedFormats.CODE_93,
      'CODABAR':     Html5QrcodeSupportedFormats.CODABAR,
      'EAN_13':      Html5QrcodeSupportedFormats.EAN_13,
      'EAN_8':       Html5QrcodeSupportedFormats.EAN_8,
      'ITF':         Html5QrcodeSupportedFormats.ITF,
      'UPC_A':       Html5QrcodeSupportedFormats.UPC_A,
      'UPC_E':       Html5QrcodeSupportedFormats.UPC_E,
      'DATA_MATRIX': Html5QrcodeSupportedFormats.DATA_MATRIX,
      'PDF_417':     Html5QrcodeSupportedFormats.PDF_417
    };
    return (formatStrings || []).map(f => map[f]).filter(v => v !== undefined);
  }

  /* ------------------------------------------------------------
     DESTROY: Buang instance lama + bersihkan DOM
     ------------------------------------------------------------ */
  function destroyInstance() {
    return new Promise(function (resolve) {
      const { qrReader } = getEls();

      if (!scanner) {
        if (qrReader) qrReader.innerHTML = '';
        return resolve();
      }

      let stopPromise;
      try {
        stopPromise = scanner.stop();
      } catch (e) {
        stopPromise = Promise.resolve();
      }

      stopPromise
        .then(function () {
          try { scanner.clear(); } catch (e) {}
          scanner = null;
          if (qrReader) qrReader.innerHTML = '';
          resolve();
        })
        .catch(function () {
          try { scanner.clear(); } catch (e) {}
          scanner = null;
          if (qrReader) qrReader.innerHTML = '';
          resolve();
        });
    });
  }

  /* ------------------------------------------------------------
     CREATE: Buat instance baru
     ------------------------------------------------------------ */
  function createInstance() {
    const formats = mapFormats(CONFIG.SCANNER_FORMATS);
    const { qrReader } = getEls();

    if (qrReader) qrReader.innerHTML = '';

    scanner = new Html5Qrcode(qrReader.id, {
      verbose: false,
      formatsToSupport: formats,
      experimentalFeatures: {
        useBarCodeDetectorIfSupported: CONFIG.SCANNER.USE_NATIVE_DETECTOR
      }
    });
  }

  /* ------------------------------------------------------------
     CALLBACK: Scan sukses
     ------------------------------------------------------------ */
  function onScanSuccess(decodedText) {
    if (!isScanning) return;
    isScanning = false;

    try { scanner.pause(true); } catch (e) {}

    playBeep();
    vibrateStrong();

    setStatus('✓ Berhasil: ' + decodedText, true);

    const result = decodedText;
    // Simpan callback dulu — karena closeInternal mungkin reset
    const cb = onResultCallback;

    setTimeout(function () {
      destroyInstance().then(function () {
        closeInternal();
        if (typeof cb === 'function') {
          cb(result);
        }
        // Reset callback setelah dipakai
        onResultCallback = null;
        onCloseCallback = null;
      });
    }, CONFIG.SCANNER.SUCCESS_DELAY_MS);
  }

  function onScanError() { /* silent */ }

  /* ------------------------------------------------------------
     START: Nyalakan kamera
     ------------------------------------------------------------ */
  function startCamera() {
    const { wrapper } = getEls();
    if (wrapper) wrapper.style.display = '';

    setStatus('<span class="loading"></span> Menyiapkan kamera...');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return startWithFacingMode();
    }

    navigator.mediaDevices.getUserMedia({ video: true })
      .then(function (stream) {
        stream.getTracks().forEach(t => t.stop());
        return navigator.mediaDevices.enumerateDevices();
      })
      .then(function (devices) {
        const cameras = devices.filter(d => d.kind === 'videoinput');

        if (cameras.length === 0) {
          setStatus('⚠ Device tidak memiliki kamera');
          return;
        }

        let targetCamera;
        if (cameras.length === 1) {
          targetCamera = cameras[0];
        } else {
          targetCamera = cameras.find(c =>
            /back|rear|environment|belakang/i.test(c.label)
          );
          if (!targetCamera) targetCamera = cameras[cameras.length - 1];
        }

        return startWithDeviceId(targetCamera.deviceId);
      })
      .catch(function (err) {
        console.warn('Auto-detect gagal:', err);
        if (err && (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')) {
          setStatus('⚠ Izin kamera ditolak. Mohon izinkan akses kamera.');
          return;
        }
        startWithFacingMode();
      });
  }

  function startWithDeviceId(deviceId) {
    const config = {
      fps: CONFIG.SCANNER.FPS,
      aspectRatio: CONFIG.SCANNER.ASPECT_RATIO,
      disableFlip: CONFIG.SCANNER.DISABLE_FLIP
    };

    return scanner.start(deviceId, config, onScanSuccess, onScanError)
      .then(function () {
        isScanning = true;
        setStatus('Arahkan kamera ke barcode / QR code');
      })
      .catch(function (err) {
        console.error('Start dengan deviceId gagal:', err);
        return startWithFacingMode();
      });
  }

  function startWithFacingMode() {
    const config = {
      fps: CONFIG.SCANNER.FPS,
      aspectRatio: CONFIG.SCANNER.ASPECT_RATIO,
      disableFlip: CONFIG.SCANNER.DISABLE_FLIP
    };

    return scanner.start(
      { facingMode: { exact: 'environment' } },
      config,
      onScanSuccess,
      onScanError
    )
    .then(function () {
      isScanning = true;
      setStatus('Arahkan kamera ke barcode / QR code');
    })
    .catch(function () {
      return scanner.start(
        { facingMode: 'environment' },
        config,
        onScanSuccess,
        onScanError
      )
      .then(function () {
        isScanning = true;
        setStatus('Arahkan kamera ke barcode / QR code');
      })
      .catch(function (err2) {
        isScanning = false;
        setStatus('⚠ Kamera tidak bisa diakses: ' + (err2 && err2.message ? err2.message : err2));
      });
    });
  }

  /* ------------------------------------------------------------
     OPEN
     ------------------------------------------------------------ */
  function open(onResult, onClose) {
    onResultCallback = typeof onResult === 'function' ? onResult : null;
    onCloseCallback = typeof onClose === 'function' ? onClose : null;

    const { overlay } = getEls();
    if (!overlay) return;

    destroyInstance().then(function () {
      createInstance();
      overlay.classList.add('active');
      setTimeout(startCamera, 200);
    });
  }

  /* ------------------------------------------------------------
     CLOSE (manual — tombol ✕ atau klik luar)
     ------------------------------------------------------------ */
  function close(fromSuccess) {
    if (!fromSuccess && typeof onCloseCallback === 'function') {
      try { onCloseCallback(); } catch (e) {}
    }

    destroyInstance().then(function () {
      closeInternal();
      onResultCallback = null;
      onCloseCallback = null;
    });
  }

  function closeInternal() {
    const { overlay, wrapper } = getEls();
    if (overlay) overlay.classList.remove('active');
    if (wrapper) wrapper.style.display = '';
    isScanning = false;
    setStatus('<span class="loading"></span> Menyiapkan kamera...');
    // callback TIDAK di-null-kan di sini
    // supaya onScanSuccess tetap bisa panggil
  }

  /* ------------------------------------------------------------
     BIND
     ------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    const btnClose = document.getElementById('btnCloseScanner');
    if (btnClose) {
      btnClose.addEventListener('click', function () {
        close(false);
      });
    }

    const overlayScanner = document.getElementById('overlayScanner');
    if (overlayScanner) {
      overlayScanner.addEventListener('click', function (e) {
        if (e.target.id === 'overlayScanner') close(false);
      });
    }

    window.addEventListener('touchstart', function wakeVibrate() {
      try { navigator.vibrate && navigator.vibrate(1); } catch (e) {}
      window.removeEventListener('touchstart', wakeVibrate);
    }, { once: true });
  });

  /* ------------------------------------------------------------
     PUBLIC API
     ------------------------------------------------------------ */
  return {
    open: open,
    close: close
  };

})();
