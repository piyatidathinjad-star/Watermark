/* ============================================================
   Watermark Editor - Central State Store
   Single source of truth for the document, watermark layers and
   view/UI state, with a snapshot-based undo/redo history.
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;

  function defaultTextLayerProps(text) {
    return {
      x: 0.5, y: 0.5,           // fraction of page width/height (anchor = center of watermark)
      rotation: 0,               // degrees, clockwise
      scale: 1,
      text: text || 'CONFIDENTIAL',
      fontFamily: 'NotoSansThai',
      fontSize: 36,               // pt (or px for images), at scale 1
      bold: false,
      italic: false,
      underline: false,
      color: '#FF3B30',
      opacity: 0.5,
      letterSpacing: 0,
      align: 'center',
      stroke: { enabled: false, color: '#000000', width: 1 },
      shadow: { enabled: false, color: '#000000', blur: 6, offsetX: 3, offsetY: 3, opacity: 0.6 },
    };
  }

  function defaultPatternLayerProps(text) {
    return Object.assign(defaultTextLayerProps(text || 'CONFIDENTIAL'), {
      fontSize: 28,
      opacity: 0.18,
      rotation: -30,
      color: '#FF3B30',
      pattern: { spacingX: 60, spacingY: 60 },
    });
  }

  function makeLayer(type, opts) {
    opts = opts || {};
    const base = type === 'pattern' ? defaultPatternLayerProps(opts.text) : defaultTextLayerProps(opts.text);
    return {
      id: U.uid('layer'),
      type: type, // 'text' | 'pattern'
      name: opts.name || (type === 'pattern' ? 'Pattern watermark' : 'Text watermark'),
      visible: true,
      locked: false,
      pageScope: { mode: 'all', pages: [], range: { from: 1, to: 1 } },
      independentPerPage: false,
      base: base,
      overrides: {}, // pageIndex(string) -> partial base
    };
  }

  function State() {
    U.Emitter.call(this);
    this.document = {
      type: null,      // 'images' | 'pdf'
      fileName: '',
      pages: [],        // see document-import.js for shape
      originalPdfBytes: null,
    };
    this.layers = [];
    this.selectedLayerId = null;
    this.currentPageIndex = 0;
    this.view = { zoom: 1, fitMode: 'fit-page', fullscreen: false };
    this._history = [];
    this._historyIndex = -1;
    this._suspendHistory = false;
  }
  State.prototype = Object.create(U.Emitter.prototype);
  State.prototype.constructor = State;

  State.prototype.reset = function () {
    this.document = { type: null, fileName: '', pages: [], originalPdfBytes: null };
    this.layers = [];
    this.selectedLayerId = null;
    this.currentPageIndex = 0;
    this.view = { zoom: 1, fitMode: 'fit-page', fullscreen: false };
    this._history = [];
    this._historyIndex = -1;
    this.emit('reset');
    this.emit('change', { type: 'reset' });
  };

  // ---- Serializable snapshot (layers + scope config only; NOT raster/page image data) ----
  State.prototype._snapshot = function () {
    return {
      layers: U.deepClone(this.layers),
      selectedLayerId: this.selectedLayerId,
      currentPageIndex: this.currentPageIndex,
    };
  };

  State.prototype._applySnapshot = function (snap) {
    this.layers = U.deepClone(snap.layers);
    this.selectedLayerId = snap.selectedLayerId;
    this.currentPageIndex = snap.currentPageIndex;
  };

  State.prototype.commit = function (label) {
    if (this._suspendHistory) return;
    // Truncate redo branch
    this._history = this._history.slice(0, this._historyIndex + 1);
    this._history.push({ label: label || 'change', snap: this._snapshot() });
    if (this._history.length > 60) this._history.shift();
    this._historyIndex = this._history.length - 1;
    this.emit('history', this.historyState());
  };

  State.prototype.initHistory = function () {
    this._history = [{ label: 'initial', snap: this._snapshot() }];
    this._historyIndex = 0;
    this.emit('history', this.historyState());
  };

  State.prototype.canUndo = function () { return this._historyIndex > 0; };
  State.prototype.canRedo = function () { return this._historyIndex < this._history.length - 1; };
  State.prototype.historyState = function () { return { canUndo: this.canUndo(), canRedo: this.canRedo() }; };

  State.prototype.undo = function () {
    if (!this.canUndo()) return;
    this._historyIndex -= 1;
    this._suspendHistory = true;
    this._applySnapshot(this._history[this._historyIndex].snap);
    this._suspendHistory = false;
    this.emit('layers-changed');
    this.emit('change', { type: 'undo' });
    this.emit('history', this.historyState());
  };

  State.prototype.redo = function () {
    if (!this.canRedo()) return;
    this._historyIndex += 1;
    this._suspendHistory = true;
    this._applySnapshot(this._history[this._historyIndex].snap);
    this._suspendHistory = false;
    this.emit('layers-changed');
    this.emit('change', { type: 'redo' });
    this.emit('history', this.historyState());
  };

  // ---- Layer operations ----
  State.prototype.addLayer = function (type, opts) {
    const layer = makeLayer(type, opts || {});
    // default scope: current page only feels surprising; use "all" by default
    this.layers.push(layer);
    this.selectedLayerId = layer.id;
    this.commit('add-layer');
    this.emit('layers-changed');
    this.emit('change', { type: 'add-layer', layerId: layer.id });
    return layer;
  };

  State.prototype.getLayer = function (id) {
    return this.layers.find(l => l.id === id) || null;
  };

  State.prototype.removeLayer = function (id) {
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx < 0) return;
    this.layers.splice(idx, 1);
    if (this.selectedLayerId === id) {
      this.selectedLayerId = this.layers.length ? this.layers[this.layers.length - 1].id : null;
    }
    this.commit('remove-layer');
    this.emit('layers-changed');
    this.emit('change', { type: 'remove-layer', layerId: id });
  };

  State.prototype.duplicateLayer = function (id) {
    const src = this.getLayer(id);
    if (!src) return null;
    const clone = U.deepClone(src);
    clone.id = U.uid('layer');
    clone.name = src.name + ' copy';
    clone.base.x = U.clamp(src.base.x + 0.03, 0, 1);
    clone.base.y = U.clamp(src.base.y + 0.03, 0, 1);
    const idx = this.layers.findIndex(l => l.id === id);
    this.layers.splice(idx + 1, 0, clone);
    this.selectedLayerId = clone.id;
    this.commit('duplicate-layer');
    this.emit('layers-changed');
    this.emit('change', { type: 'duplicate-layer', layerId: clone.id });
    return clone;
  };

  State.prototype.reorderLayer = function (id, newIndex) {
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx < 0) return;
    const [layer] = this.layers.splice(idx, 1);
    newIndex = U.clamp(newIndex, 0, this.layers.length);
    this.layers.splice(newIndex, 0, layer);
    this.commit('reorder-layer');
    this.emit('layers-changed');
    this.emit('change', { type: 'reorder-layer' });
  };

  State.prototype.moveLayer = function (id, delta) {
    const idx = this.layers.findIndex(l => l.id === id);
    if (idx < 0) return;
    this.reorderLayer(id, idx + delta);
  };

  State.prototype.setLayerProp = function (id, patch, opts) {
    const layer = this.getLayer(id);
    if (!layer) return;
    Object.assign(layer, patch);
    this._afterLayerMutate(opts);
  };

  // Updates base OR the current-page override, depending on layer.independentPerPage
  State.prototype.updateLayerStyle = function (id, patch, opts) {
    const layer = this.getLayer(id);
    if (!layer) return;
    if (layer.independentPerPage) {
      const key = String(this.currentPageIndex);
      const cur = layer.overrides[key] || {};
      layer.overrides[key] = Object.assign({}, cur, U.deepClone(patch));
    } else {
      Object.assign(layer.base, U.deepClone(patch));
    }
    this._afterLayerMutate(opts);
  };

  State.prototype._afterLayerMutate = function (opts) {
    opts = opts || {};
    this.emit('layers-changed');
    this.emit('change', { type: 'update-layer' });
    if (!opts.silent) {
      if (opts.debounceCommit) {
        this._debouncedCommit = this._debouncedCommit || U.debounce(() => this.commit('update-layer'), 400);
        this._debouncedCommit();
      } else {
        this.commit('update-layer');
      }
    }
  };

  // Effective style for a layer on a given page index (merges base + override)
  State.prototype.effectiveStyle = function (layer, pageIndex) {
    if (layer.independentPerPage) {
      const ov = layer.overrides[String(pageIndex)];
      if (ov) return WM.Utils.deepClone(Object.assign({}, layer.base, ov, {
        stroke: Object.assign({}, layer.base.stroke, ov.stroke),
        shadow: Object.assign({}, layer.base.shadow, ov.shadow),
        pattern: layer.base.pattern ? Object.assign({}, layer.base.pattern, ov.pattern) : undefined,
      }));
    }
    return WM.Utils.deepClone(layer.base);
  };

  // Does this layer apply to the given 0-based page index?
  State.prototype.layerAppliesToPage = function (layer, pageIndex, totalPages) {
    const scope = layer.pageScope;
    const pageNum = pageIndex + 1; // 1-based for UI-facing scope math
    switch (scope.mode) {
      case 'all': return true;
      case 'odd': return pageNum % 2 === 1;
      case 'even': return pageNum % 2 === 0;
      case 'range': {
        const from = scope.range.from || 1;
        const to = scope.range.to || totalPages;
        return pageNum >= from && pageNum <= to;
      }
      case 'selected':
        return (scope.pages || []).includes(pageNum);
      default:
        return true;
    }
  };

  State.prototype.layersForPage = function (pageIndex) {
    const total = this.document.pages.length;
    return this.layers.filter(l => l.visible && this.layerAppliesToPage(l, pageIndex, total));
  };

  WM.State = State;
  WM.makeLayer = makeLayer;
})(window);
