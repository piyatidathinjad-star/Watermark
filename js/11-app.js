/* ============================================================
   Watermark Editor - App bootstrap
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;

  function $(id) { return document.getElementById(id); }

  function openModal(html) {
    const root = $('modal-root');
    root.innerHTML = `<div class="modal-overlay"><div class="modal-box">${html}</div></div>`;
    const overlay = root.querySelector('.modal-overlay');
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeModal(); });
    return root.querySelector('.modal-box');
  }
  function closeModal() { $('modal-root').innerHTML = ''; }

  function buildExportModal(state) {
    const isPdf = state.document.type === 'pdf';
    const box = openModal(`
      <div class="modal-title">ส่งออกไฟล์</div>
      <div class="prop-group-title">รูปแบบไฟล์</div>
      <div class="export-format-grid">
        <div class="export-format-cell ${isPdf ? 'active' : ''}" data-fmt="pdf">PDF</div>
        <div class="export-format-cell ${!isPdf ? 'active' : ''}" data-fmt="jpg">JPG</div>
        <div class="export-format-cell" data-fmt="png">PNG</div>
        <div class="export-format-cell" data-fmt="webp">WEBP</div>
      </div>
      <div class="hint-text" id="export-hint">
        ${isPdf ? 'สร้างไฟล์ PDF ใหม่พร้อมลายน้ำ คงจำนวนหน้า ขนาดกระดาษ และคุณภาพเดิม' : 'ประมวลผลและใส่ลายน้ำทั้งหมดในเบราว์เซอร์ ไม่มีการส่งไฟล์ออกไปเซิร์ฟเวอร์'}
      </div>
      <div id="export-progress-wrap" style="display:none">
        <div class="hint-text" id="export-progress-label">กำลังประมวลผล...</div>
        <div class="progress-bar-outer"><div class="progress-bar-inner" id="export-progress-bar"></div></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="export-cancel">ยกเลิก</button>
        <button class="btn btn-primary" id="export-go">ส่งออก</button>
      </div>
    `);

    let fmt = isPdf ? 'pdf' : 'jpg';
    box.querySelectorAll('.export-format-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        box.querySelectorAll('.export-format-cell').forEach(c => c.classList.remove('active'));
        cell.classList.add('active');
        fmt = cell.dataset.fmt;
        box.querySelector('#export-hint').textContent = fmt === 'pdf'
          ? 'สร้างไฟล์ PDF ใหม่พร้อมลายน้ำ คงจำนวนหน้า ขนาดกระดาษ และคุณภาพเดิม เปิดได้ปกติด้วย Acrobat, Chrome และ Edge'
          : `ส่งออกเป็นรูปภาพ .${fmt} ความละเอียดสูง${state.document.pages.length > 1 ? ' (รวมเป็นไฟล์ ZIP)' : ''}`;
      });
    });

    box.querySelector('#export-cancel').addEventListener('click', closeModal);
    box.querySelector('#export-go').addEventListener('click', async () => {
      const goBtn = box.querySelector('#export-go');
      goBtn.disabled = true;
      box.querySelector('#export-cancel').disabled = true;
      const progWrap = box.querySelector('#export-progress-wrap');
      const progBar = box.querySelector('#export-progress-bar');
      const progLabel = box.querySelector('#export-progress-label');
      progWrap.style.display = 'block';

      const onProgress = (done, total) => {
        const pct = Math.round((done / total) * 100);
        progBar.style.width = pct + '%';
        progLabel.textContent = `กำลังประมวลผล ${done}/${total} หน้า...`;
      };

      try {
        const baseName = (state.document.fileName || 'watermarked').replace(/\.[^/.]+$/, '');
        if (fmt === 'pdf') {
          let bytes;
          if (state.document.type === 'pdf') {
            bytes = await WM.ExportEngine.exportPdf(state, onProgress);
          } else {
            bytes = await WM.ExportEngine.exportImagesAsPdf(state, onProgress);
          }
          U.downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName}_watermarked.pdf`);
        } else {
          const results = await WM.ExportEngine.exportImages(state, fmt, onProgress);
          if (results.length === 1) {
            U.downloadBlob(results[0].blob, results[0].name);
          } else {
            progLabel.textContent = 'กำลังบีบอัดไฟล์ ZIP...';
            const files = [];
            for (const r of results) {
              files.push({ name: r.name, data: new Uint8Array(await r.blob.arrayBuffer()) });
            }
            const zipBytes = U.createZip(files);
            U.downloadBlob(new Blob([zipBytes], { type: 'application/zip' }), `${baseName}_watermarked.zip`);
          }
        }
        WM.showToast('ส่งออกไฟล์สำเร็จ');
        closeModal();
      } catch (err) {
        console.error(err);
        WM.showToast('เกิดข้อผิดพลาดระหว่างส่งออก: ' + err.message, true);
        goBtn.disabled = false;
        box.querySelector('#export-cancel').disabled = false;
      }
    });
  }

  async function boot() {
    WM.Fonts.init();
    const state = new WM.State();

    const canvasEditor = new WM.CanvasEditor(state, $('fabric-canvas'), $('canvas-wrap'));

    const panels = new WM.Panels(state, canvasEditor, {
      layersPanel: $('layers-panel'),
      propertiesPanel: $('properties-panel'),
    });

    const pageNav = new WM.PageNavigator(state, canvasEditor, {
      zoomIn: $('btn-zoom-in'), zoomOut: $('btn-zoom-out'),
      fitWidth: $('btn-fit-width'), fitPage: $('btn-fit-page'),
      zoomLabel: $('zoom-label'),
      prevPage: $('btn-prev-page'), nextPage: $('btn-next-page'),
      pageIndicator: $('page-indicator'), pageIndicatorGroup: $('page-indicator-group'),
      thumbStrip: $('page-thumb-strip'),
      fullscreenBtn: $('btn-fullscreen'),
      exitFullscreenBtn: $('btn-exit-fullscreen'),
    });

    const toolbar = new WM.Toolbar(state, canvasEditor, {
      addText: $('tool-add-text'), addPattern: $('tool-add-pattern'),
      undo: $('btn-undo'), redo: $('btn-redo'), reset: $('btn-reset'),
      duplicate: $('btn-duplicate'),
      exportTop: $('btn-export'), exportBottom: $('btn-export-2'),
    });

    $('btn-export').addEventListener('click', () => buildExportModal(state));
    $('btn-export-2').addEventListener('click', () => buildExportModal(state));

    // ---- Import wiring ----
    const fileInput = $('file-input');
    $('btn-upload').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
      fileInput.value = '';
    });

    const canvasWrap = $('canvas-wrap');
    WM.DocumentImport.attachDropZone(canvasWrap, (files) => handleFiles(files));
    WM.DocumentImport.attachDropZone($('empty-state'), (files) => handleFiles(files));

    async function handleFiles(fileList) {
      try {
        $('empty-state').querySelector('.empty-title').textContent = 'กำลังนำเข้าไฟล์...';
        await WM.DocumentImport.importFiles(state, fileList, {
          onProgress: (done, total, name) => {
            $('empty-state').querySelector('.empty-title').textContent = `กำลังนำเข้า ${done + 1}/${total}: ${name}`;
          },
        });
        if (WM.DocumentImport.lastWarning) WM.showToast(WM.DocumentImport.lastWarning);
        $('doc-name').textContent = state.document.fileName || '';
        canvasWrap.classList.add('has-doc');
        canvasEditor.clearRasterCache();
        await canvasEditor.loadPage(0);
        pageNav.renderThumbs();
        pageNav.renderPageIndicator();
        pageNav._toggleNavVisibility();
        WM.showToast('นำเข้าไฟล์สำเร็จ');
      } catch (err) {
        console.error(err);
        $('empty-state').querySelector('.empty-title').textContent = 'ลากไฟล์มาวางที่นี่ หรือกดปุ่ม "นำเข้าไฟล์"';
        WM.showToast('นำเข้าไฟล์ไม่สำเร็จ: ' + err.message, true);
      }
    }

    state.on('import-error', (msg) => WM.showToast(msg, true));
    state.on('import-warning', (msg) => WM.showToast(msg));

    // ---- Mobile panel drawers (left tools / right properties) ----
    const leftPanel = $('left-tools');
    const rightPanel = $('right-props');
    const backdrop = $('panel-backdrop');
    function closePanels() {
      leftPanel.classList.remove('open');
      rightPanel.classList.remove('open');
      backdrop.classList.remove('show');
    }
    function openPanel(panel) {
      const isOpen = panel.classList.contains('open');
      closePanels();
      if (!isOpen) {
        panel.classList.add('open');
        backdrop.classList.add('show');
      }
    }
    $('btn-toggle-left').addEventListener('click', () => openPanel(leftPanel));
    $('btn-toggle-right').addEventListener('click', () => openPanel(rightPanel));
    backdrop.addEventListener('click', closePanels);

    const isMobileLayout = () => window.matchMedia('(max-width: 860px)').matches;
    state.on('selection-changed', () => {
      if (isMobileLayout() && state.selectedLayerId) openPanel(rightPanel);
    });
    toolbar.addLayer = (function (orig) {
      return function (type) {
        orig.call(toolbar, type);
        if (isMobileLayout()) openPanel(rightPanel);
      };
    })(toolbar.addLayer);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal(); closePanels();
        if (pageNav.isFullscreen()) pageNav.toggleFullscreen(false);
      }
    });

    window.WM_APP = { state, canvasEditor, panels, pageNav, toolbar };
    console.log('Watermark Editor ready.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
