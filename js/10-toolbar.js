/* ============================================================
   Watermark Editor - Toolbar: add layer, undo/redo/reset,
   duplicate, keyboard shortcuts, export modal.
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;

  function showToast(msg, isError) {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 250);
    }, isError ? 4200 : 2600);
  }
  WM.showToast = showToast;

  function Toolbar(state, canvasEditor, els) {
    this.state = state;
    this.canvasEditor = canvasEditor;
    this.els = els;

    els.addText.addEventListener('click', () => this.addLayer('text'));
    els.addPattern.addEventListener('click', () => this.addLayer('pattern'));
    els.undo.addEventListener('click', () => { state.undo(); canvasEditor.rebuildLayers(); });
    els.redo.addEventListener('click', () => { state.redo(); canvasEditor.rebuildLayers(); });
    els.reset.addEventListener('click', () => this.resetAll());
    els.duplicate.addEventListener('click', () => this.duplicateSelected());

    state.on('history', (h) => {
      els.undo.disabled = !h.canUndo;
      els.redo.disabled = !h.canRedo;
    });
    state.on('document-loaded', () => this._syncToolAvailability());
    state.on('selection-changed', () => this._syncToolAvailability());
    state.on('layers-changed', () => this._syncToolAvailability());

    this._wireKeyboard();
    this._syncToolAvailability();
  }

  Toolbar.prototype._syncToolAvailability = function () {
    const hasDoc = !!this.state.document.type;
    this.els.addText.disabled = !hasDoc;
    this.els.addPattern.disabled = !hasDoc;
    this.els.reset.disabled = !hasDoc;
    this.els.exportTop.disabled = !hasDoc;
    this.els.exportBottom.disabled = !hasDoc;
    const hasSel = !!this.state.selectedLayerId;
    this.els.duplicate.disabled = !hasSel;
  };

  Toolbar.prototype.addLayer = function (type) {
    const page = this.state.document.pages[this.state.currentPageIndex];
    const layer = this.state.addLayer(type, { text: type === 'pattern' ? 'CONFIDENTIAL' : 'CONFIDENTIAL' });
    this.canvasEditor.rebuildLayers();
    this.canvasEditor.selectLayer(layer.id);
    showToast(type === 'pattern' ? 'เพิ่มลายน้ำแบบ Pattern แล้ว' : 'เพิ่มลายน้ำข้อความแล้ว');
  };

  Toolbar.prototype.duplicateSelected = function () {
    const id = this.state.selectedLayerId;
    if (!id) return;
    const clone = this.state.duplicateLayer(id);
    this.canvasEditor.rebuildLayers();
    if (clone) this.canvasEditor.selectLayer(clone.id);
  };

  Toolbar.prototype.resetAll = function () {
    if (!this.state.layers.length) return;
    if (!confirm('ลบลายน้ำทั้งหมดและเริ่มใหม่?')) return;
    this.state.layers = [];
    this.state.selectedLayerId = null;
    this.state.commit('reset-all');
    this.state.emit('layers-changed');
    this.canvasEditor.rebuildLayers();
    showToast('รีเซ็ตลายน้ำทั้งหมดแล้ว');
  };

  Toolbar.prototype._isTypingContext = function () {
    const ae = document.activeElement;
    if (!ae) return false;
    const tag = ae.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    const active = this.canvasEditor.fabricCanvas.getActiveObject();
    if (active && active.isEditing) return true;
    return false;
  };

  Toolbar.prototype._wireKeyboard = function () {
    const self = this;
    document.addEventListener('keydown', (e) => {
      const typing = self._isTypingContext();
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault(); self.state.undo(); self.canvasEditor.rebuildLayers(); return;
      }
      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault(); self.state.redo(); self.canvasEditor.rebuildLayers(); return;
      }
      if (typing) return;

      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault(); self.duplicateSelected(); return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && self.state.selectedLayerId) {
        e.preventDefault();
        const layer = self.state.getLayer(self.state.selectedLayerId);
        if (layer && !layer.locked) {
          self.state.removeLayer(self.state.selectedLayerId);
          self.canvasEditor.rebuildLayers();
        }
        return;
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && self.state.selectedLayerId) {
        const layer = self.state.getLayer(self.state.selectedLayerId);
        if (!layer || layer.locked) return;
        e.preventDefault();
        const page = self.state.document.pages[self.state.currentPageIndex];
        if (!page) return;
        const step = (e.shiftKey ? 10 : 1) / page.widthPt;
        const stepY = (e.shiftKey ? 10 : 1) / page.heightPt;
        const eff = self.state.effectiveStyle(layer, self.state.currentPageIndex);
        let dx = 0, dy = 0;
        if (e.key === 'ArrowUp') dy = -stepY;
        if (e.key === 'ArrowDown') dy = stepY;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        self.state.updateLayerStyle(layer.id, { x: eff.x + dx, y: eff.y + dy }, {});
        self.canvasEditor.refreshLayer(layer.id);
        return;
      }
      if (e.key === 'f' || e.key === 'F') {
        if (document.getElementById('btn-fullscreen')) document.getElementById('btn-fullscreen').click();
      }
      if (e.key === '+' || e.key === '=') {
        const btn = document.getElementById('btn-zoom-in'); if (btn) btn.click();
      }
      if (e.key === '-' || e.key === '_') {
        const btn = document.getElementById('btn-zoom-out'); if (btn) btn.click();
      }
    });
  };

  WM.Toolbar = Toolbar;
})(window);
