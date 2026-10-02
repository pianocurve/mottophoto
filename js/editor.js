/**
 * mottophoto - Slide Image Editor
 * Allows adjusting brightness, zoom/scale, and pan/trim with interactive dragging
 * Ensures the 16:9 crop area NEVER overflows the original image boundaries.
 */

class SlideEditor {
  constructor(app) {
    this.app = app;
    this.currentSlideIndex = -1;
    this.originalState = null;
    this.tempState = null;

    // Elements
    this.modal = document.getElementById('editorModal');
    this.canvas = document.getElementById('editorCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.titleEl = document.getElementById('editorSlideTitle');

    // Controls
    this.brightnessSlider = document.getElementById('editorBrightnessSlider');
    this.brightnessVal = document.getElementById('editorBrightnessVal');
    this.zoomSlider = document.getElementById('editorZoomSlider');
    this.zoomVal = document.getElementById('editorZoomVal');
    this.panXSlider = document.getElementById('editorPanXSlider');
    this.panXVal = document.getElementById('editorPanXVal');
    this.panYSlider = document.getElementById('editorPanYSlider');
    this.panYVal = document.getElementById('editorPanYVal');

    this.btnFitCover = document.getElementById('btnFitCover');
    this.btnFitContain = document.getElementById('btnFitContain');
    this.btnReset = document.getElementById('btnResetEditorValues');

    this.btnPrev = document.getElementById('btnEditorPrevSlide');
    this.btnNext = document.getElementById('btnEditorNextSlide');
    this.btnApply = document.getElementById('btnEditorApply');
    this.btnCancel = document.getElementById('btnEditorCancel');
    this.btnClose = document.getElementById('btnCloseEditorModal');

    // Drag to pan state
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.panStartX = 0;
    this.panStartY = 0;

    // Cached rendered image layout for mouse interaction
    this.currentImgLayout = null;

    this.initEvents();
  }

  /**
   * Calculate 16:9 crop rectangle (cropX, cropY, cropW, cropH) strictly within original image bounds.
   * Guaranteed never to overflow outside the image boundaries.
   */
  static getCropRect(img, zoom = 100, panX = 0, panY = 0, fit = 'cover') {
    const imgW = img.width || 1920;
    const imgH = img.height || 1080;
    const imgRatio = imgW / imgH;
    const targetRatio = 16 / 9;

    // 最小ズームは100%（元画像の内側に最大で収まる16:9枠）。100%未満（縮小による余白発生）を防止
    const safeZoom = Math.max(100, Math.min(300, zoom || 100));
    const scale = safeZoom / 100;

    let baseCropW, baseCropH;
    if (imgRatio >= targetRatio) {
      // 横長画像：高さ100%が最大基準
      baseCropH = imgH;
      baseCropW = imgH * targetRatio;
    } else {
      // 縦長画像：幅100%が最大基準
      baseCropW = imgW;
      baseCropH = imgW / targetRatio;
    }

    // 拡大（ズーム）するほど切り抜く矩形サイズは小さくなる
    const cropW = baseCropW / scale;
    const cropH = baseCropH / scale;

    // 元画像の境界内にとどまるための最大移動許容量 (px)
    const maxOffsetX = Math.max(0, (imgW - cropW) / 2);
    const maxOffsetY = Math.max(0, (imgH - cropH) / 2);

    // panX, panY (-100 ~ +100) を最大移動許容量にスケーリング
    const clampedPanX = Math.max(-100, Math.min(100, panX || 0));
    const clampedPanY = Math.max(-100, Math.min(100, panY || 0));

    const offsetX = (clampedPanX / 100) * maxOffsetX;
    const offsetY = (clampedPanY / 100) * maxOffsetY;

    let cropX = (imgW - cropW) / 2 + offsetX;
    let cropY = (imgH - cropH) / 2 + offsetY;

    // 元画像の境界線から絶対にはみ出さないよう厳密クランプ
    cropX = Math.max(0, Math.min(imgW - cropW, cropX));
    cropY = Math.max(0, Math.min(imgH - cropH, cropY));

    return {
      cropX,
      cropY,
      cropW,
      cropH,
      maxOffsetX,
      maxOffsetY
    };
  }

  initEvents() {
    // Sliders
    this.brightnessSlider.addEventListener('input', (e) => {
      this.tempState.brightness = parseInt(e.target.value, 10);
      this.brightnessVal.textContent = `${this.tempState.brightness}%`;
      this.render();
    });

    this.zoomSlider.addEventListener('input', (e) => {
      this.tempState.zoom = Math.max(100, parseInt(e.target.value, 10));
      this.zoomVal.textContent = `${this.tempState.zoom}%`;
      this.render();
    });

    this.panXSlider.addEventListener('input', (e) => {
      this.tempState.panX = parseInt(e.target.value, 10);
      this.panXVal.textContent = `${this.tempState.panX}%`;
      this.render();
    });

    this.panYSlider.addEventListener('input', (e) => {
      this.tempState.panY = parseInt(e.target.value, 10);
      this.panYVal.textContent = `${this.tempState.panY}%`;
      this.render();
    });

    // Fit mode
    this.btnFitCover.addEventListener('click', () => {
      this.tempState.fit = 'cover';
      this.btnFitCover.classList.add('active');
      this.btnFitContain.classList.remove('active');
      this.render();
    });

    this.btnFitContain.addEventListener('click', () => {
      this.tempState.fit = 'contain';
      this.btnFitContain.classList.add('active');
      this.btnFitCover.classList.remove('active');
      this.render();
    });

    // Reset button
    this.btnReset.addEventListener('click', () => {
      this.tempState.brightness = 100;
      this.tempState.zoom = 100;
      this.tempState.panX = 0;
      this.tempState.panY = 0;
      const motionMode = document.getElementById('selectEffectMotion')?.value || 'crossfade-only';
      this.tempState.fit = motionMode === 'crossfade-only' ? 'contain' : 'cover';
      this.updateControlUI();
      this.render();
    });

    // Drag on Canvas to Pan Crop Window
    this.canvas.addEventListener('mousedown', (e) => this.onDragStart(e));
    window.addEventListener('mousemove', (e) => this.onDragMove(e));
    window.addEventListener('mouseup', () => this.onDragEnd());

    // Mouse wheel to zoom (scale crop window)
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });

