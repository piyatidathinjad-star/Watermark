/* ============================================================
   Watermark Editor - Utilities
   Shared helper functions used across the app.
   ============================================================ */
(function (global) {
  'use strict';

  const WM = global.WM || (global.WM = {});
  const Utils = {};

  let _uid = 0;
  Utils.uid = function (prefix) {
    _uid += 1;
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' + (_uid).toString(36);
  };

  Utils.clamp = function (v, min, max) {
    return Math.min(max, Math.max(min, v));
  };

  Utils.deepClone = function (obj) {
    if (obj === undefined) return undefined;
    return JSON.parse(JSON.stringify(obj));
  };

  Utils.b64ToBytes = function (b64) {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  Utils.bytesToB64 = function (bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };

  Utils.downloadBlob = function (blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  };

  Utils.formatBytes = function (bytes) {
    if (!bytes && bytes !== 0) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = bytes;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + units[i];
  };

  Utils.debounce = function (fn, wait) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  };

  Utils.throttle = function (fn, wait) {
    let last = 0;
    let timer = null;
    return function (...args) {
      const now = Date.now();
      const remaining = wait - (now - last);
      if (remaining <= 0) {
        last = now;
        fn.apply(this, args);
      } else {
        clearTimeout(timer);
        timer = setTimeout(() => { last = Date.now(); fn.apply(this, args); }, remaining);
      }
    };
  };

  Utils.hexToRgb = function (hex) {
    hex = (hex || '#000000').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  };

  Utils.rgbToHex = function (r, g, b) {
    const h = (n) => n.toString(16).padStart(2, '0');
    return '#' + h(r) + h(g) + h(b);
  };

  // Normalize a rotation (degrees) that PDF.js reports (always a multiple of 90, 0-270)
  Utils.normalizeRotation90 = function (deg) {
    let d = ((deg % 360) + 360) % 360;
    d = Math.round(d / 90) * 90;
    if (d === 360) d = 0;
    return d;
  };

  Utils.clampRotation360 = function (deg) {
    let d = deg % 360;
    if (d < 0) d += 360;
    return d;
  };

  // File helpers
  Utils.readFileAsArrayBuffer = function (file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  };

  Utils.readFileAsDataURL = function (file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  };

  Utils.loadImageFromSrc = function (src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error('Image failed to load'));
      img.src = src;
    });
  };

  Utils.getExt = function (filename) {
    const m = /\.([a-zA-Z0-9]+)$/.exec(filename || '');
    return m ? m[1].toLowerCase() : '';
  };

  Utils.mimeForExt = function (ext) {
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };
    return map[ext] || 'application/octet-stream';
  };

  Utils.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  };

  // Tiny pub/sub emitter
  Utils.Emitter = function () {
    this._handlers = {};
  };
  Utils.Emitter.prototype.on = function (evt, fn) {
    (this._handlers[evt] || (this._handlers[evt] = [])).push(fn);
    return () => this.off(evt, fn);
  };
  Utils.Emitter.prototype.off = function (evt, fn) {
    const list = this._handlers[evt];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };
  Utils.Emitter.prototype.emit = function (evt, payload) {
    const list = this._handlers[evt];
    if (!list) return;
    list.slice().forEach(fn => {
      try { fn(payload); } catch (e) { console.error('[Emitter] handler error for', evt, e); }
    });
  };

  // Minimal STORE-based ZIP writer (no compression) - good enough for bundling
  // export images together. Not a general purpose library, just what we need.
  Utils.createZip = function (files) {
    // files: [{name, data: Uint8Array}]
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    function crc32(buf) {
      let c;
      const table = crc32.table || (crc32.table = (() => {
        const t = [];
        for (let n = 0; n < 256; n++) {
          c = n;
          for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
          t[n] = c >>> 0;
        }
        return t;
      })());
      let crc = 0 ^ (-1);
      for (let i = 0; i < buf.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
      }
      return (crc ^ (-1)) >>> 0;
    }

    function dosDateTime() {
      const d = new Date();
      const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() / 2) & 0x1F);
      const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
      return { time, date };
    }

    const { time, date } = dosDateTime();

    files.forEach((f) => {
      const nameBytes = encoder.encode(f.name);
      const data = f.data;
      const crc = crc32(data);
      const size = data.length;

      const localHeader = new DataView(new ArrayBuffer(30));
      localHeader.setUint32(0, 0x04034b50, true);
      localHeader.setUint16(4, 20, true); // version needed
      localHeader.setUint16(6, 0, true); // flags
      localHeader.setUint16(8, 0, true); // method: store
      localHeader.setUint16(10, time, true);
      localHeader.setUint16(12, date, true);
      localHeader.setUint32(14, crc, true);
      localHeader.setUint32(18, size, true);
      localHeader.setUint32(22, size, true);
      localHeader.setUint16(26, nameBytes.length, true);
      localHeader.setUint16(28, 0, true);

      const localHeaderBytes = new Uint8Array(localHeader.buffer);
      localParts.push(localHeaderBytes, nameBytes, data);

      const centralHeader = new DataView(new ArrayBuffer(46));
      centralHeader.setUint32(0, 0x02014b50, true);
      centralHeader.setUint16(4, 20, true);
      centralHeader.setUint16(6, 20, true);
      centralHeader.setUint16(8, 0, true);
      centralHeader.setUint16(10, 0, true);
      centralHeader.setUint16(12, time, true);
      centralHeader.setUint16(14, date, true);
      centralHeader.setUint32(16, crc, true);
      centralHeader.setUint32(20, size, true);
      centralHeader.setUint32(24, size, true);
      centralHeader.setUint16(28, nameBytes.length, true);
      centralHeader.setUint16(30, 0, true);
      centralHeader.setUint16(32, 0, true);
      centralHeader.setUint16(34, 0, true);
      centralHeader.setUint16(36, 0, true);
      centralHeader.setUint32(38, 0, true);
      centralHeader.setUint32(42, offset, true);

      const centralHeaderBytes = new Uint8Array(centralHeader.buffer);
      centralParts.push(centralHeaderBytes, nameBytes);

      offset += localHeaderBytes.length + nameBytes.length + size;
    });

    const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
    const centralOffset = offset;

    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(4, 0, true);
    end.setUint16(6, 0, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, centralOffset, true);
    end.setUint16(20, 0, true);

    const allParts = [...localParts, ...centralParts, new Uint8Array(end.buffer)];
    const totalSize = allParts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(totalSize);
    let pos = 0;
    allParts.forEach(p => { out.set(p, pos); pos += p.length; });
    return out;
  };

  WM.Utils = Utils;
})(window);
