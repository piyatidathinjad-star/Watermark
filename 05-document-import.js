/* ============================================================
   Watermark Editor - Document import (upload / drag&drop)
   Builds the page model consumed by the rest of the app:
     images  -> document.type = 'images', one page per image file
     pdf     -> document.type = 'pdf',    one page per PDF page
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;

  const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp'];
  const MAX_THUMB_W = 180;

  async function makeThumbFromCanvas(canvas) {
    const scale = Math.min(1, MAX_THUMB_W / canvas.width);
    const w = Math.max(1, Math.round(canvas.width * scale));
    const h = Math.max(1, Math.round(canvas.height * scale));
    const c2 = document.createElement('canvas');
    c2.width = w; c2.height = h;
    c2.getContext('2d').drawImage(canvas, 0, 0, w, h);
    return c2.toDataURL('image/jpeg', 0.72);
  }

  async function makeThumbFromImage(img) {
    const scale = Math.min(1, MAX_THUMB_W / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c2 = document.createElement('canvas');
    c2.width = w; c2.height = h;
    c2.getContext('2d').drawImage(img, 0, 0, w, h);
    return c2.toDataURL('image/jpeg', 0.72);
  }

  const DocumentImport = {
    lastWarning: null,

    classify(files) {
      const arr = Array.from(files);
      const pdfs = arr.filter(f => U.getExt(f.name) === 'pdf');
      const images = arr.filter(f => IMAGE_EXTS.includes(U.getExt(f.name)));
      const rejected = arr.filter(f => !IMAGE_EXTS.includes(U.getExt(f.name)) && U.getExt(f.name) !== 'pdf');
      return { pdfs, images, rejected };
    },

    async importFiles(state, fileList, ui) {
      const { pdfs, images, rejected } = this.classify(fileList);
      this.lastWarning = null;

      if (!pdfs.length && !images.length) {
        this.lastWarning = 'ไม่พบไฟล์ที่รองรับ (JPG, JPEG, PNG, WEBP, PDF)';
        state.emit('import-error', this.lastWarning);
        return;
      }

      if (pdfs.length) {
        if (pdfs.length > 1 || images.length) {
          this.lastWarning = 'รองรับ PDF ได้ทีละ 1 ไฟล์ - ใช้ไฟล์ PDF แรกที่เลือก และข้ามไฟล์อื่น';
        }
        await this.importPdf(state, pdfs[0], ui);
      } else {
        if (rejected.length) {
          this.lastWarning = `ข้ามไฟล์ที่ไม่รองรับ ${rejected.length} ไฟล์`;
        }
        await this.importImages(state, images, ui);
      }

      if (this.lastWarning) state.emit('import-warning', this.lastWarning);
    },

    async importImages(state, files, ui) {
      state.document = { type: 'images', fileName: files.length === 1 ? files[0].name : `${files.length} images`, pages: [], originalPdfBytes: null };
      let i = 0;
      for (const file of files) {
        if (ui && ui.onProgress) ui.onProgress(i, files.length, file.name);
        const dataUrl = await U.readFileAsDataURL(file);
        const img = await U.loadImageFromSrc(dataUrl);
        const thumb = await makeThumbFromImage(img);
        state.document.pages.push({
          id: U.uid('page'),
          index: i,
          kind: 'image',
          widthPt: img.naturalWidth,
          heightPt: img.naturalHeight,
          rotation: 0,
          thumbnailDataUrl: thumb,
          fileName: file.name,
          imageEl: img,
          imageSrc: dataUrl,
        });
        i++;
      }
      state.layers = [];
      state.selectedLayerId = null;
      state.currentPageIndex = 0;
      state.initHistory();
      state.emit('document-loaded');
      state.emit('change', { type: 'document-loaded' });
    },

    async importPdf(state, file, ui) {
      const buf = await U.readFileAsArrayBuffer(file);
      // Keep the ORIGINAL bytes for export (so we author on top of the real source PDF,
      // preserving fonts/images/page count/quality) - store as a fresh copy.
      const originalBytes = new Uint8Array(buf.slice(0));
      const pdf = await WM.PdfEngine.loadDocument(buf);
      const n = pdf.numPages;
      state.document = {
        type: 'pdf', fileName: file.name, pages: [], originalPdfBytes: originalBytes, pdfDoc: pdf,
      };
      for (let p = 1; p <= n; p++) {
        if (ui && ui.onProgress) ui.onProgress(p - 1, n, `page ${p}/${n}`);
        const info = await WM.PdfEngine.getPageInfo(pdf, p);
        const thumbCanvas = await WM.PdfEngine.renderPageToCanvas(info.page, MAX_THUMB_W, info.rotation);
        const thumb = await makeThumbFromCanvas(thumbCanvas);
        state.document.pages.push({
          id: U.uid('page'),
          index: p - 1,
          kind: 'pdf-page',
          pageNumber1based: p,
          widthPt: info.widthPt,
          heightPt: info.heightPt,
          rotation: info.rotation,
          thumbnailDataUrl: thumb,
          fileName: `${file.name} - p.${p}`,
        });
      }
      state.layers = [];
      state.selectedLayerId = null;
      state.currentPageIndex = 0;
      state.initHistory();
      state.emit('document-loaded');
      state.emit('change', { type: 'document-loaded' });
    },

    attachDropZone(el, onFiles) {
      let dragCounter = 0;
      const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
      ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => el.addEventListener(evt, prevent));
      el.addEventListener('dragenter', () => { dragCounter++; el.classList.add('drag-active'); });
      el.addEventListener('dragleave', () => { dragCounter = Math.max(0, dragCounter - 1); if (dragCounter === 0) el.classList.remove('drag-active'); });
      el.addEventListener('drop', (e) => {
        dragCounter = 0;
        el.classList.remove('drag-active');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) onFiles(files);
      });
    },
  };

  WM.DocumentImport = DocumentImport;
})(window);
