/**
 * mottophoto - Slide Image Editor
 * Maintains the original photo frame (aspect ratio & size) within the 16:9 screen,
 * and allows zooming / trimming strictly INSIDE that photo frame without overflowing.
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

    // Cached frame bounds
    this.currentFrame = null;

    this.initEvents();

    // Auto-fit canvas display size to fill container dynamically
    if (window.ResizeObserver && this.canvas.parentElement) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.modal.classList.contains('open')) {
          this.fitCanvasToContainer();
          this.render();
        }
      });
      this.resizeObserver.observe(this.canvas.parentElement);
    }
    window.addEventListener('resize', () => {
      if (this.modal.classList.contains('open')) {
        this.fitCanvasToContainer();
        this.render();
      }
    });
  }

  /**
   * Dynamically size the canvas element to maximize 16:9 bounds within .editor-canvas-wrap
   */
  fitCanvasToContainer() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const wrapW = wrap.clientWidth;
    const wrapH = wrap.clientHeight;
    if (wrapW <= 0 || wrapH <= 0) return;

    const targetRatio = 16 / 9;
    let targetW, targetH;

    if (wrapW / wrapH > targetRatio) {
      targetH = wrapH;
      targetW = targetH * targetRatio;
    } else {
      targetW = wrapW;
      targetH = targetW / targetRatio;
    }

    this.canvas.style.width = `${Math.floor(targetW)}px`;
    this.canvas.style.height = `${Math.floor(targetH)}px`;
  }

  /**
   * Calculate the fixed photo frame and the inner zoomed/panned draw bounds.
   * - Photo frame (frameX, frameY, frameW, frameH) maintains original aspect ratio and maximum screen size.
   * - Zoom & Pan occur STRICTLY within this frame (clipped to frame bounds).
   */
  static getFrameAndDrawBounds(img, cw, ch, zoom = 100, panX = 0, panY = 0, fit = 'contain') {
    const imgW = img.width || 1920;
    const imgH = img.height || 1080;
    const imgRatio = imgW / imgH;
    const screenRatio = cw / ch;

    let frameX, frameY, frameW, frameH;

    if (fit === 'cover') {
      // 画面全体に枠を取る場合 (16:9 Full Screen Frame)
      frameX = 0;
      frameY = 0;
      frameW = cw;
      frameH = ch;
    } else {
      // 16:9 スクリーン上に元画像本来の比率で画面いっぱいまでフィットする最大枠 (100% full frame)
      if (imgRatio > screenRatio) {
        frameW = cw;
        frameH = cw / imgRatio;
      } else {
        frameH = ch;
        frameW = ch * imgRatio;
      }
      frameX = (cw - frameW) / 2;
      frameY = (ch - frameH) / 2;
    }

    // ズーム（最低100% = 枠ぴったり。100%〜300%で枠の内側をズーム）
    const scale = Math.max(1.0, Math.min(3.0, (zoom || 100) / 100));

    // 枠に対する写真の描画サイズ
    let baseW, baseH;
    if (fit === 'cover') {
      if (imgRatio > screenRatio) {
        baseH = frameH;
        baseW = frameH * imgRatio;
      } else {
        baseW = frameW;
        baseH = frameW / imgRatio;
      }
    } else {
      // contain: 基本サイズは枠サイズと完全に一致
      baseW = frameW;
      baseH = frameH;
    }

    const drawW = baseW * scale;
    const drawH = baseH * scale;

    // 枠の内側で移動できる最大量 (px)
    const maxPanX = Math.max(0, (drawW - frameW) / 2);
    const maxPanY = Math.max(0, (drawH - frameH) / 2);

    const clampedPanX = Math.max(-100, Math.min(100, panX || 0));
    const clampedPanY = Math.max(-100, Math.min(100, panY || 0));

    const offsetPanX = (clampedPanX / 100) * maxPanX;
    const offsetPanY = (clampedPanY / 100) * maxPanY;

    // 描画起点 (枠の中央を基準にオフセット)
    let drawX = frameX + (frameW - drawW) / 2 + offsetPanX;
    let drawY = frameY + (frameH - drawH) / 2 + offsetPanY;

    // 枠の外側に隙間（空白）が出ないようクランプ
    if (drawX > frameX) drawX = frameX;
    if (drawX + drawW < frameX + frameW) drawX = frameX + frameW - drawW;
    if (drawY > frameY) drawY = frameY;
    if (drawY + drawH < frameY + frameH) drawY = frameY + frameH - drawH;

    return {
      frameX,
      frameY,
      frameW,
      frameH,
      drawX,
      drawY,
      drawW,
      drawH,
      maxPanX,
      maxPanY
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

    // Drag on Canvas to Pan within frame
    this.canvas.addEventListener('mousedown', (e) => this.onDragStart(e));
    window.addEventListener('mousemove', (e) => this.onDragMove(e));
    window.addEventListener('mouseup', () => this.onDragEnd());

    // Mouse wheel to zoom inside frame
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

    this.originalState = {
      brightness: slide.brightness ?? 100,
      zoom: Math.max(100, slide.zoom ?? 100),
      fit: slide.fit ?? defaultFit,
      panX: slide.panX ?? 0,
      panY: slide.panY ?? 0
    };

    this.tempState = { ...this.originalState };

    this.updateControlUI();
    this.titleEl.textContent = `写真 #${slideIndex + 1} の枠内ズーム＆トリム (${slide.name})`;

    this.btnPrev.disabled = slideIndex === 0;
    this.btnNext.disabled = slideIndex === this.app.slides.length - 1;

    this.modal.classList.add('open');

    // 次のレンダリングフレームでコンテナの表示サイズに合わせてキャンバスを画面最大化
    requestAnimationFrame(() => {
      this.fitCanvasToContainer();
      this.render();
    });
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

    // Clear 16:9 screen
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#07090e';
    ctx.fillRect(0, 0, cw, ch);

    const img = slide.img;
    const photoBg = document.getElementById('selectPhotoBg')?.value || 'black';
    const fit = this.tempState.fit || 'contain';

    // 背景がブラーの場合、16:9画面全体に背景を描画
    if (fit === 'contain' && photoBg === 'blur') {
      ctx.save();
      ctx.filter = 'blur(24px) brightness(40%)';
      ctx.drawImage(img, -20, -20, cw + 40, ch + 40);
      ctx.restore();
    }

    // 元画像の比率を維持した固定枠と、その内側のズーム描画座標を算出
    const b = SlideEditor.getFrameAndDrawBounds(
      img,
      cw,
      ch,
      this.tempState.zoom,
      this.tempState.panX,
      this.tempState.panY,
      fit
    );
    this.currentFrame = b;

    // 1. 元画像の枠（フレーム）の外側にはみ出さないようクリッピング設定
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.frameX, b.frameY, b.frameW, b.frameH);
    ctx.clip();

    // 2. 枠の内側にズームした写真を描画（明るさフィルタ適用）
    ctx.filter = `brightness(${this.tempState.brightness}%)`;
    ctx.drawImage(img, b.drawX, b.drawY, b.drawW, b.drawH);
    ctx.restore();

    // 3. 元画像の枠線（写真本来の固定枠）を美しく表示
    ctx.save();
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(99, 102, 241, 0.4)';
    ctx.shadowBlur = 12;
    ctx.strokeRect(b.frameX, b.frameY, b.frameW, b.frameH);
    ctx.shadowBlur = 0;

    // 構図三分割線（3x3 ルール）を枠内に薄く表示
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(b.frameX + b.frameW / 3, b.frameY);
    ctx.lineTo(b.frameX + b.frameW / 3, b.frameY + b.frameH);
    ctx.moveTo(b.frameX + (b.frameW * 2) / 3, b.frameY);
    ctx.lineTo(b.frameX + (b.frameW * 2) / 3, b.frameY + b.frameH);
    ctx.moveTo(b.frameX, b.frameY + b.frameH / 3);
    ctx.lineTo(b.frameX + b.frameW, b.frameY + b.frameH / 3);
    ctx.moveTo(b.frameX, b.frameY + (b.frameH * 2) / 3);
    ctx.lineTo(b.frameX + b.frameW, b.frameY + (b.frameH * 2) / 3);
    ctx.stroke();
    ctx.setLineDash([]);

    // 四隅のL字ハンドル
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    const hLen = Math.max(12, Math.min(24, Math.min(b.frameW, b.frameH) * 0.15));
    // 左上
    ctx.beginPath();
    ctx.moveTo(b.frameX, b.frameY + hLen);
    ctx.lineTo(b.frameX, b.frameY);
    ctx.lineTo(b.frameX + hLen, b.frameY);
    ctx.stroke();
    // 右上
    ctx.beginPath();
    ctx.moveTo(b.frameX + b.frameW - hLen, b.frameY);
    ctx.lineTo(b.frameX + b.frameW, b.frameY);
    ctx.lineTo(b.frameX + b.frameW, b.frameY + hLen);
    ctx.stroke();
    // 左下
    ctx.beginPath();
    ctx.moveTo(b.frameX, b.frameY + b.frameH - hLen);
    ctx.lineTo(b.frameX, b.frameY + b.frameH);
    ctx.lineTo(b.frameX + hLen, b.frameY + b.frameH);
    ctx.stroke();
    // 右下
    ctx.beginPath();
    ctx.moveTo(b.frameX + b.frameW - hLen, b.frameY + b.frameH);
    ctx.lineTo(b.frameX + b.frameW, b.frameY + b.frameH);
    ctx.lineTo(b.frameX + b.frameW, b.frameY + b.frameH - hLen);
    ctx.stroke();

    // 枠情報バッジ
    const badgeY = b.frameY > 26 ? b.frameY - 24 : b.frameY + 8;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.fillRect(b.frameX, badgeY, 160, 20);
    ctx.fillStyle = '#c7d2fe';
    ctx.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`元画像枠 (${Math.round(b.frameW)}×${Math.round(b.frameH)})`, b.frameX + 80, badgeY + 10);

    ctx.restore();

    // 16:9 出力境界線
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, cw - 2, ch - 2);

    const badgeEl = document.getElementById('editorFrameBadge');
    if (badgeEl) {
      badgeEl.textContent = fit === 'contain' ? '元画像の枠サイズ維持 (枠内ズーム)' : '全画面枠 (Cover)';
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
    if (!this.isDragging || !this.currentFrame) return;
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;
    const b = this.currentFrame;

    let newPanX = this.panStartX;
    let newPanY = this.panStartY;

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.canvas.height / rect.height : 1;
    const canvasDx = dx * scaleX;
    const canvasDy = dy * scaleY;

    if (b.maxPanX > 0) {
      const deltaPercent = (canvasDx / b.maxPanX) * 100;
      newPanX = Math.round(this.panStartX + deltaPercent);
      newPanX = Math.max(-100, Math.min(100, newPanX));
    }

    if (b.maxPanY > 0) {
      const deltaPercent = (canvasDy / b.maxPanY) * 100;
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

  onDragEnd() {
    this.isDragging = false;
  }

  onWheel(e) {
    e.preventDefault();
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
