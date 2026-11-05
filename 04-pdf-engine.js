/* ============================================================
   Watermark Editor - PDF.js engine wrapper
   Handles worker bootstrap (via Blob URL, required because
   file:// pages cannot fetch/XHR/Worker() a sibling script) and
   page rasterization for preview + thumbnails.
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;

  let workerReady = false;
  function ensureWorker() {
    if (workerReady) return;
    const bytes = U.b64ToBytes(global.WM_PDFWORKER_B64);
    const blob = new Blob([bytes], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    workerReady = true;
  }

  const PdfEngine = {
    async loadDocument(arrayBuffer) {
      ensureWorker();
      // pdf.js detaches/consumes the buffer; give it a copy so caller's original stays valid.
      const data = new Uint8Array(arrayBuffer.slice(0));
      const task = pdfjsLib.getDocument({ data, isEvalSupported: false });
      const pdf = await task.promise;
      return pdf;
    },

    // Returns { widthPt, heightPt, rotation } - widthPt/heightPt are the VISUAL
    // (rotation-applied) page size in points, i.e. what a normal PDF viewer shows
    // and what the interactive canvas/thumbnails are laid out in (matches the
    // rotation-applied raster from renderPageToCanvas/renderPageAtScale below).
    // PDF export (09-export.js) works from pdf-lib's own RAW page.getWidth/Height
    // + rotation independently, so this "visual" convention here only affects the
    // editor/preview layer and does not need to match a raw-space convention.
    async getPageInfo(pdf, pageNumber1based) {
      const page = await pdf.getPage(pageNumber1based);
      const rotation = U.normalizeRotation90(page.rotate || 0);
      const visualViewport = page.getViewport({ scale: 1, rotation: rotation });
      return {
        widthPt: visualViewport.width,
        heightPt: visualViewport.height,
        rotation,
        page,
      };
    },

    // Renders a page to a canvas at the given target pixel width (visual/rotated orientation,
    // matching what a normal PDF viewer would show). Returns the canvas.
    async renderPageToCanvas(page, targetWidthPx, rotation) {
      const baseViewport = page.getViewport({ scale: 1, rotation: rotation });
      const scale = targetWidthPx / baseViewport.width;
      const viewport = page.getViewport({ scale, rotation: rotation });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas;
    },

    async renderPageAtScale(page, scale, rotation) {
      const viewport = page.getViewport({ scale, rotation });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas;
    },
  };

  WM.PdfEngine = PdfEngine;
})(window);
