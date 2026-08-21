/* ============================================================
   Watermark Editor - Page navigator
   Thumbnail strip, zoom controls, fit width/page, fullscreen,
   prev/next page.
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});
  const U = WM.Utils;

  function PageNavigator(state, canvasEditor, els) {
    this.state = state;
    this.canvasEditor = canvasEditor;
    this.els = els;

    els.zoomIn.addEventListener('click', () => this._zoomStep(1.15));
    els.zoomOut.addEventListener('click', () => this._zoomStep(1 / 1.15));
    els.fitWidth.addEventListener('click', () => { canvasEditor.setFitMode('fit-width'); this._syncZoomLabel(); });
    els.fitPage.addEventListener('click', () => { canvasEditor.setFitMode('fit-page'); this._syncZoomLabel(); });
    els.prevPage.addEventListener('click', () => this.goTo(state.currentPageIndex - 1));
    els.nextPage.addEventListener('click', () => this.goTo(state.currentPageIndex + 1));
    els.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());

    state.on('document-loaded', () => { this.renderThumbs(); this.renderPageIndicator(); this._toggleNavVisibility(); });
    state.on('layers-changed', () => this.renderThumbBadges());
    state.on('zoom-changed', (z) => this._syncZoomLabel(z));

    this._fullscreen = false;
  }

  PageNavigator.prototype._toggleNavVisibility = function () {
    const total = this.state.document.pages.length;
    this.els.pageIndicatorGroup.style.display = total > 1 ? 'flex' : 'none';
    this.els.thumbStrip.style.display = total > 1 ? 'flex' : 'none';
  };

  PageNavigator.prototype._zoomStep = function (factor) {
    this.canvasEditor.fitMode = 'manual';
    this.canvasEditor.setZoom(this.canvasEditor.zoom * factor);
  };

  PageNavigator.prototype._syncZoomLabel = function () {
    this.els.zoomLabel.textContent = Math.round(this.canvasEditor.zoom * 100) + '%';
  };

  PageNavigator.prototype.goTo = async function (index) {
    const total = this.state.document.pages.length;
    if (index < 0 || index >= total) return;
    await this.canvasEditor.loadPage(index);
    this.renderPageIndicator();
    this.renderThumbs();
    this.state.emit('page-changed');
  };

  PageNavigator.prototype.renderPageIndicator = function () {
    const total = this.state.document.pages.length;
    this.els.pageIndicator.textContent = `${this.state.currentPageIndex + 1} / ${total}`;
    this.els.prevPage.disabled = this.state.currentPageIndex <= 0;
    this.els.nextPage.disabled = this.state.currentPageIndex >= total - 1;
  };

  PageNavigator.prototype.renderThumbs = function () {
    const pages = this.state.document.pages;
    const el = this.els.thumbStrip;
    el.innerHTML = pages.map((p, i) => `
      <div class="thumb-item ${i === this.state.currentPageIndex ? 'active' : ''}" data-index="${i}">
        <img src="${p.thumbnailDataUrl}" alt="page ${i + 1}">
        <span class="thumb-num">${i + 1}</span>
        <span class="thumb-wm-badge" style="display:none">💧</span>
      </div>
    `).join('');
    el.querySelectorAll('.thumb-item').forEach(item => {
      item.addEventListener('click', () => this.goTo(Number(item.dataset.index)));
    });
    this.renderThumbBadges();
  };

  PageNavigator.prototype.renderThumbBadges = function () {
    const pages = this.state.document.pages;
    const el = this.els.thumbStrip;
    pages.forEach((p, i) => {
      const item = el.querySelector(`.thumb-item[data-index="${i}"]`);
      if (!item) return;
      const badge = item.querySelector('.thumb-wm-badge');
      const has = this.state.layersForPage(i).length > 0;
      if (badge) badge.style.display = has ? 'block' : 'none';
    });
  };

  PageNavigator.prototype.toggleFullscreen = function () {
    const appEl = document.getElementById('app');
    this._fullscreen = !this._fullscreen;
    appEl.classList.toggle('fullscreen-mode', this._fullscreen);
    try {
      if (this._fullscreen && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if (!this._fullscreen && document.exitFullscreen && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (e) { /* fullscreen API unavailable/blocked - CSS immersive mode still applies */ }
    setTimeout(() => this.canvasEditor.applyFit(), 60);
  };

  WM.PageNavigator = PageNavigator;
})(window);
