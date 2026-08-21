/* ============================================================
   Watermark Editor - Font registry
   All fonts support Thai + Latin glyphs. Regular/Bold TTF files
   live in fonts/ (used for on-screen @font-face preview) and are
   also embedded as base64 in data-fonts.js (used to embed a real
   vector font into exported PDFs via pdf-lib + fontkit, since
   fetch()/XHR to local files is blocked under file://).
   ============================================================ */
(function (global) {
  'use strict';
  const WM = global.WM || (global.WM = {});

  const FAMILIES = [
    { id: 'NotoSansThai', label: 'Noto Sans Thai', cssFamily: 'WM-NotoSansThai', regularKey: 'NotoSansThai_Regular', boldKey: 'NotoSansThai_Bold', regularFile: 'fonts/NotoSansThai-Regular.ttf', boldFile: 'fonts/NotoSansThai-Bold.ttf' },
    { id: 'Sarabun', label: 'Sarabun', cssFamily: 'WM-Sarabun', regularKey: 'Sarabun_Regular', boldKey: 'Sarabun_Bold', regularFile: 'fonts/Sarabun-Regular.ttf', boldFile: 'fonts/Sarabun-Bold.ttf' },
    { id: 'Kanit', label: 'Kanit', cssFamily: 'WM-Kanit', regularKey: 'Kanit_Regular', boldKey: 'Kanit_Bold', regularFile: 'fonts/Kanit-Regular.ttf', boldFile: 'fonts/Kanit-Bold.ttf' },
    { id: 'Prompt', label: 'Prompt', cssFamily: 'WM-Prompt', regularKey: 'Prompt_Regular', boldKey: 'Prompt_Bold', regularFile: 'fonts/Prompt-Regular.ttf', boldFile: 'fonts/Prompt-Bold.ttf' },
  ];

  function injectFontFaces() {
    let css = '';
    FAMILIES.forEach(f => {
      css += `
@font-face { font-family: '${f.cssFamily}'; src: url('${f.regularFile}') format('truetype'); font-weight: 400; font-style: normal; font-display: swap; }
@font-face { font-family: '${f.cssFamily}'; src: url('${f.boldFile}') format('truetype'); font-weight: 700; font-style: normal; font-display: swap; }
`;
    });
    const style = document.createElement('style');
    style.setAttribute('data-wm-fonts', '1');
    style.textContent = css;
    document.head.appendChild(style);
  }

  const embedCache = {}; // key: familyId+bold -> Promise<PDFFont>

  const Fonts = {
    list: FAMILIES,
    byId(id) { return FAMILIES.find(f => f.id === id) || FAMILIES[0]; },
    init() { injectFontFaces(); },
    cssFamily(id) { return this.byId(id).cssFamily; },

    getFontBytes(familyId, bold) {
      const fam = this.byId(familyId);
      const key = bold ? fam.boldKey : fam.regularKey;
      const b64 = global.WM_FONTS_B64 && global.WM_FONTS_B64[key];
      if (!b64) throw new Error('Font data missing for ' + key);
      return WM.Utils.b64ToBytes(b64);
    },

    // Embeds (and caches) a pdf-lib PDFFont for the given family/weight into the given pdfDoc.
    // Cache is per pdfDoc instance since a PDFFont is bound to its document.
    async embedFont(pdfDoc, familyId, bold) {
      if (!pdfDoc.__wmFontCache) pdfDoc.__wmFontCache = {};
      const key = familyId + (bold ? '_b' : '_r');
      if (pdfDoc.__wmFontCache[key]) return pdfDoc.__wmFontCache[key];
      const bytes = this.getFontBytes(familyId, bold);
      const font = await pdfDoc.embedFont(bytes, { subset: true });
      pdfDoc.__wmFontCache[key] = font;
      return font;
    },
  };

  WM.Fonts = Fonts;
})(window);
