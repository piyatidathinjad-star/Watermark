/* ============================================================
   Watermark Editor - Layers panel + Properties panel
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;

  function Panels(state, canvasEditor, els) {
    this.state = state;
    this.canvasEditor = canvasEditor;
    this.els = els; // { layersPanel, propertiesPanel }
    this._selfUpdating = false;
    this._dragSrcId = null;

    state.on('layers-changed', () => { if (!this._selfUpdating) this.renderAll(); });
    state.on('selection-changed', () => this.renderAll());
    state.on('document-loaded', () => this.renderAll());
    state.on('live-transform', (p) => this._updateLiveReadouts(p));
    state.on('page-changed', () => this.renderAll());

    this.renderAll();
  }

  Panels.prototype.renderAll = function () {
    this.renderLayers();
    this.renderProperties();
  };

  // ================= LAYERS PANEL =================
  Panels.prototype.renderLayers = function () {
    const el = this.els.layersPanel;
    const layers = this.state.layers;
    document.getElementById('layers-count').textContent = layers.length ? `(${layers.length})` : '';

    if (!layers.length) {
      el.innerHTML = '<div class="layers-empty">ยังไม่มีลายน้ำ — กด "ข้อความ" หรือ "Pattern" เพื่อเพิ่ม</div>';
      return;
    }

    // render topmost layer first (last in array = drawn on top => show at top of list)
    const ordered = layers.slice().reverse();
    el.innerHTML = ordered.map(l => this._layerItemHtml(l)).join('');

    el.querySelectorAll('.layer-item').forEach(item => {
      const id = item.dataset.id;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.li-btn') || e.target.closest('.li-name')) return;
        this.state.selectedLayerId = id;
        this.state.emit('selection-changed');
        this.canvasEditor.selectLayer(id);
      });
      item.querySelector('.li-visible').addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = this.state.getLayer(id);
        this.state.setLayerProp(id, { visible: !layer.visible });
        this.canvasEditor.rebuildLayers();
      });
      item.querySelector('.li-lock').addEventListener('click', (e) => {
        e.stopPropagation();
        const layer = this.state.getLayer(id);
        this.state.setLayerProp(id, { locked: !layer.locked });
        this.canvasEditor.rebuildLayers();
      });
      item.querySelector('.li-dup').addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.duplicateLayer(id);
        this.canvasEditor.rebuildLayers();
      });
      item.querySelector('.li-del').addEventListener('click', (e) => {
        e.stopPropagation();
        this.state.removeLayer(id);
        this.canvasEditor.rebuildLayers();
      });
      const nameInput = item.querySelector('.li-name');
      nameInput.addEventListener('click', (e) => e.stopPropagation());
      nameInput.addEventListener('change', () => {
        this.state.setLayerProp(id, { name: nameInput.value || 'Layer' });
      });

      item.setAttribute('draggable', 'true');
      item.addEventListener('dragstart', (e) => { this._dragSrcId = id; e.dataTransfer.effectAllowed = 'move'; });
      item.addEventListener('dragover', (e) => { e.preventDefault(); item.style.borderTop = '2px solid var(--primary)'; });
      item.addEventListener('dragleave', () => { item.style.borderTop = ''; });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.style.borderTop = '';
        if (!this._dragSrcId || this._dragSrcId === id) return;
        const targetLayer = this.state.getLayer(id);
        const srcIdx = this.state.layers.findIndex(l => l.id === this._dragSrcId);
        const targetIdx = this.state.layers.findIndex(l => l.id === id);
        this.state.reorderLayer(this._dragSrcId, targetIdx > srcIdx ? targetIdx : targetIdx);
        this.canvasEditor.rebuildLayers();
        this._dragSrcId = null;
      });
    });
  };

  Panels.prototype._layerItemHtml = function (l) {
    const selected = l.id === this.state.selectedLayerId;
    const icon = l.type === 'pattern' ? '▦' : 'T';
    return `
    <div class="layer-item ${selected ? 'selected' : ''} ${l.locked ? 'locked' : ''}" data-id="${l.id}">
      <span class="li-icon">${icon}</span>
      <input class="li-name" value="${U.escapeHtml(l.name)}" ${l.locked ? 'disabled' : ''} />
      <button class="li-btn li-visible ${l.visible ? 'active' : ''}" title="Show/Hide">${l.visible ? '👁' : '🚫'}</button>
      <button class="li-btn li-lock ${l.locked ? 'active' : ''}" title="Lock">${l.locked ? '🔒' : '🔓'}</button>
      <button class="li-btn li-dup" title="Duplicate">⧉</button>
      <button class="li-btn li-del" title="Delete">🗑</button>
    </div>`;
  };

  // ================= PROPERTIES PANEL =================
  Panels.prototype.renderProperties = function () {
    const el = this.els.propertiesPanel;
    const layer = this.state.getLayer(this.state.selectedLayerId);
    if (!layer) {
      el.innerHTML = '<div class="props-empty">เลือกลายน้ำเพื่อแก้ไขคุณสมบัติ</div>';
      this._updateBottomReadout(null);
      return;
    }
    const eff = this.state.effectiveStyle(layer, this.state.currentPageIndex);
    el.innerHTML = this._propsHtml(layer, eff);
    this._wirePropsEvents(layer);
    this._updateBottomReadout(eff);
  };

  Panels.prototype._propsHtml = function (layer, eff) {
    const fontsOptions = WM.Fonts.list.map(f => `<option value="${f.id}" ${eff.fontFamily === f.id ? 'selected' : ''}>${f.label}</option>`).join('');
    const totalPages = this.state.document.pages.length;
    const isPattern = layer.type === 'pattern';

    return `
      <div class="prop-group">
        <div class="prop-group-title">ข้อความ</div>
        <div class="prop-row"><textarea id="p-text" rows="2">${U.escapeHtml(eff.text)}</textarea></div>
      </div>

      <div class="prop-group">
        <div class="prop-group-title">Font</div>
        <div class="prop-row"><label>ฟอนต์</label><select id="p-font">${fontsOptions}</select></div>
        <div class="prop-row"><label>ขนาด</label><input type="range" id="p-size" min="6" max="240" value="${eff.fontSize}"><span class="range-val" id="p-size-val">${eff.fontSize}</span></div>
        <div class="style-toggle-row">
          <button class="style-toggle ${eff.bold ? 'active' : ''}" id="p-bold" title="Bold"><b>B</b></button>
          <button class="style-toggle ${eff.italic ? 'active' : ''}" id="p-italic" title="Italic"><i>I</i></button>
          <button class="style-toggle ${eff.underline ? 'active' : ''}" id="p-underline" title="Underline"><u>U</u></button>
        </div>
        <div class="prop-row"><label>จัดตำแหน่ง</label>
          <div class="seg-group">
            <button class="seg-btn ${eff.align === 'left' ? 'active' : ''}" data-align="left">ซ้าย</button>
            <button class="seg-btn ${eff.align === 'center' ? 'active' : ''}" data-align="center">กลาง</button>
            <button class="seg-btn ${eff.align === 'right' ? 'active' : ''}" data-align="right">ขวา</button>
          </div>
        </div>
        <div class="prop-row"><label>ระยะห่างตัวอักษร</label><input type="range" id="p-spacing" min="-5" max="60" value="${eff.letterSpacing}"><span class="range-val" id="p-spacing-val">${eff.letterSpacing}</span></div>
      </div>

      <div class="prop-group">
        <div class="prop-group-title">สี &amp; ความโปร่งใส</div>
        <div class="prop-row"><label>สี</label><input type="color" id="p-color" value="${eff.color}"></div>
        <div class="prop-row"><label>โปร่งใส</label><input type="range" id="p-opacity" min="0" max="100" value="${Math.round(eff.opacity * 100)}"><span class="range-val" id="p-opacity-val">${Math.round(eff.opacity * 100)}%</span></div>
      </div>

      <div class="prop-group">
        <div class="prop-group-title">ขอบตัวอักษร (Stroke)</div>
        <div class="toggle-row"><label>เปิดใช้งาน</label><label class="switch"><input type="checkbox" id="p-stroke-on" ${eff.stroke.enabled ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="prop-row"><label>สีขอบ</label><input type="color" id="p-stroke-color" value="${eff.stroke.color}" ${eff.stroke.enabled ? '' : 'disabled'}></div>
        <div class="prop-row"><label>ความหนา</label><input type="range" id="p-stroke-width" min="0.5" max="12" step="0.5" value="${eff.stroke.width}" ${eff.stroke.enabled ? '' : 'disabled'}><span class="range-val" id="p-stroke-width-val">${eff.stroke.width}</span></div>
      </div>

      <div class="prop-group">
        <div class="prop-group-title">เงา (Shadow)</div>
        <div class="toggle-row"><label>เปิดใช้งาน</label><label class="switch"><input type="checkbox" id="p-shadow-on" ${eff.shadow.enabled ? 'checked' : ''}><span class="slider"></span></label></div>
        <div class="prop-row"><label>สีเงา</label><input type="color" id="p-shadow-color" value="${eff.shadow.color}" ${eff.shadow.enabled ? '' : 'disabled'}></div>
        <div class="prop-row"><label>เบลอ</label><input type="range" id="p-shadow-blur" min="0" max="40" value="${eff.shadow.blur}" ${eff.shadow.enabled ? '' : 'disabled'}><span class="range-val" id="p-shadow-blur-val">${eff.shadow.blur}</span></div>
        <div class="prop-row"><label>ระยะ X</label><input type="range" id="p-shadow-ox" min="-30" max="30" value="${eff.shadow.offsetX}" ${eff.shadow.enabled ? '' : 'disabled'}><span class="range-val" id="p-shadow-ox-val">${eff.shadow.offsetX}</span></div>
        <div class="prop-row"><label>ระยะ Y</label><input type="range" id="p-shadow-oy" min="-30" max="30" value="${eff.shadow.offsetY}" ${eff.shadow.enabled ? '' : 'disabled'}><span class="range-val" id="p-shadow-oy-val">${eff.shadow.offsetY}</span></div>
      </div>

      <div class="prop-group">
        <div class="prop-group-title">ตำแหน่งและขนาด</div>
        <div class="prop-row"><label>X (%)</label><input type="number" id="p-x" min="-100" max="200" step="0.5" value="${(eff.x * 100).toFixed(1)}"></div>
        <div class="prop-row"><label>Y (%)</label><input type="number" id="p-y" min="-100" max="200" step="0.5" value="${(eff.y * 100).toFixed(1)}"></div>
        <div class="prop-row"><label>หมุน (°)</label><input type="number" id="p-rotation" min="-360" max="360" step="1" value="${Math.round(eff.rotation)}"></div>
        <div class="prop-row"><label>ขนาด (%)</label><input type="number" id="p-scale" min="5" max="1000" step="1" value="${Math.round(eff.scale * 100)}"></div>
      </div>

      ${isPattern ? `
      <div class="prop-group">
        <div class="prop-group-title">Pattern</div>
        <div class="prop-row"><label>ระยะห่าง X</label><input type="range" id="p-pat-sx" min="0" max="300" value="${eff.pattern.spacingX}"><span class="range-val" id="p-pat-sx-val">${eff.pattern.spacingX}</span></div>
        <div class="prop-row"><label>ระยะห่าง Y</label><input type="range" id="p-pat-sy" min="0" max="300" value="${eff.pattern.spacingY}"><span class="range-val" id="p-pat-sy-val">${eff.pattern.spacingY}</span></div>
      </div>` : ''}

      ${this._scopeHtml(layer, totalPages)}
    `;
  };

  Panels.prototype._scopeHtml = function (layer, totalPages) {
    const scope = layer.pageScope;
    const isPdf = this.state.document.type === 'pdf';
    if (!isPdf) return '';
    const modes = [
      ['all', 'ทุกหน้า'], ['selected', 'เลือกหน้า'], ['range', 'ช่วงหน้า'], ['odd', 'หน้าคี่'], ['even', 'หน้าคู่'],
    ];
    let pagePicker = '';
    if (scope.mode === 'selected') {
      let cells = '';
      for (let i = 1; i <= totalPages; i++) {
        const active = (scope.pages || []).includes(i);
        cells += `<div class="page-select-cell ${active ? 'active' : ''}" data-page="${i}">${i}</div>`;
      }
      pagePicker = `<div class="page-select-grid" id="p-page-grid">${cells}</div>`;
    } else if (scope.mode === 'range') {
      pagePicker = `<div class="prop-row"><label>จาก</label><input type="number" id="p-range-from" min="1" max="${totalPages}" value="${scope.range.from || 1}"></div>
                    <div class="prop-row"><label>ถึง</label><input type="number" id="p-range-to" min="1" max="${totalPages}" value="${scope.range.to || totalPages}"></div>`;
    }

    return `
      <div class="prop-group">
        <div class="prop-group-title">ใส่ลายน้ำในหน้า</div>
        <div class="prop-row">
          <select id="p-scope-mode" style="flex:1">
            ${modes.map(([v, l]) => `<option value="${v}" ${scope.mode === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        ${pagePicker}
        <div class="toggle-row" style="margin-top:10px">
          <label>ลายน้ำแยกตามหน้า</label>
          <label class="switch"><input type="checkbox" id="p-independent" ${layer.independentPerPage ? 'checked' : ''}><span class="slider"></span></label>
        </div>
        <div class="hint-text">${layer.independentPerPage ? `กำลังแก้ไขค่าเฉพาะหน้า ${this.state.currentPageIndex + 1} — หน้าอื่นจะไม่เปลี่ยนตาม` : 'ลายน้ำจะเหมือนกันทุกหน้าที่เลือกไว้ด้านบน'}</div>
        ${layer.independentPerPage ? `<button class="btn btn-sm btn-ghost btn-block" id="p-reset-page-override" style="margin-top:8px">รีเซ็ตค่าของหน้านี้</button>` : ''}
      </div>
    `;
  };

  Panels.prototype._wirePropsEvents = function (layer) {
    const id = layer.id;
    const self = this;
    const panel = this.els.propertiesPanel;

    const updateStyle = (patch, opts) => {
      self._selfUpdating = true;
      self.state.updateLayerStyle(id, patch, opts || { debounceCommit: true });
      self.canvasEditor.refreshLayer(id);
      self._updateBottomReadout(self.state.effectiveStyle(self.state.getLayer(id), self.state.currentPageIndex));
      self._selfUpdating = false;
    };

    const bindText = (elId, key) => {
      const node = panel.querySelector(elId);
      if (!node) return;
      node.addEventListener('input', () => updateStyle({ [key]: node.value }));
      node.addEventListener('change', () => updateStyle({ [key]: node.value }, {}));
    };
    const bindRange = (elId, valId, key, transform) => {
      const node = panel.querySelector(elId);
      if (!node) return;
      const valNode = valId ? panel.querySelector(valId) : null;
      node.addEventListener('input', () => {
        const v = transform ? transform(Number(node.value)) : Number(node.value);
        if (valNode) valNode.textContent = valId && valId.includes('opacity') ? node.value + '%' : node.value;
        updateStyle({ [key]: v });
      });
      node.addEventListener('change', () => {
        const v = transform ? transform(Number(node.value)) : Number(node.value);
        updateStyle({ [key]: v }, {});
      });
    };

    bindText('#p-text', 'text');
    bindText('#p-font', 'fontFamily');
    panel.querySelector('#p-font').addEventListener('change', () => updateStyle({}, {}));
    bindRange('#p-size', '#p-size-val', 'fontSize');
    bindRange('#p-spacing', '#p-spacing-val', 'letterSpacing');
    bindRange('#p-opacity', '#p-opacity-val', 'opacity', v => v / 100);

    panel.querySelector('#p-bold').addEventListener('click', () => updateStyle({ bold: !self._curVal(layer, 'bold') }, {}));
    panel.querySelector('#p-italic').addEventListener('click', () => updateStyle({ italic: !self._curVal(layer, 'italic') }, {}));
    panel.querySelector('#p-underline').addEventListener('click', () => updateStyle({ underline: !self._curVal(layer, 'underline') }, {}));

    panel.querySelectorAll('[data-align]').forEach(btn => {
      btn.addEventListener('click', () => updateStyle({ align: btn.dataset.align }, {}));
    });

    panel.querySelector('#p-color').addEventListener('input', (e) => updateStyle({ color: e.target.value }));
    panel.querySelector('#p-color').addEventListener('change', (e) => updateStyle({ color: e.target.value }, {}));

    // stroke
    panel.querySelector('#p-stroke-on').addEventListener('change', (e) => updateStyle({ stroke: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).stroke, { enabled: e.target.checked }) }, {}));
    bindColor('#p-stroke-color', (v) => updateStyle({ stroke: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).stroke, { color: v }) }));
    const swNode = panel.querySelector('#p-stroke-width');
    const swVal = panel.querySelector('#p-stroke-width-val');
    if (swNode) {
      swNode.addEventListener('input', () => { if (swVal) swVal.textContent = swNode.value; updateStyle({ stroke: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).stroke, { width: Number(swNode.value) }) }); });
      swNode.addEventListener('change', () => updateStyle({ stroke: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).stroke, { width: Number(swNode.value) }) }, {}));
    }

    // shadow
    panel.querySelector('#p-shadow-on').addEventListener('change', (e) => updateStyle({ shadow: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).shadow, { enabled: e.target.checked }) }, {}));
    bindColor('#p-shadow-color', (v) => updateStyle({ shadow: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).shadow, { color: v }) }));
    ['blur', 'ox', 'oy'].forEach(k => {
      const key = k === 'ox' ? 'offsetX' : k === 'oy' ? 'offsetY' : 'blur';
      const node = panel.querySelector(`#p-shadow-${k}`);
      if (!node) return;
      node.addEventListener('input', () => updateStyle({ shadow: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).shadow, { [key]: Number(node.value) }) }));
      node.addEventListener('change', () => updateStyle({ shadow: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).shadow, { [key]: Number(node.value) }) }, {}));
    });

    // position/rotation/scale
    const bindNum = (elId, key, transform) => {
      const node = panel.querySelector(elId);
      if (!node) return;
      node.addEventListener('change', () => {
        const v = transform ? transform(Number(node.value)) : Number(node.value);
        updateStyle({ [key]: v }, {});
      });
    };
    bindNum('#p-x', 'x', v => v / 100);
    bindNum('#p-y', 'y', v => v / 100);
    bindNum('#p-rotation', 'rotation');
    bindNum('#p-scale', 'scale', v => v / 100);

    function bindColor(elId, fn) {
      const node = panel.querySelector(elId);
      if (!node) return;
      node.addEventListener('input', () => fn(node.value));
      node.addEventListener('change', () => fn(node.value));
    }

    // pattern spacing
    if (layer.type === 'pattern') {
      const sx = panel.querySelector('#p-pat-sx');
      const sy = panel.querySelector('#p-pat-sy');
      const sxVal = panel.querySelector('#p-pat-sx-val');
      const syVal = panel.querySelector('#p-pat-sy-val');
      if (sx) {
        sx.addEventListener('input', () => { if (sxVal) sxVal.textContent = sx.value; updateStyle({ pattern: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).pattern, { spacingX: Number(sx.value) }) }); });
        sx.addEventListener('change', () => updateStyle({ pattern: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).pattern, { spacingX: Number(sx.value) }) }, {}));
      }
      if (sy) {
        sy.addEventListener('input', () => { if (syVal) syVal.textContent = sy.value; updateStyle({ pattern: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).pattern, { spacingY: Number(sy.value) }) }); });
        sy.addEventListener('change', () => updateStyle({ pattern: Object.assign({}, self.state.effectiveStyle(layer, self.state.currentPageIndex).pattern, { spacingY: Number(sy.value) }) }, {}));
      }
    }

    // scope
    const scopeMode = panel.querySelector('#p-scope-mode');
    if (scopeMode) {
      scopeMode.addEventListener('change', () => {
        self.state.setLayerProp(id, { pageScope: Object.assign({}, layer.pageScope, { mode: scopeMode.value }) });
        self.canvasEditor.rebuildLayers();
      });
    }
    const grid = panel.querySelector('#p-page-grid');
    if (grid) {
      grid.querySelectorAll('.page-select-cell').forEach(cell => {
        cell.addEventListener('click', () => {
          const p = Number(cell.dataset.page);
          const pages = new Set(layer.pageScope.pages || []);
          if (pages.has(p)) pages.delete(p); else pages.add(p);
          self.state.setLayerProp(id, { pageScope: Object.assign({}, layer.pageScope, { pages: Array.from(pages).sort((a, b) => a - b) }) });
          self.canvasEditor.rebuildLayers();
        });
      });
    }
    const rf = panel.querySelector('#p-range-from');
    const rt = panel.querySelector('#p-range-to');
    if (rf) rf.addEventListener('change', () => { self.state.setLayerProp(id, { pageScope: Object.assign({}, layer.pageScope, { range: Object.assign({}, layer.pageScope.range, { from: Number(rf.value) }) }) }); self.canvasEditor.rebuildLayers(); });
    if (rt) rt.addEventListener('change', () => { self.state.setLayerProp(id, { pageScope: Object.assign({}, layer.pageScope, { range: Object.assign({}, layer.pageScope.range, { to: Number(rt.value) }) }) }); self.canvasEditor.rebuildLayers(); });

    const indep = panel.querySelector('#p-independent');
    if (indep) {
      indep.addEventListener('change', () => {
        self.state.setLayerProp(id, { independentPerPage: indep.checked });
        self.renderProperties();
        self.canvasEditor.rebuildLayers();
      });
    }
    const resetOv = panel.querySelector('#p-reset-page-override');
    if (resetOv) {
      resetOv.addEventListener('click', () => {
        delete layer.overrides[String(self.state.currentPageIndex)];
        self.state.commit('reset-page-override');
        self.state.emit('layers-changed');
        self.canvasEditor.rebuildLayers();
      });
    }
  };

  Panels.prototype._curVal = function (layer, key) {
    return this.state.effectiveStyle(layer, this.state.currentPageIndex)[key];
  };

  Panels.prototype._updateLiveReadouts = function (payload) {
    if (payload.layerId !== this.state.selectedLayerId) return;
    const layer = this.state.getLayer(payload.layerId);
    if (!layer) return;
    const eff = this.state.effectiveStyle(layer, this.state.currentPageIndex);
    this._updateBottomReadout(eff);
    const panel = this.els.propertiesPanel;
    const xN = panel.querySelector('#p-x'), yN = panel.querySelector('#p-y'), rN = panel.querySelector('#p-rotation'), sN = panel.querySelector('#p-scale');
    if (xN && document.activeElement !== xN) xN.value = (eff.x * 100).toFixed(1);
    if (yN && document.activeElement !== yN) yN.value = (eff.y * 100).toFixed(1);
    if (rN && document.activeElement !== rN) rN.value = Math.round(eff.rotation);
    if (sN && document.activeElement !== sN) sN.value = Math.round(eff.scale * 100);
  };

  Panels.prototype._updateBottomReadout = function (eff) {
    const xyEl = document.getElementById('readout-xy');
    const sizeEl = document.getElementById('readout-size');
    if (!eff) {
      xyEl.textContent = 'X: — Y: —';
      sizeEl.textContent = 'ขนาด: —';
      return;
    }
    xyEl.textContent = `X: ${(eff.x * 100).toFixed(1)}% Y: ${(eff.y * 100).toFixed(1)}%`;
    sizeEl.textContent = `ขนาด: ${Math.round(eff.scale * 100)}%  หมุน: ${Math.round(eff.rotation)}°`;
  };

  WM.Panels = Panels;
})(window);