    // Navigation buttons inside modal
    this.btnPrev.addEventListener('click', () => this.navigate(-1));
    this.btnNext.addEventListener('click', () => this.navigate(1));

    // Save & Close
    this.btnApply.addEventListener('click', () => this.applyAndClose());
    this.btnCancel.addEventListener('click', () => this.close());
    this.btnClose.addEventListener('click', () => this.close());

    // Close on backdrop click
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  open(slideIndex) {
    if (slideIndex < 0 || slideIndex >= this.app.slides.length) return;
    this.currentSlideIndex = slideIndex;
    const slide = this.app.slides[slideIndex];

    const motionMode = document.getElementById('selectEffectMotion')?.value || 'crossfade-only';
    const defaultFit = motionMode === 'crossfade-only' ? 'contain' : 'cover';

    // Backup original state (zoom ensures at least 100%)
    this.originalState = {
      brightness: slide.brightness ?? 100,
      zoom: Math.max(100, slide.zoom ?? 100),
      fit: slide.fit ?? defaultFit,
      panX: slide.panX ?? 0,
      panY: slide.panY ?? 0
    };

    // Current working state
    this.tempState = { ...this.originalState };

    this.updateControlUI();
    this.titleEl.textContent = `写真 #${slideIndex + 1} のトリミング＆画像編集 (${slide.name})`;

    this.btnPrev.disabled = slideIndex === 0;
    this.btnNext.disabled = slideIndex === this.app.slides.length - 1;

    this.modal.classList.add('open');
    this.render();
  }

