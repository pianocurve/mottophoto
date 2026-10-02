/**
 * mottophoto - Slide Image Editor
 * Allows adjusting brightness, zoom/scale, and pan/trim with interactive dragging
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

    this.initEvents();
  }

  initEvents() {
    // Sliders
    this.brightnessSlider.addEventListener('input', (e) => {
      this.tempState.brightness = parseInt(e.target.value, 10);
      this.brightnessVal.textContent = `${this.tempState.brightness}%`;
      this.render();
    });

    this.zoomSlider.addEventListener('input', (e) => {
      this.tempState.zoom = parseInt(e.target.value, 10);
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
      this.tempState.fit = 'cover';
      this.updateControlUI();
      this.render();
    });

    // Drag on Canvas to Pan
    this.canvas.addEventListener('mousedown', (e) => this.onDragStart(e));
    window.addEventListener('mousemove', (e) => this.onDragMove(e));
    window.addEventListener('mouseup', () => this.onDragEnd());

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

    // Backup original state
    this.originalState = {
      brightness: slide.brightness ?? 100,
      zoom: slide.zoom ?? 100,
      fit: slide.fit ?? 'cover',
      panX: slide.panX ?? 0,
      panY: slide.panY ?? 0
    };

    // Current working state
    this.tempState = { ...this.originalState };

    this.updateControlUI();
    this.titleEl.textContent = `写真 #${slideIndex + 1} の画像編集 (${slide.name})`;

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
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // Clear
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0a0a0c';
    ctx.fillRect(0, 0, cw, ch);

    // Apply brightness filter
    ctx.filter = `brightness(${this.tempState.brightness}%)`;

    const img = slide.img;
    const imgRatio = img.width / img.height;
    const canvasRatio = cw / ch;

    let baseW, baseH;
    if (this.tempState.fit === 'cover') {
      if (imgRatio > canvasRatio) {
        baseH = ch;
        baseW = ch * imgRatio;
      } else {
        baseW = cw;
        baseH = cw / imgRatio;
      }
    } else {
      // Contain
      if (imgRatio > canvasRatio) {
        baseW = cw;
        baseH = cw / imgRatio;
      } else {
        baseH = ch;
        baseW = ch * imgRatio;
      }
    }

    // Apply Zoom
    const zoomMultiplier = this.tempState.zoom / 100;
    const finalW = baseW * zoomMultiplier;
    const finalH = baseH * zoomMultiplier;

    // Center + Pan
    const centerX = (cw - finalW) / 2;
    const centerY = (ch - finalH) / 2;

    const panOffsetX = (this.tempState.panX / 100) * (cw / 2);
    const panOffsetY = (this.tempState.panY / 100) * (ch / 2);

    const drawX = centerX + panOffsetX;
    const drawY = centerY + panOffsetY;

    ctx.drawImage(img, drawX, drawY, finalW, finalH);
    ctx.filter = 'none';

    // Draw gentle frame guide
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.strokeRect(1, 1, cw - 2, ch - 2);
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
    const dx = e.clientX - this.dragStartX;
    const dy = e.clientY - this.dragStartY;

    // Sensitivity factor
    const sensitivity = 0.35;
    let newPanX = Math.round(this.panStartX + dx * sensitivity);
    let newPanY = Math.round(this.panStartY + dy * sensitivity);

    newPanX = Math.max(-100, Math.min(100, newPanX));
    newPanY = Math.max(-100, Math.min(100, newPanY));

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

  navigate(direction) {
    // Automatically apply current edits before moving
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
      slide.zoom = this.tempState.zoom;
      slide.fit = this.tempState.fit;
      slide.panX = this.tempState.panX;
      slide.panY = this.tempState.panY;

      // Update thumbnail preview
      this.app.updateSlideThumbnail(this.currentSlideIndex);
      // Redraw current view in main player if active
      this.app.slideshow.requestRenderCurrent();
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
