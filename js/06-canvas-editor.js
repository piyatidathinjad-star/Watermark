/* ============================================================
   Watermark Editor - Interactive canvas (Fabric.js)
   Renders the current page as a locked background image and each
   applicable watermark layer as an interactive Fabric object
   (drag / resize / rotate / inline text edit).
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;

  const PREVIEW_MAX_SIDE = 2200; // px, cap for rasterized PDF page preview resolution

  function fontString(style) {
    const weight = style.bold ? '700' : '400';
    const fstyle = style.italic ? 'italic' : 'normal';
    return `${fstyle} ${weight} ${style.fontSize}px "${style.fontFamilyCss}"`;
  }

  // Draws one line of watermark text onto a plain 2D context with manual letter-spacing,
  // optional stroke/shadow/underline. Used for pattern tiles + raster export (NOT used for
  // the interactive Fabric text object, which uses Fabric's own native text rendering).
  function drawStyledText(ctx, text, style, x, y) {
    ctx.save();
    ctx.font = fontString(style);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    // measure total width (with letter spacing) to support center/right alignment & underline
    const spacing = style.letterSpacing || 0;
    let totalWidth = 0;
    const widths = [];
    for (const ch of text) {
      const w = ctx.measureText(ch).width;
      widths.push(w);
      totalWidth += w + spacing;
    }
    totalWidth -= spacing;

    let startX = x;
    if (style.align === 'center') startX = x - totalWidth / 2;
    else if (style.align === 'right') startX = x - totalWidth;

    if (style.shadow && style.shadow.enabled) {
      ctx.shadowColor = hexWithAlpha(style.shadow.color, style.shadow.opacity);
      ctx.shadowBlur = style.shadow.blur;
      ctx.shadowOffsetX = style.shadow.offsetX;
      ctx.shadowOffsetY = style.shadow.offsetY;
    }

    ctx.globalAlpha = style.opacity != null ? style.opacity : 1;
    ctx.fillStyle = style.color;
    if (style.stroke && style.stroke.enabled) {
      ctx.strokeStyle = style.stroke.color;
      ctx.lineWidth = style.stroke.width;
    }

    let cx = startX;
    let i = 0;
    for (const ch of text) {
      if (style.stroke && style.stroke.enabled) ctx.strokeText(ch, cx, y);
      ctx.fillText(ch, cx, y);
      cx += widths[i] + spacing;
      i++;
    }

    if (style.underline) {
      ctx.shadowColor = 'transparent';
      const lw = Math.max(1, style.fontSize / 16);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      const uy = y + style.fontSize * 0.08;
      ctx.moveTo(startX, uy);
      ctx.lineTo(startX + totalWidth, uy);
      ctx.stroke();
    }
    ctx.restore();
    return totalWidth;
  }

  function hexWithAlpha(hex, alpha) {
    const { r, g, b } = U.hexToRgb(hex);
    return `rgba(${r},${g},${b},${alpha == null ? 1 : alpha})`;
  }

  // Builds an offscreen tiled-pattern canvas (axis aligned; rotation is applied by Fabric's
  // object angle, not baked into the texture) sized to comfortably cover a page of the given
  // size even after arbitrary rotation (we use the page's diagonal as the square side).
  function buildPatternTexture(effStyle, pageW, pageH) {
    const diag = Math.ceil(Math.sqrt(pageW * pageW + pageH * pageH) * 1.15);
    const canvas = document.createElement('canvas');
    canvas.width = diag;
    canvas.height = diag;
    const ctx = canvas.getContext('2d');
    const style = Object.assign({}, effStyle, { fontFamilyCss: WM.Fonts.cssFamily(effStyle.fontFamily), align: 'left' });
    const spacingX = Math.max(10, (effStyle.pattern && effStyle.pattern.spacingX) || 60);
    const spacingY = Math.max(10, (effStyle.pattern && effStyle.pattern.spacingY) || 60);

    // Pattern text shares the same multi-line textarea as the "text" watermark type, so it may
    // contain '\n'. Split up front and lay out each tile's block with its own lines (matching
    // the export engine's approach) instead of feeding the raw string through char-by-char,
    // which previously ignored the newline entirely and ran every line's characters together
    // onto a single baseline.
    ctx.font = fontString(style);
    const lines = String(effStyle.text || '').split('\n');
    const lineHeight = style.fontSize * 1.25;
    const blockH = lines.length > 1 ? lineHeight * lines.length : style.fontSize;
    const spacing = style.letterSpacing || 0;
    const textW = lines.reduce((mx, line) => {
      let w = 0;
      for (const ch of line) w += ctx.measureText(ch).width + spacing;
      return Math.max(mx, w);
    }, 0) || 10;
    const cellW = textW + spacingX;
    const cellH = blockH + spacingY;

    const cols = Math.ceil(diag / cellW) + 2;
    const rows = Math.ceil(diag / cellH) + 2;

    for (let r = -1; r < rows; r++) {
      const rowOffset = (r % 2 === 0) ? 0 : cellW / 2; // brick-style stagger for classic watermark look
      for (let c = -1; c < cols; c++) {
        const x = c * cellW + rowOffset;
        const y0 = r * cellH + style.fontSize;
        lines.forEach((line, i) => {
          const y = y0 + (i - (lines.length - 1) / 2) * lineHeight;
          drawStyledText(ctx, line, Object.assign({}, style, { align: 'left' }), x, y);
        });
      }
    }
    return { canvas, size: diag };
  }

  function CanvasEditor(state, canvasEl, wrapEl) {
    this.state = state;
    this.wrapEl = wrapEl;
    this.fabricCanvas = new fabric.Canvas(canvasEl, {
      selection: false,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: false,
    });
    this.objectsByLayer = {}; // layerId -> fabric object
    this.bgObject = null;
    this._pageRasterCache = {}; // pageId -> canvas element
    this._loadingPage = null;
    this._suppressEvents = false;
    this.zoom = 1;
    this.fitMode = 'fit-page';

    this._wireCanvasEvents();
    window.addEventListener('resize', U.debounce(() => this.applyFit(), 150));
  }

  CanvasEditor.prototype._wireCanvasEvents = function () {
    const fc = this.fabricCanvas;
    const self = this;

    fc.on('selection:created', (e) => self._onSelectionChanged(e));
    fc.on('selection:updated', (e) => self._onSelectionChanged(e));
    fc.on('selection:cleared', () => {
      if (self._suppressEvents) return;
      self.state.selectedLayerId = null;
      self.state.emit('selection-changed');
    });

    fc.on('object:modified', (e) => self._onObjectModified(e));
    fc.on('object:moving', (e) => self._onObjectLive(e));
    fc.on('object:scaling', (e) => self._onObjectLive(e));
    fc.on('object:rotating', (e) => self._onObjectLive(e));
    fc.on('text:changed', (e) => self._onTextLive(e));
    fc.on('text:editing:exited', (e) => self._onTextEditExited(e));
  };

  CanvasEditor.prototype._layerIdForObject = function (obj) {
    for (const [id, o] of Object.entries(this.objectsByLayer)) if (o === obj) return id;
    return null;
  };

  CanvasEditor.prototype._onSelectionChanged = function (e) {
    if (this._suppressEvents) return;
    const obj = e.selected && e.selected[0];
    const id = obj ? this._layerIdForObject(obj) : null;
    if (id) {
      this.state.selectedLayerId = id;
      this.state.emit('selection-changed');
    }
  };

  CanvasEditor.prototype._currentPage = function () {
    return this.state.document.pages[this.state.currentPageIndex];
  };

  CanvasEditor.prototype._objToPatch = function (obj) {
    const page = this._currentPage();
    if (!page) return {};
    return {
      x: U.clamp(obj.left / page.widthPt, -2, 3),
      y: U.clamp(obj.top / page.heightPt, -2, 3),
      rotation: U.clampRotation360(obj.angle || 0),
      scale: obj.scaleX || 1,
    };
  };

  CanvasEditor.prototype._onObjectLive = function (e) {
    const obj = e.target;
    const id = this._layerIdForObject(obj);
    if (!id) return;
    const layer = this.state.getLayer(id);
    if (!layer) return;
    // keep uniform scaling
    if (obj.scaleY !== obj.scaleX) obj.scaleY = obj.scaleX;
    this.state.updateLayerStyle(id, this._objToPatch(obj), { silent: true });
    this.state.emit('live-transform', { layerId: id });
  };

  CanvasEditor.prototype._onObjectModified = function (e) {
    const obj = e.target;
    const id = this._layerIdForObject(obj);
    if (!id) return;
    const layer = this.state.getLayer(id);
    if (!layer) return;
    if (obj.scaleY !== obj.scaleX) { obj.scaleY = obj.scaleX; obj.setCoords(); }
    this.state.updateLayerStyle(id, this._objToPatch(obj), {});
  };

  CanvasEditor.prototype._onTextLive = function (e) {
    const obj = e.target;
    const id = this._layerIdForObject(obj);
    if (!id) return;
    this.state.updateLayerStyle(id, { text: obj.text }, { silent: true });
    this.state.emit('live-text', { layerId: id });
  };

  CanvasEditor.prototype._onTextEditExited = function (e) {
    const obj = e.target;
    const id = this._layerIdForObject(obj);
    if (!id) return;
    this.state.updateLayerStyle(id, { text: obj.text }, {});
  };

  // ---- Background page rendering ----
  CanvasEditor.prototype._getPageRaster = async function (page) {
    if (this._pageRasterCache[page.id]) return this._pageRasterCache[page.id];
    let canvas;
    if (page.kind === 'image') {
      canvas = page.imageEl;
    } else {
      const pdf = this.state.document.pdfDoc;
      const pdfPage = await pdf.getPage(page.pageNumber1based);
      const longSide = Math.max(page.widthPt, page.heightPt);
      const scale = U.clamp(PREVIEW_MAX_SIDE / longSide, 0.3, 4);
      canvas = await WM.PdfEngine.renderPageAtScale(pdfPage, scale, page.rotation);
    }
    this._pageRasterCache[page.id] = canvas;
    return canvas;
  };

  CanvasEditor.prototype.clearRasterCache = function () { this._pageRasterCache = {}; };

  // ---- Full load of a page: background + all applicable layers ----
  CanvasEditor.prototype.loadPage = async function (pageIndex) {
    const page = this.state.document.pages[pageIndex];
    if (!page) return;
    this.state.currentPageIndex = pageIndex;
    const loadToken = Symbol('load');
    this._loadingPage = loadToken;

    const raster = await this._getPageRaster(page);
    if (this._loadingPage !== loadToken) return; // superseded by a newer load

    this._suppressEvents = true;
    this.fabricCanvas.clear();
    this.objectsByLayer = {};

    const bg = new fabric.Image(raster, {
      left: 0, top: 0,
      scaleX: page.widthPt / raster.width,
      scaleY: page.heightPt / raster.height,
      selectable: false, evented: false, hoverCursor: 'default',
      excludeFromExport: false,
    });
    this.bgObject = bg;
    this.fabricCanvas.add(bg);

    await this.rebuildLayers();
    this._suppressEvents = false;
    this.applyFit();
  };

  // ---- Rebuild just the watermark layer objects (keeps background) ----
  CanvasEditor.prototype.rebuildLayers = async function () {
    const page = this._currentPage();
    if (!page) return;
    const wasSuppressed = this._suppressEvents;
    this._suppressEvents = true;

    // remove existing layer objects
    Object.values(this.objectsByLayer).forEach(obj => this.fabricCanvas.remove(obj));
    this.objectsByLayer = {};

    const applicable = this.state.layers.filter(l => this.state.layerAppliesToPage(l, this.state.currentPageIndex, this.state.document.pages.length));
    for (const layer of applicable) {
      const obj = await this._createFabricObjectForLayer(layer);
      this.objectsByLayer[layer.id] = obj;
      this.fabricCanvas.add(obj);
    }
    this._reapplySelection();
    this.fabricCanvas.requestRenderAll();
    this._suppressEvents = wasSuppressed;
  };

  CanvasEditor.prototype._reapplySelection = function () {
    const id = this.state.selectedLayerId;
    if (id && this.objectsByLayer[id]) {
      this.fabricCanvas.setActiveObject(this.objectsByLayer[id]);
    } else {
      this.fabricCanvas.discardActiveObject();
    }
  };

  CanvasEditor.prototype._createFabricObjectForLayer = async function (layer) {
    const page = this._currentPage();
    const eff = this.state.effectiveStyle(layer, this.state.currentPageIndex);
    let obj;
    if (layer.type === 'pattern') {
      const { canvas: tex } = buildPatternTexture(eff, page.widthPt, page.heightPt);
      obj = new fabric.Image(tex, {
        originX: 'center', originY: 'center',
        opacity: 1, // opacity already baked per-glyph so pattern reads evenly; keep obj opacity 1
      });
      obj.wmBaseSize = tex.width;
    } else {
      obj = new fabric.Textbox(eff.text, {
        originX: 'center', originY: 'center',
        editable: true,
        splitByGrapheme: false,
        width: Math.max(200, eff.fontSize * eff.text.length * 0.8),
      });
    }
    this._applyStyleToObject(obj, layer, eff, page);
    obj.lockScalingFlip = true;
    obj.setControlsVisibility({ ml: false, mt: false, mr: false, mb: false, mtr: true });
    if (layer.locked) {
      obj.selectable = false;
      obj.evented = false;
    } else {
      obj.selectable = true;
      obj.evented = true;
    }
    return obj;
  };

  CanvasEditor.prototype._applyStyleToObject = function (obj, layer, eff, page) {
    const left = eff.x * page.widthPt;
    const top = eff.y * page.heightPt;
    obj.set({ left, top, angle: eff.rotation || 0, scaleX: eff.scale || 1, scaleY: eff.scale || 1 });

    if (layer.type === 'pattern') {
      obj.set({ opacity: 1 });
    } else {
      obj.set({
        text: eff.text,
        fontFamily: WM.Fonts.cssFamily(eff.fontFamily),
        fontSize: eff.fontSize,
        fontWeight: eff.bold ? '700' : '400',
        fontStyle: eff.italic ? 'italic' : 'normal',
        underline: !!eff.underline,
        fill: eff.color,
        opacity: eff.opacity,
        charSpacing: eff.fontSize ? (eff.letterSpacing / eff.fontSize) * 1000 : 0,
        textAlign: eff.align || 'center',
        stroke: (eff.stroke && eff.stroke.enabled) ? eff.stroke.color : null,
        strokeWidth: (eff.stroke && eff.stroke.enabled) ? eff.stroke.width : 0,
        shadow: (eff.shadow && eff.shadow.enabled) ? new fabric.Shadow({
          color: hexWithAlpha(eff.shadow.color, eff.shadow.opacity),
          blur: eff.shadow.blur,
          offsetX: eff.shadow.offsetX,
          offsetY: eff.shadow.offsetY,
        }) : null,
      });
      obj.set({ width: Math.max(60, obj.calcTextWidth ? obj.calcTextWidth() + 10 : 200) });
    }
    obj.setCoords();
  };

  // Push current state style onto an existing fabric object (used after Properties Panel edits)
  CanvasEditor.prototype.refreshLayer = function (layerId) {
    const layer = this.state.getLayer(layerId);
    const obj = this.objectsByLayer[layerId];
    const page = this._currentPage();
    if (!layer || !obj || !page) return;

    if (layer.type === 'pattern') {
      // pattern text/spacing/font changes require rebuilding the texture
      const eff = this.state.effectiveStyle(layer, this.state.currentPageIndex);
      const { canvas: tex } = buildPatternTexture(eff, page.widthPt, page.heightPt);
      obj.setElement(tex);
      obj.wmBaseSize = tex.width;
      this._applyStyleToObject(obj, layer, eff, page);
    } else {
      const eff = this.state.effectiveStyle(layer, this.state.currentPageIndex);
      this._applyStyleToObject(obj, layer, eff, page);
    }
    obj.selectable = !layer.locked;
    obj.evented = !layer.locked;
    this.fabricCanvas.requestRenderAll();
  };

  CanvasEditor.prototype.selectLayer = function (layerId) {
    const obj = this.objectsByLayer[layerId];
    if (obj && obj.selectable) {
      this.fabricCanvas.setActiveObject(obj);
      this.fabricCanvas.requestRenderAll();
    } else {
      this.fabricCanvas.discardActiveObject();
      this.fabricCanvas.requestRenderAll();
    }
  };

  // ---- Zoom / Fit ----
  CanvasEditor.prototype.setZoom = function (zoom) {
    const page = this._currentPage();
    if (!page) return;
    this.zoom = U.clamp(zoom, 0.1, 6);
    this.fabricCanvas.setZoom(this.zoom);
    this.fabricCanvas.setDimensions({ width: page.widthPt * this.zoom, height: page.heightPt * this.zoom });
    this.fabricCanvas.requestRenderAll();
    this.state.view.zoom = this.zoom;
    this.state.emit('zoom-changed', this.zoom);
  };

  CanvasEditor.prototype.applyFit = function () {
    const page = this._currentPage();
    if (!page || !this.wrapEl) return;
    const availW = this.wrapEl.clientWidth - 48;
    const availH = this.wrapEl.clientHeight - 48;
    if (availW <= 0 || availH <= 0) return;
    let z;
    if (this.fitMode === 'fit-width') {
      z = availW / page.widthPt;
    } else if (this.fitMode === 'fit-page') {
      z = Math.min(availW / page.widthPt, availH / page.heightPt);
    } else {
      z = this.zoom;
    }
    this.setZoom(z);
  };

  CanvasEditor.prototype.setFitMode = function (mode) {
    this.fitMode = mode;
    this.applyFit();
  };

  WM.CanvasEditor = CanvasEditor;
  WM._internal = WM._internal || {};
  WM._internal.drawStyledText = drawStyledText;
  WM._internal.hexWithAlpha = hexWithAlpha;
  WM._internal.buildPatternTexture = buildPatternTexture;
})(window);