  updateControlUI() {
    this.brightnessSlider.value = this.tempState.brightness;
    this.brightnessVal.textContent = `${this.tempState.brightness}%`;

    this.zoomSlider.value = this.tempState.zoom;
    this.zoomVal.textContent = `${this.tempState.zoom}%`;

    this.panXSlider.value = this.tempState.panX;
    this.panXVal.textContent = `${this.tempState.panX}%`;

    this.panYSlider.value = this.tempState.panY;
    this.panYVal.textContent = `${this.tempState.panY}%`;

    if (this.tempState.fit === 'cover') {
      this.btnFitCover.classList.add('active');
      this.btnFitContain.classList.remove('active');
    } else {
      this.btnFitCover.classList.remove('active');
      this.btnFitContain.classList.add('active');
    }
  }

  render() {
    if (this.currentSlideIndex < 0) return;
    const slide = this.app.slides[this.currentSlideIndex];
    if (!slide || !slide.img) return;

    const ctx = this.ctx;
    const cw = this.canvas.width;  // 960 (16:9)
    const ch = this.canvas.height; // 540 (16:9)

    // Clear background
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0a0d14';
    ctx.fillRect(0, 0, cw, ch);

    const img = slide.img;
    const imgW = img.width;
    const imgH = img.height;
    const imgRatio = imgW / imgH;

    const fit = this.tempState.fit || 'cover';

    if (fit === 'cover') {
      // 1. 元画像の全体をキャンバス内に収めて表示 (周囲にパディング 28px)
      const pad = 28;
      const availW = cw - pad * 2;
      const availH = ch - pad * 2;

      let imgDrawW, imgDrawH;
      if (imgRatio > availW / availH) {
        imgDrawW = availW;
        imgDrawH = availW / imgRatio;
      } else {
        imgDrawH = availH;
        imgDrawW = availH * imgRatio;
      }
      const imgDrawX = (cw - imgDrawW) / 2;
      const imgDrawY = (ch - imgDrawH) / 2;

      this.currentImgLayout = {
        imgDrawX,
        imgDrawY,
        imgDrawW,
        imgDrawH,
        imgW,
        imgH
      };

      // 元画像を描画 (明るさフィルタ適用)
      ctx.save();
      ctx.filter = `brightness(${this.tempState.brightness}%)`;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 6;
      ctx.drawImage(img, imgDrawX, imgDrawY, imgDrawW, imgDrawH);
      ctx.restore();

      // 元画像の輪郭線 (写真本来の外枠境界)
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(imgDrawX, imgDrawY, imgDrawW, imgDrawH);

      // 元画像の情報バッジ (左上)
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(imgDrawX + 6, imgDrawY + 6, 120, 22);
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`元画像: ${imgW}×${imgH}px`, imgDrawX + 12, imgDrawY + 17);
      ctx.restore();

      // 2. 厳密な 16:9 トリム矩形を計算 (元画像の外側へは絶対にはみ出さない)
      const crop = SlideEditor.getCropRect(img, this.tempState.zoom, this.tempState.panX, this.tempState.panY, 'cover');

      // キャンバス上の表示座標へ変換
      const scaleRatio = imgDrawW / imgW;
      const boxX = imgDrawX + crop.cropX * scaleRatio;
      const boxY = imgDrawY + crop.cropY * scaleRatio;
      const boxW = crop.cropW * scaleRatio;
      const boxH = crop.cropH * scaleRatio;

      // 3. トリム枠の外側（元画像のうち切り抜かれない部分）を暗転マスク
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';

      // 上側の暗転マスク
      if (boxY > imgDrawY) {
        ctx.fillRect(imgDrawX, imgDrawY, imgDrawW, boxY - imgDrawY);
      }
      // 下側の暗転マスク
      if (boxY + boxH < imgDrawY + imgDrawH) {
        ctx.fillRect(imgDrawX, boxY + boxH, imgDrawW, (imgDrawY + imgDrawH) - (boxY + boxH));
      }
      // 左側の暗転マスク
      if (boxX > imgDrawX) {
        ctx.fillRect(imgDrawX, boxY, boxX - imgDrawX, boxH);
      }
      // 右側の暗転マスク
      if (boxX + boxW < imgDrawX + imgDrawW) {
        ctx.fillRect(boxX + boxW, boxY, (imgDrawX + imgDrawW) - (boxX + boxW), boxH);
      }
      ctx.restore();

      // 4. 16:9 トリム枠（境界線、ガイド、四隅ハンドル）
      ctx.save();
      // 外枠線
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(99, 102, 241, 0.5)';
      ctx.shadowBlur = 10;
      ctx.strokeRect(boxX, boxY, boxW, boxH);
      ctx.shadowBlur = 0;

      // 三分割ルール線（構図ガイド）
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      // 縦2本
      ctx.moveTo(boxX + boxW / 3, boxY);
      ctx.lineTo(boxX + boxW / 3, boxY + boxH);
      ctx.moveTo(boxX + (boxW * 2) / 3, boxY);
      ctx.lineTo(boxX + (boxW * 2) / 3, boxY + boxH);
      // 横2本
      ctx.moveTo(boxX, boxY + boxH / 3);
      ctx.lineTo(boxX + boxW, boxY + boxH / 3);
      ctx.moveTo(boxX, boxY + (boxH * 2) / 3);
      ctx.lineTo(boxX + boxW, boxY + (boxH * 2) / 3);
      ctx.stroke();
      ctx.setLineDash([]);

      // 四隅の L字 ハンドル
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.5;
      const hLen = Math.max(12, Math.min(24, Math.min(boxW, boxH) * 0.18));
      // 左上
      ctx.beginPath();
      ctx.moveTo(boxX, boxY + hLen);
      ctx.lineTo(boxX, boxY);
      ctx.lineTo(boxX + hLen, boxY);
      ctx.stroke();
      // 右上
      ctx.beginPath();
      ctx.moveTo(boxX + boxW - hLen, boxY);
      ctx.lineTo(boxX + boxW, boxY);
      ctx.lineTo(boxX + boxW, boxY + hLen);
      ctx.stroke();
      // 左下
      ctx.beginPath();
      ctx.moveTo(boxX, boxY + boxH - hLen);
      ctx.lineTo(boxX, boxY + boxH);
      ctx.lineTo(boxX + hLen, boxY + boxH);
      ctx.stroke();
      // 右下
      ctx.beginPath();
      ctx.moveTo(boxX + boxW - hLen, boxY + boxH);
      ctx.lineTo(boxX + boxW, boxY + boxH);
      ctx.lineTo(boxX + boxW, boxY + boxH - hLen);
      ctx.stroke();

      // トリム枠バッジ
      const badgeY = boxY > 26 ? boxY - 24 : boxY + 6;
      ctx.fillStyle = '#6366f1';
      ctx.fillRect(boxX, badgeY, 114, 20);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 11px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('16:9 出力トリム枠', boxX + 57, badgeY + 10);

      ctx.restore();

      const badgeEl = document.getElementById('editorFrameBadge');
      if (badgeEl) badgeEl.textContent = '元画像と 16:9 トリム枠';

    } else {
      // 5. 全体表示 (Contain) モード
      this.currentImgLayout = null;
      const photoBg = document.getElementById('selectPhotoBg')?.value || 'black';

      if (photoBg === 'blur') {
        ctx.save();
        ctx.filter = 'blur(24px) brightness(40%)';
        ctx.drawImage(img, -20, -20, cw + 40, ch + 40);
        ctx.restore();
      }

      const paddingRatio = 0.92;
      const availW = cw * paddingRatio;
      const availH = ch * paddingRatio;
      let baseW, baseH;
      if (imgRatio > availW / availH) {
        baseW = availW;
        baseH = availW / imgRatio;
      } else {
        baseH = availH;
        baseW = availH * imgRatio;
      }

      const drawX = (cw - baseW) / 2;
      const drawY = (ch - baseH) / 2;

      ctx.save();
      ctx.filter = `brightness(${this.tempState.brightness}%)`;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 24;
      ctx.drawImage(img, drawX, drawY, baseW, baseH);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.lineWidth = 1;
      ctx.strokeRect(drawX, drawY, baseW, baseH);
      ctx.restore();

      // 16:9 境界ガイド
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.75)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, cw - 2, ch - 2);

      const badgeEl = document.getElementById('editorFrameBadge');
      if (badgeEl) badgeEl.textContent = '全体表示 (余白あり)';
    }
  }

  onDragStart(e) {
    if (!this.modal.classList.contains('open')) return;
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.panStartX = this.tempState.panX;
    this.panStartY = this.tempState.panY;
  }

  onDragMove(e) {
    if (!this.isDragging) return;
    const slide = this.app.slides[this.currentSlideIndex];
    if (!slide || !slide.img) return;

    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;

    if (this.tempState.fit === 'cover' && this.currentImgLayout) {
      const { imgDrawW, imgDrawH, imgW, imgH } = this.currentImgLayout;
      const crop = SlideEditor.getCropRect(slide.img, this.tempState.zoom, this.panStartX, this.panStartY, 'cover');

      // トリム枠をマウスの移動方向に追従（元画像のピクセル系へ換算）
      let newPanX = this.panStartX;
      let newPanY = this.panStartY;

      if (crop.maxOffsetX > 0) {
        // キャンバス上の移動量を元画像の移動可能比率に変換
        const deltaPx = dx * (imgW / imgDrawW);
        const deltaPercent = (deltaPx / crop.maxOffsetX) * 100;
        newPanX = Math.round(this.panStartX + deltaPercent);
        newPanX = Math.max(-100, Math.min(100, newPanX));
      }

      if (crop.maxOffsetY > 0) {
        const deltaPy = dy * (imgH / imgDrawH);
        const deltaPercent = (deltaPy / crop.maxOffsetY) * 100;
        newPanY = Math.round(this.panStartY + deltaPercent);
        newPanY = Math.max(-100, Math.min(100, newPanY));
      }

      this.tempState.panX = newPanX;
      this.tempState.panY = newPanY;

      this.panXSlider.value = newPanX;
      this.panXVal.textContent = `${newPanX}%`;
      this.panYSlider.value = newPanY;
      this.panYVal.textContent = `${newPanY}%`;

      this.render();
    }
  }

  onDragEnd() {
    this.isDragging = false;
  }

  onWheel(e) {
    e.preventDefault();
    if (this.tempState.fit !== 'cover') return;
    const delta = e.deltaY < 0 ? 5 : -5;
    const newZoom = Math.max(100, Math.min(300, this.tempState.zoom + delta));
    if (newZoom !== this.tempState.zoom) {
      this.tempState.zoom = newZoom;
      this.zoomSlider.value = newZoom;
      this.zoomVal.textContent = `${newZoom}%`;
      this.render();
    }
  }

  navigate(direction) {
    this.saveCurrentToSlide();
    const nextIndex = this.currentSlideIndex + direction;
    if (nextIndex >= 0 && nextIndex < this.app.slides.length) {
      this.open(nextIndex);
    }
  }

  saveCurrentToSlide() {
    if (this.currentSlideIndex >= 0 && this.app.slides[this.currentSlideIndex]) {
      const slide = this.app.slides[this.currentSlideIndex];
      slide.brightness = this.tempState.brightness;
      slide.zoom = Math.max(100, this.tempState.zoom);
      slide.fit = this.tempState.fit;
      slide.panX = this.tempState.panX;
      slide.panY = this.tempState.panY;

      // Update thumbnail preview
      this.app.updateSlideThumbnail(this.currentSlideIndex);
      // Redraw current view in main player if active
      this.app.slideshow.requestRenderCurrent();
      // Auto-save settings including this slide's edit parameters
      this.app.saveSettingsToLocalStorage();
    }
  }

  applyAndClose() {
    this.saveCurrentToSlide();
    this.close();
  }

  close() {
    this.modal.classList.remove('open');
    this.currentSlideIndex = -1;
  }
}
