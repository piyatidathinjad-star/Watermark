/* ============================================================
   Watermark Editor - Export engine (Image + PDF)

   PDF coordinate mapping (visual/canvas space -> raw PDF space),
   derived and empirically verified against poppler renders for
   all four standard page rotations (0/90/180/270):

     R=0:   pdfX = vx,        pdfY = rawH - vy
     R=90:  pdfX = vy,        pdfY = vx
     R=180: pdfX = rawW - vx, pdfY = vy
     R=270: pdfX = rawW - vy, pdfY = rawH - vx

   Rotation angle: pdf-lib's drawText `rotate` degrees matches our
   UI's clockwise-positive convention directly (rrot = crot),
   independent of R (rotation composition is commutative).
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;
  const { PDFDocument, rgb, degrees } = PDFLib;

  function visualToPdf(R, rawW, rawH, vx, vy) {
    if (R === 90) return { x: vy, y: vx };
    if (R === 180) return { x: rawW - vx, y: vy };
    if (R === 270) return { x: rawW - vy, y: rawH - vx };
    return { x: vx, y: rawH - vy };
  }

  function visDims(rawW, rawH, R) {
    return (R === 90 || R === 270) ? { visW: rawH, visH: rawW } : { visW: rawW, visH: rawH };
  }

  // Raw-PDF-space unit basis for a watermark's local +x (reading direction) and +y ("down"/
  // next-line direction) axes, for a GIVEN rotation angle crotDeg - using the exact same
  // convention pdf-lib's own `rotate` option uses internally (Tm = [cos,sin,-sin,cos,x,y]).
  // Any local offset placed via this basis (instead of rotating in a separate "visual" y-down
  // space and only afterwards mapping into raw space through the page-rotation-dependent
  // visualToPdf reflection) is GUARANTEED to line up with where pdf-lib actually draws glyphs,
  // for every combination of watermark rotation and page rotation R - because it composes the
  // offset directly in the same space and using the same rotation pdf-lib itself applies,
  // instead of relying on a second, independently-derived rotation to happen to agree with it.
  function rawTextBasis(crotDeg) {
    const rad = crotDeg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    return {
      ex: { x: cos, y: sin },   // local +x (reading direction) -> raw direction
      ey: { x: sin, y: -cos },  // local +y ("down" / next line) -> raw direction
    };
  }

  // Per-character x-advances for a single line, using pdf-lib font metrics + manual letter spacing.
  function lineCharAdvances(font, text, fontSize, letterSpacing) {
    const chars = Array.from(text);
    let total = 0;
    const items = chars.map((ch, i) => {
      const w = font.widthOfTextAtSize(ch, fontSize);
      const x0 = total;
      total += w + (i < chars.length - 1 ? letterSpacing : 0);
      return { ch, x0, w };
    });
    return { items, width: Math.max(total, 0) };
  }

  function hexToRgbColor(hex) {
    const { r, g, b } = U.hexToRgb(hex);
    return rgb(r / 255, g / 255, b / 255);
  }

  // Draws one line of text (as part of a rigid, possibly multi-line/multi-pass block) onto a
  // pdf-lib page. rawAnchor is the {x,y} raw-PDF-space point for this instance's own anchor
  // (i.e. visualToPdf() applied ONCE to the watermark's un-rotated placement point); basis is
  // the rawTextBasis(crotDeg) for this instance. Every local offset (alignment, per-line
  // stacking, shadow/stroke/underline) is mapped to raw space via rawAnchor + lx*ex + ly*ey,
  // so it is placed using the exact same rotation pdf-lib itself will use to draw the glyphs
  // (via the `rotate` option below) - keeping every point self-consistent regardless of angle.
  //
  // IMPORTANT: when no custom letter-spacing is needed, the whole line is drawn with a SINGLE
  // native pdf-lib drawText() call instead of one call per character. Positioning many
  // independently-rotated single-glyph text objects in sequence was found (empirically, across
  // both poppler and pdf.js) to sometimes place later glyphs off the intended baseline even
  // though the computed coordinates were correct - a per-character rendering artifact this
  // sidesteps entirely by letting the PDF engine's own text-run advance handle it, which is also
  // required reading for correctly shaping combining Thai vowel/tone marks. Per-character
  // drawing is kept only as a fallback for the (rare) custom-letter-spacing case.
  function drawVectorLine(page, font, text, style, lineLocalX, lineLocalY, rawAnchor, basis, crotDeg, scale) {
    const fontSize = style.fontSize * scale;
    const letterSpacing = (style.letterSpacing || 0) * scale;
    const { items, width } = lineCharAdvances(font, text, fontSize, letterSpacing);
    const native = Math.abs(letterSpacing) < 0.001;

    let startX = lineLocalX;
    if (style.align === 'center') startX = lineLocalX - width / 2;
    else if (style.align === 'right') startX = lineLocalX - width;

    const color = hexToRgbColor(style.color);
    const opacity = style.opacity != null ? style.opacity : 1;

    const toRaw = (lx, ly) => ({
      x: rawAnchor.x + lx * basis.ex.x + ly * basis.ey.x,
      y: rawAnchor.y + lx * basis.ex.y + ly * basis.ey.y,
    });

    const drawChar = (ch, lx, ly, fillColor, op) => {
      const raw = toRaw(lx, ly);
      page.drawText(ch, {
        x: raw.x, y: raw.y, size: fontSize, font,
        color: fillColor, opacity: op, rotate: degrees(crotDeg),
      });
    };

    // Draws the FULL line as one native text-run at local (pre-rotation) point (lx,ly).
    const drawLineNative = (lx, ly, fillColor, op) => {
      const raw = toRaw(lx, ly);
      page.drawText(text, {
        x: raw.x, y: raw.y, size: fontSize, font,
        color: fillColor, opacity: op, rotate: degrees(crotDeg),
      });
    };

    // Shadow pass (rotates with the text, matching the Fabric preview behavior)
    if (style.shadow && style.shadow.enabled) {
      const sdx = (style.shadow.offsetX || 0) * scale;
      const sdy = (style.shadow.offsetY || 0) * scale;
      const shadowColor = hexToRgbColor(style.shadow.color);
      const shadowOp = (style.shadow.opacity != null ? style.shadow.opacity : 0.6) * opacity;
      if (native) {
        drawLineNative(startX + sdx, lineLocalY + sdy, shadowColor, shadowOp);
      } else {
        for (const it of items) {
          drawChar(it.ch, startX + it.x0 + sdx, lineLocalY + sdy, shadowColor, shadowOp);
        }
      }
    }

    // Stroke pass (8-direction offset approximation - pdf-lib has no native text stroke mode)
    if (style.stroke && style.stroke.enabled && style.stroke.width > 0) {
      const sw = style.stroke.width * scale;
      const strokeColor = hexToRgbColor(style.stroke.color);
      const dirs = [[1,0],[-1,0],[0,1],[0,-1],[0.7,0.7],[-0.7,0.7],[0.7,-0.7],[-0.7,-0.7]];
      if (native) {
        for (const [dx, dy] of dirs) {
          drawLineNative(startX + dx * sw, lineLocalY + dy * sw, strokeColor, opacity);
        }
      } else {
        for (const [dx, dy] of dirs) {
          for (const it of items) {
            drawChar(it.ch, startX + it.x0 + dx * sw, lineLocalY + dy * sw, strokeColor, opacity);
          }
        }
      }
    }

    // Fill pass
    if (native) {
      drawLineNative(startX, lineLocalY, color, opacity);
    } else {
      for (const it of items) {
        drawChar(it.ch, startX + it.x0, lineLocalY, color, opacity);
      }
    }

    // Underline (approximate as a thin rotated rectangle made of a filled line via drawLine)
    if (style.underline && width > 0) {
      const uy = lineLocalY + fontSize * 0.12;
      const r1 = toRaw(startX, uy);
      const r2 = toRaw(startX + width, uy);
      page.drawLine({ start: r1, end: r2, thickness: Math.max(0.6, fontSize / 16), color, opacity });
    }

    return width;
  }

  async function getFontForLayer(pdfDoc, familyId, bold) {
    return WM.Fonts.embedFont(pdfDoc, familyId, bold);
  }

  // Draws a full effective text-layer style (possibly multi-line) centered at (visX,visY) with
  // rotation crotDeg, onto the given pdf-lib page (raw dims rawW x rawH, rotation R).
  async function drawTextLayerOnPage(pdfDoc, page, eff, rawW, rawH, R, visX, visY) {
    const font = await getFontForLayer(pdfDoc, eff.fontFamily, eff.bold);
    const scale = eff.scale || 1;
    const crotDeg = eff.rotation || 0;
    const lines = String(eff.text || '').split('\n');
    const lineHeight = eff.fontSize * 1.25 * scale;

    const rawAnchor = visualToPdf(R, rawW, rawH, visX, visY);
    const basis = rawTextBasis(crotDeg);

    lines.forEach((line, i) => {
      const ly = (i - (lines.length - 1) / 2) * lineHeight + fontBaselineFudge(eff.fontSize * scale);
      drawVectorLine(page, font, line, eff, 0, ly, rawAnchor, basis, crotDeg, scale);
    });
  }

  function fontBaselineFudge(fontSize) {
    return fontSize * 0.32; // approximate optical vertical centering of a text line around its baseline
  }

  async function drawPatternLayerOnPage(pdfDoc, page, eff, rawW, rawH, R, visX, visY) {
    const font = await getFontForLayer(pdfDoc, eff.fontFamily, eff.bold);
    const scale = eff.scale || 1;
    const crotDeg = eff.rotation || 0;
    const fontSize = eff.fontSize * scale;
    const letterSpacing = (eff.letterSpacing || 0) * scale;
    const spacingX = Math.max(4, (eff.pattern.spacingX || 40) * scale);
    const spacingY = Math.max(4, (eff.pattern.spacingY || 40) * scale);

    // Pattern text is entered through the same multi-line textarea as the "text" watermark
    // type, so it may itself contain '\n'. Split up front and lay out each tile's block the
    // same way drawTextLayerOnPage lays out a single watermark instance, rather than handing
    // the raw (possibly multi-line) string to one native drawText() call: pdf-lib's drawText()
    // DOES split on '\n' internally, but advances between lines using a fixed default line
    // height of 24pt (PDFPage.lineHeight) that is completely unrelated to the watermark's
    // actual font size - for any fontSize noticeably above ~19pt (24 / 1.25) that crushes
    // consecutive lines into each other, reading as overlapping/garbled text. Splitting
    // ourselves and spacing lines by our own fontSize-relative lineHeight (matching
    // drawTextLayerOnPage) avoids this entirely, and also lets the pattern text grid size its
    // cells to the real (multi-line) block instead of a single misleading width/height.
    const lines = String(eff.text || '').split('\n');
    const lineHeight = fontSize * 1.25;
    const blockH = lines.length > 1 ? lineHeight * lines.length : fontSize;
    const lineStyle = Object.assign({}, eff, { align: 'left' });

    const maxLineW = lines.reduce((mx, line) => {
      const { width } = lineCharAdvances(font, line, fontSize, letterSpacing);
      return Math.max(mx, width);
    }, 0);
    const cellW = Math.max(10, maxLineW + spacingX);
    const cellH = Math.max(10, blockH + spacingY);
    const diag = Math.ceil(Math.sqrt(rawW * rawW + rawH * rawH) * 1.15);
    const cols = Math.ceil(diag / cellW) + 2;
    const rows = Math.ceil(diag / cellH) + 2;

    const rawAnchor = visualToPdf(R, rawW, rawH, visX, visY);
    const basis = rawTextBasis(crotDeg);

    for (let r = -Math.floor(rows / 2); r < rows / 2; r++) {
      const rowOffset = (Math.abs(r) % 2 === 0) ? 0 : cellW / 2;
      for (let c = -Math.floor(cols / 2); c < cols / 2; c++) {
        const lx = c * cellW + rowOffset;
        const ly0 = r * cellH;
        lines.forEach((line, i) => {
          const ly = ly0 + (i - (lines.length - 1) / 2) * lineHeight;
          drawVectorLine(page, font, line, lineStyle, lx, ly, rawAnchor, basis, crotDeg, scale);
        });
      }
    }
  }

  async function applyLayersToPdfPage(pdfDoc, page, state, pageIndex) {
    const rawW = page.getWidth();
    const rawH = page.getHeight();
    const rot = U.normalizeRotation90((page.getRotation() && page.getRotation().angle) || 0);
    const { visW, visH } = visDims(rawW, rawH, rot);
    const layers = state.layersForPage(pageIndex);
    for (const layer of layers) {
      const eff = state.effectiveStyle(layer, pageIndex);
      const visX = eff.x * visW;
      const visY = eff.y * visH;
      if (layer.type === 'pattern') {
        await drawPatternLayerOnPage(pdfDoc, page, eff, rawW, rawH, rot, visX, visY);
      } else {
        await drawTextLayerOnPage(pdfDoc, page, eff, rawW, rawH, rot, visX, visY);
      }
    }
  }

  // ================= Raster (canvas) compositing - used for image export =================
  async function compositeWatermarksOnCanvas(ctx, state, pageIndex, pageW, pageH) {
    const layers = state.layersForPage(pageIndex);
    for (const layer of layers) {
      const eff = state.effectiveStyle(layer, pageIndex);
      const cssFamily = WM.Fonts.cssFamily(eff.fontFamily);
      const anchorX = eff.x * pageW;
      const anchorY = eff.y * pageH;
      ctx.save();
      ctx.translate(anchorX, anchorY);
      ctx.rotate(eff.rotation * Math.PI / 180);
      ctx.scale(eff.scale, eff.scale);
      if (layer.type === 'pattern') {
        const { canvas: tex } = WM._internal.buildPatternTexture(eff, pageW, pageH);
        ctx.drawImage(tex, -tex.width / 2, -tex.height / 2);
      } else {
        const style = Object.assign({}, eff, { fontFamilyCss: cssFamily });
        const lines = String(eff.text || '').split('\n');
        const lineHeight = eff.fontSize * 1.25;
        lines.forEach((line, i) => {
          const ly = (i - (lines.length - 1) / 2) * lineHeight + eff.fontSize * 0.32;
          WM._internal.drawStyledText(ctx, line, style, 0, ly);
        });
      }
      ctx.restore();
    }
  }

  const ExportEngine = {
    async exportPdf(state, onProgress) {
      const originalBytes = state.document.originalPdfBytes;
      let pdfDoc;
      try {
        pdfDoc = await PDFDocument.load(originalBytes, { updateMetadata: false });
      } catch (err) {
        // pdf-lib cannot actually decrypt protected PDFs - `ignoreEncryption: true`
        // only suppresses the throw, it does NOT decrypt the original content
        // streams, so re-saving that way produces a corrupted file. This is common
        // with Thai government/official documents that set an owner password to
        // restrict printing/editing while leaving the user password empty (so
        // every normal PDF viewer opens them with no prompt). pdf.js, already used
        // for on-screen preview/thumbnails, DOES handle that transparently, so for
        // this case we rebuild a brand-new (unencrypted) PDF from high-resolution
        // rasters of each original page and watermark that instead.
        if (/encrypted/i.test((err && err.message) || '')) {
          return await ExportEngine._exportEncryptedPdfViaRaster(state, onProgress);
        }
        throw err;
      }
      pdfDoc.registerFontkit(fontkit);
      const pages = pdfDoc.getPages();
      for (let i = 0; i < pages.length; i++) {
        await applyLayersToPdfPage(pdfDoc, pages[i], state, i);
        if (onProgress) onProgress(i + 1, pages.length);
        // yield to keep UI responsive on large documents
        if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
      }
      const bytes = await pdfDoc.save();
      return bytes;
    },

    // Fallback export path for password/permission-protected PDFs that pdf-lib
    // cannot re-save faithfully (see comment above). Renders each original page
    // at a high fixed DPI via pdf.js (which already decrypts transparently - the
    // same renderer used for the on-screen preview and thumbnails), then builds
    // a fresh PDF from those page images and watermarks it exactly like the
    // images-origin export path (exportImagesAsPdf) does.
    async _exportEncryptedPdfViaRaster(state, onProgress) {
      const RASTER_DPI = 200;
      const srcPdf = state.document.pdfDoc;
      const pageModels = state.document.pages;
      const pdfDoc = await PDFDocument.create();
      pdfDoc.registerFontkit(fontkit);
      for (let i = 0; i < pageModels.length; i++) {
        const pm = pageModels[i];
        const pjsPage = await srcPdf.getPage(pm.pageNumber1based);
        const scale = RASTER_DPI / 72;
        const canvas = await WM.PdfEngine.renderPageAtScale(pjsPage, scale, pm.rotation);
        const imgBytes = await canvasToBytes(canvas, 'png');
        const embedded = await pdfDoc.embedPng(imgBytes);
        const page = pdfDoc.addPage([pm.widthPt, pm.heightPt]);
        page.drawImage(embedded, { x: 0, y: 0, width: pm.widthPt, height: pm.heightPt });
        await applyLayersToPdfPage(pdfDoc, page, state, i);
        if (onProgress) onProgress(i + 1, pageModels.length);
        if (i % 2 === 0) await new Promise(r => setTimeout(r, 0));
      }
      return pdfDoc.save();
    },

    async exportImagesAsPdf(state, onProgress) {
      const pdfDoc = await PDFDocument.create();
      pdfDoc.registerFontkit(fontkit);
      const pages = state.document.pages;
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const page = pdfDoc.addPage([p.widthPt, p.heightPt]);
        const imgBytes = await imageElementToBytes(p.imageEl, U.getExt(p.fileName) === 'png' ? 'png' : 'jpeg');
        const embedded = U.getExt(p.fileName) === 'png' ? await pdfDoc.embedPng(imgBytes) : await pdfDoc.embedJpg(imgBytes);
        page.drawImage(embedded, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
        await applyLayersToPdfPage(pdfDoc, page, state, i);
        if (onProgress) onProgress(i + 1, pages.length);
        if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
      }
      return pdfDoc.save();
    },

    // Rasterizes each page/image (with watermark composited) at high resolution; returns
    // [{name, blob}]. For PDF source pages, renders at a DPI scale for good print quality.
    async exportImages(state, format, onProgress) {
      const results = [];
      const pages = state.document.pages;
      const mime = U.mimeForExt(format);
      const quality = format === 'jpg' || format === 'jpeg' ? 0.92 : undefined;

      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        let canvas;
        if (p.kind === 'image') {
          canvas = document.createElement('canvas');
          canvas.width = p.widthPt;
          canvas.height = p.heightPt;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(p.imageEl, 0, 0);
          await compositeWatermarksOnCanvas(ctx, state, i, p.widthPt, p.heightPt);
        } else {
          const pdf = state.document.pdfDoc;
          const pdfPage = await pdf.getPage(p.pageNumber1based);
          const longSide = Math.max(p.widthPt, p.heightPt);
          const scale = U.clamp(2400 / longSide, 1, 4); // export at higher res than preview
          canvas = await WM.PdfEngine.renderPageAtScale(pdfPage, scale, p.rotation);
          const ctx = canvas.getContext('2d');
          const visW = (p.rotation === 90 || p.rotation === 270) ? p.heightPt : p.widthPt;
          const visH = (p.rotation === 90 || p.rotation === 270) ? p.widthPt : p.heightPt;
          ctx.save();
          ctx.scale(canvas.width / visW, canvas.height / visH);
          await compositeWatermarksOnCanvas(ctx, state, i, visW, visH);
          ctx.restore();
        }
        const blob = await new Promise(res => canvas.toBlob(res, mime, quality));
        const base = (p.fileName || `page-${i + 1}`).replace(/\.[^/.]+$/, '');
        results.push({ name: `${base}.${format}`, blob });
        if (onProgress) onProgress(i + 1, pages.length);
      }
      return results;
    },
  };

  async function imageElementToBytes(imgEl, kind) {
    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    canvas.getContext('2d').drawImage(imgEl, 0, 0);
    return canvasToBytes(canvas, kind);
  }

  async function canvasToBytes(canvas, kind, quality) {
    const mime = kind === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise(res => canvas.toBlob(res, mime, quality != null ? quality : 0.95));
    return new Uint8Array(await blob.arrayBuffer());
  }

  WM.ExportEngine = ExportEngine;
})(window);
