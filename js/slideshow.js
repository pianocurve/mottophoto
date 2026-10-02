/**
 * mottophoto - Slideshow Engine
 * Handles timeline calculations, smooth crossfade transitions, Ken Burns motion, and Web Audio sync.
 */

class SlideshowEngine {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById('slideshowCanvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    // Internal canvas resolution
    this.width = 1920;
    this.height = 1080;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    // Timeline state
    this.currentTime = 0; // seconds
    this.totalDuration = 0; // seconds
    this.isPlaying = false;
    this.lastFrameTimestamp = null;
    this.animationFrameId = null;

    // Transition settings
    this.crossfadeDuration = 0.8; // seconds

    // Slide items timeline array
    // Each item: { type: 'title'|'photo'|'fin', slideObj?, startTime, duration, endTime, index }
    this.timeline = [];

    // UI elements
    this.progressTrack = document.getElementById('progressTrack');
    this.progressFill = document.getElementById('progressFill');
    this.timeDisplay = document.getElementById('timeDisplay');
    this.btnPlayPause = document.getElementById('btnPlayPause');
    this.playIcon = document.getElementById('playIcon');
    this.currentSlideNumber = document.getElementById('currentSlideNumber');
    this.totalSlideNumber = document.getElementById('totalSlideNumber');
    this.nowPlayingText = document.getElementById('nowPlayingText');

    this.initEvents();
  }

  initEvents() {
    this.btnPlayPause.addEventListener('click', () => this.togglePlay());

    // Scrubber click / drag
    let isScrubbing = false;
    const seekToMouse = (e) => {
      const rect = this.progressTrack.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      this.seek(pos * this.totalDuration);
    };

    this.progressTrack.addEventListener('mousedown', (e) => {
      isScrubbing = true;
      seekToMouse(e);
    });

    window.addEventListener('mousemove', (e) => {
      if (isScrubbing) seekToMouse(e);
    });

    window.addEventListener('mouseup', () => {
      isScrubbing = false;
    });

    // Spacebar to play/pause
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        this.togglePlay();
      }
    });

    // Prev / Next slide buttons
    document.getElementById('btnPrevSlide').addEventListener('click', () => this.jumpSlide(-1));
    document.getElementById('btnNextSlide').addEventListener('click', () => this.jumpSlide(1));
    document.getElementById('btnFullscreen').addEventListener('click', () => this.toggleFullscreen());
  }

  recalculateTimeline() {
    const photoSlides = this.app.slides;
    const N = photoSlides.length;
    const titleDuration = parseFloat(document.getElementById('rangeTitleDuration').value) || 5.0;
    const finDuration = parseFloat(document.getElementById('rangeFinDuration').value) || 5.0;

    let photoDuration = 3.5;
    let bgmDuration = null;

    if (this.app.bgmAudio && this.app.bgmAudio.duration && !isNaN(this.app.bgmAudio.duration) && isFinite(this.app.bgmAudio.duration)) {
      bgmDuration = this.app.bgmAudio.duration;
    }

    if (bgmDuration) {
      this.totalDuration = bgmDuration;
      if (N > 0) {
        // Calculate photo duration so that: titleDuration + N * photoDuration + finDuration = bgmDuration
        const remainingForPhotos = bgmDuration - titleDuration - finDuration;
        photoDuration = Math.max(0.5, remainingForPhotos / N);
      }
    } else {
      photoDuration = 3.5;
      this.totalDuration = titleDuration + (N * photoDuration) + finDuration;
    }

    // Build timeline items
    this.timeline = [];
    let currentT = 0;

    // 1. Title Slide
    this.timeline.push({
      type: 'title',
      startTime: currentT,
      duration: titleDuration,
      endTime: currentT + titleDuration,
      index: 0
    });
    currentT += titleDuration;

    // 2. Photo Slides
    photoSlides.forEach((slide, idx) => {
      this.timeline.push({
        type: 'photo',
        slideObj: slide,
        photoIndex: idx,
        startTime: currentT,
        duration: photoDuration,
        endTime: currentT + photoDuration,
        index: idx + 1
      });
      currentT += photoDuration;
    });

    // 3. Fin Slide
    this.timeline.push({
      type: 'fin',
      startTime: currentT,
      duration: finDuration,
      endTime: currentT + finDuration,
      index: N + 1
    });

    // Update UI Indicators
    const photoDurLabel = document.getElementById('photoDurationLabel');
    if (photoDurLabel) photoDurLabel.textContent = `${photoDuration.toFixed(1)} 秒`;

    const timingBreakdown = document.getElementById('timingBreakdownText');
    if (timingBreakdown) {
      if (bgmDuration) {
        timingBreakdown.textContent = `BGM長さ(${this.formatTime(bgmDuration)}) に合わせ自動配分`;
      } else {
        timingBreakdown.textContent = `写真各 ${photoDuration.toFixed(1)} 秒 (BGM設定で自動計算)`;
      }
    }

    this.updateStats();
    this.updateProgressUI();
    if (this.app.updateAllDurationBadges) {
      this.app.updateAllDurationBadges();
    }
    this.requestRenderCurrent();
  }

  updateStats() {
    const totalCount = this.app.slides ? this.app.slides.length : 0;
    const statPhotoCount = document.getElementById('statPhotoCount');
    if (statPhotoCount) statPhotoCount.textContent = `${totalCount}枚`;

    const statBgmDuration = document.getElementById('statBgmDuration');
    if (statBgmDuration) {
      if (this.app.bgmAudio && this.app.bgmAudio.duration && !isNaN(this.app.bgmAudio.duration) && isFinite(this.app.bgmAudio.duration)) {
        statBgmDuration.textContent = this.formatTime(this.app.bgmAudio.duration);
      } else {
        statBgmDuration.textContent = '未設定';
      }
    }

    const statTotalDuration = document.getElementById('statTotalDuration');
    if (statTotalDuration) {
      statTotalDuration.textContent = this.formatTime(this.totalDuration);
    }

    if (this.totalSlideNumber) {
      this.totalSlideNumber.textContent = `${this.timeline.length}スライド`;
    }
  }

  togglePlay() {
    if (this.timeline.length === 0) return;

    if (this.isPlaying) {
      this.pause();
    } else {
      // If at end, loop to beginning
      if (this.currentTime >= this.totalDuration - 0.1) {
        this.currentTime = 0;
      }
      this.play();
    }
  }

  play() {
    this.isPlaying = true;
    this.playIcon.textContent = '⏸';
    this.lastFrameTimestamp = performance.now();

    // Sync Audio
    if (this.app.bgmAudio && this.app.bgmLoaded) {
      this.app.bgmAudio.currentTime = this.currentTime;
      this.app.bgmAudio.play().catch(e => console.log('Audio autoplay policy:', e));
    }

    this.tick();
  }

  pause() {
    this.isPlaying = false;
    this.playIcon.textContent = '▶';
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.app.bgmAudio) {
      this.app.bgmAudio.pause();
    }
  }

  seek(timeInSeconds) {
    this.currentTime = Math.max(0, Math.min(this.totalDuration, timeInSeconds));
    if (this.app.bgmAudio && this.app.bgmLoaded) {
      this.app.bgmAudio.currentTime = this.currentTime;
    }
    this.updateProgressUI();
    this.requestRenderCurrent();
  }

  jumpSlide(direction) {
    if (this.timeline.length === 0) return;
    const currentItem = this.getCurrentTimelineItem(this.currentTime);
    if (!currentItem) return;

    const nextIndex = Math.max(0, Math.min(this.timeline.length - 1, currentItem.index + direction));
    const targetItem = this.timeline[nextIndex];
    if (targetItem) {
      this.seek(targetItem.startTime);
    }
  }

  tick() {
    if (!this.isPlaying) return;

    const now = performance.now();
    const delta = (now - this.lastFrameTimestamp) / 1000;
    this.lastFrameTimestamp = now;

    // Use audio time if audio is active and synchronized
    if (this.app.bgmAudio && this.app.bgmLoaded && !this.app.bgmAudio.paused) {
      this.currentTime = this.app.bgmAudio.currentTime;
    } else {
      this.currentTime += delta;
    }

    if (this.currentTime >= this.totalDuration) {
      this.currentTime = this.totalDuration;
      this.pause();
      this.updateProgressUI();
      this.renderAtTime(this.currentTime);
      return;
    }

    this.updateProgressUI();
    this.renderAtTime(this.currentTime);

    this.animationFrameId = requestAnimationFrame(() => this.tick());
  }

  updateProgressUI() {
    const percent = this.totalDuration > 0 ? (this.currentTime / this.totalDuration) * 100 : 0;
    this.progressFill.style.width = `${percent}%`;
    this.timeDisplay.textContent = `${this.formatTime(this.currentTime)} / ${this.formatTime(this.totalDuration)}`;

    const currentItem = this.getCurrentTimelineItem(this.currentTime);
    if (currentItem) {
      this.currentSlideNumber.textContent = `${currentItem.index + 1}`;
      if (currentItem.type === 'title') {
        this.nowPlayingText.textContent = 'タイトル表示中';
      } else if (currentItem.type === 'fin') {
        this.nowPlayingText.textContent = 'Fin表示中';
      } else {
        this.nowPlayingText.textContent = `写真 #${currentItem.photoIndex + 1} (${currentItem.slideObj.name})`;
      }
      this.app.highlightActiveSlideItem(currentItem);
    }
  }

  getCurrentTimelineItem(time) {
    for (let i = 0; i < this.timeline.length; i++) {
      const item = this.timeline[i];
      if (time >= item.startTime && time < item.endTime) {
        return item;
      }
    }
    return this.timeline[this.timeline.length - 1] || null;
  }

  requestRenderCurrent() {
    this.renderAtTime(this.currentTime);
  }

  renderAtTime(time) {
    if (this.timeline.length === 0) return;

    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    // Determine current item and whether we are crossfading to next
    let currentItem = null;
    let nextItem = null;
    let crossfadeRatio = 0; // 0 to 1

    for (let i = 0; i < this.timeline.length; i++) {
      const item = this.timeline[i];
      if (time >= item.startTime && time < item.endTime) {
        currentItem = item;
        const timeFromEnd = item.endTime - time;
        const actualCrossfade = Math.min(this.crossfadeDuration, item.duration * 0.4);

        if (timeFromEnd < actualCrossfade && i + 1 < this.timeline.length) {
          nextItem = this.timeline[i + 1];
          crossfadeRatio = 1 - (timeFromEnd / actualCrossfade);
        }
        break;
      }
    }

    if (!currentItem) {
      currentItem = this.timeline[this.timeline.length - 1];
    }

    // Clear background (pure black)
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);

    // Draw current slide
    ctx.save();
    this.drawSlideItem(ctx, currentItem, time);
    ctx.restore();

    // If crossfading, draw next slide with alpha blend
    if (nextItem && crossfadeRatio > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, crossfadeRatio));
      // Pass the actual current time so nextItem's Ken Burns motion is already smoothly running during crossfade
      this.drawSlideItem(ctx, nextItem, time);
      ctx.restore();
    }
  }

  drawSlideItem(ctx, item, time) {
    if (!item) return;

    if (item.type === 'title') {
      this.drawTitleSlide(ctx, item, time);
    } else if (item.type === 'fin') {
      this.drawFinSlide(ctx, item, time);
    } else if (item.type === 'photo') {
      this.drawPhotoSlide(ctx, item, time);
    }
  }

  drawTitleSlide(ctx, item, time) {
    const w = this.width;
    const h = this.height;
    const progress = Math.max(0, Math.min(1, (time - item.startTime) / item.duration));

    const mainTitleEl = document.getElementById('inputMainTitle');
    const mainTitle = mainTitleEl ? mainTitleEl.value : '';
    const subTitle = document.getElementById('inputSubTitle')?.value ?? '';
    const dateText = document.getElementById('inputDateText')?.value ?? '';
    const bgStyle = document.getElementById('selectTitleBg')?.value ?? 'gradient-dark';

    // Draw Background
    this.drawBackgroundStyle(ctx, bgStyle, this.app.slides[0]);

    // Vignette
    this.drawVignette(ctx);

    // Gentle motion zoom for title (1.0 -> 1.04)
    const scale = 1.0 + progress * 0.04;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);

    // Fade in text over first 1.2 seconds
    const textAlpha = Math.min(1, (time - item.startTime) / 1.0);
    ctx.globalAlpha = textAlpha;

    // Main Title (明朝・セリフ体)
    if (mainTitle) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 24;
      ctx.shadowOffsetY = 4;
      ctx.font = '700 78px "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", Georgia, serif';
      ctx.fillText(mainTitle, w / 2, h / 2 - 40);
    }

    // Subtitle (明朝・セリフ体)
    if (subTitle) {
      ctx.font = '500 36px "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", Georgia, serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.shadowBlur = 16;
      ctx.fillText(subTitle, w / 2, h / 2 + 45);
    }

    // Date (白文字・明朝体)
    if (dateText) {
      ctx.font = '500 24px "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", Georgia, serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.shadowBlur = 12;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.fillText(dateText, w / 2, h / 2 + 110);
    }

    ctx.restore();
  }

  drawFinSlide(ctx, item, time) {
    const w = this.width;
    const h = this.height;

    const finTitleEl = document.getElementById('inputFinTitle');
    const finTitle = finTitleEl ? finTitleEl.value : '';
    const finSub = document.getElementById('inputFinSub')?.value ?? '';
    const bgStyle = document.getElementById('selectFinBg')?.value ?? 'gradient-dark';

    const lastSlide = this.app.slides.length > 0 ? this.app.slides[this.app.slides.length - 1] : null;
    this.drawBackgroundStyle(ctx, bgStyle, lastSlide);
    this.drawVignette(ctx);

    // Compute animation window including the crossfade-in period
    const prevFade = item.index > 0 ? Math.min(this.crossfadeDuration, this.timeline[item.index - 1].duration * 0.4) : 0;
    const totalAnimTime = item.duration + prevFade;
    const elapsed = time - (item.startTime - prevFade);
    const progress = Math.max(0, Math.min(1, elapsed / Math.max(0.1, totalAnimTime)));

    const scale = 1.0 + progress * 0.04;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(scale, scale);
    ctx.translate(-w / 2, -h / 2);

    // Fade in text as the slide fades in
    const textAlpha = Math.min(1, Math.max(0, elapsed / (prevFade + 0.6)));
    ctx.globalAlpha = textAlpha;

    if (finTitle) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 28;
      ctx.shadowOffsetY = 4;
      ctx.font = 'italic 700 90px "Georgia", "Hiragino Mincho ProN", "Yu Mincho", serif';
      ctx.fillText(finTitle, w / 2, h / 2 - 25);
    }

    if (finSub) {
      ctx.font = '400 30px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif';
      ctx.fillStyle = '#cbd5e1';
      ctx.shadowBlur = 14;
      ctx.fillText(finSub, w / 2, h / 2 + 65);
    }

    ctx.restore();
  }

  drawPhotoSlide(ctx, item, time) {
    const slide = item.slideObj;
    if (!slide || !slide.img) return;

    const w = this.width;
    const h = this.height;
    const cw = w;
    const ch = h;

    // Seamless Ken Burns motion:
    // The animation begins the moment the previous slide starts fading into this slide (item.startTime - prevFade)
    // and continues seamlessly through the slide's active duration until it fully fades out at item.endTime.
    const prevFade = item.index > 0 ? Math.min(this.crossfadeDuration, this.timeline[item.index - 1].duration * 0.4) : 0;
    const totalAnimTime = item.duration + prevFade;
    const elapsed = time - (item.startTime - prevFade);
    const progress = Math.max(0, Math.min(1, elapsed / Math.max(0.1, totalAnimTime)));

    const motionMode = document.getElementById('selectEffectMotion')?.value ?? 'crossfade-only';
    const photoBg = document.getElementById('selectPhotoBg')?.value ?? 'black';

    // Filters (Brightness & Contrast)
    const brightness = slide.brightness ?? 100;
    const contrast = slide.contrast ?? 100;
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;

    const img = slide.img;
    const imgRatio = img.width / img.height;
    const canvasRatio = cw / ch;

    const fit = slide.fit ?? (motionMode === 'crossfade-only' ? 'contain' : 'cover');

    if (fit === 'contain' && photoBg === 'blur') {
      this.drawContainBackdrop(ctx, img, cw, ch);
    }

    const b = SlideEditor.getFrameAndDrawBounds(
      img,
      cw,
      ch,
      slide.zoom,
      slide.panX,
      slide.panY,
      fit,
      slide.cropRatio || 'original'
    );

    let dX = b.drawX;
    let dY = b.drawY;
    let dW = b.drawW;
    let dH = b.drawH;

    if (motionMode === 'kenburns') {
      const mode = item.photoIndex % 4;
      let mScale = 1.0;
      let mDx = 0;
      let mDy = 0;
      if (mode === 0) {
        mScale = 1.0 + progress * 0.05;
        mDx = (progress - 0.5) * (dW * 0.02);
      } else if (mode === 1) {
        mScale = 1.05 - progress * 0.05;
        mDx = (0.5 - progress) * (dW * 0.02);
      } else if (mode === 2) {
        mScale = 1.0 + progress * 0.04;
        mDy = (progress - 0.5) * (dH * 0.02);
      } else {
        mScale = 1.04 - progress * 0.04;
        mDy = (0.5 - progress) * (dH * 0.02);
      }

      const animW = dW * mScale;
      const animH = dH * mScale;
      let animX = dX + (dW - animW) / 2 + mDx;
      let animY = dY + (dH - animH) / 2 + mDy;

      // 枠内に隙間ができないようクランプ
      if (animX > b.frameX) animX = b.frameX;
      if (animX + animW < b.frameX + b.frameW) animX = b.frameX + b.frameW - animW;
      if (animY > b.frameY) animY = b.frameY;
      if (animY + animH < b.frameY + b.frameH) animY = b.frameY + b.frameH - animH;

      dX = animX;
      dY = animY;
      dW = animW;
      dH = animH;
    }

    ctx.save();
    // 写真の固定枠でクリッピング（枠の外側へは絶対にはみ出さない）
    ctx.beginPath();
    ctx.rect(b.frameX, b.frameY, b.frameW, b.frameH);
    ctx.clip();

    ctx.drawImage(img, dX, dY, dW, dH);
    ctx.filter = 'none';

    // ホワイトバランス（色温度・色かぶり補正）のブレンド
    SlideEditor.applyColorGrading(ctx, b, slide.temperature ?? 0, slide.tint ?? 0);

    ctx.restore();

    // 枠のスタイリング（ブラー背景またはContain時の上品な枠線）
    if (fit === 'contain') {
      ctx.save();
      if (photoBg === 'blur') {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.frameX, b.frameY, b.frameW, b.frameH);
      }
      ctx.restore();
    }
    ctx.filter = 'none';

    // ファイル名から最初の '_' までのキャプションを取得し、白抜き文字でさりげなく描画
    const showCaption = document.getElementById('checkShowCaption')?.checked !== false;
    if (showCaption) {
      const caption = this.getCaptionFromFileName(slide.name);
      if (caption) {
        this.drawPhotoCaption(ctx, caption, b.frameX, b.frameY, b.frameW, b.frameH, motionMode, cw, ch);
      }
    }

    // Cinematic vignette
    this.drawVignette(ctx);
  }

  getCaptionFromFileName(fileName) {
    if (!fileName || typeof fileName !== 'string') return '';
    const underscoreIndex = fileName.indexOf('_');
    if (underscoreIndex <= 0) return '';
    return fileName.slice(0, underscoreIndex).trim();
  }

  drawPhotoCaption(ctx, caption, drawX, drawY, finalW, finalH, motionMode, cw, ch) {
    ctx.save();

    let capX, capY;
    if (motionMode === 'crossfade-only') {
      // 写真枠の内側左下
      capX = Math.max(30, drawX + 32);
      capY = Math.min(ch - 30, drawY + finalH - 28);
    } else {
      // ケン・バーンズ（全画面）時：画面左下にシネマ風に配置
      capX = 70;
      capY = ch - 65;
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';

    // さりげない白抜き文字（セリフ体・明朝、文字の周囲にやわらかな影をつけて可読性を確保）
    ctx.font = '500 32px "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", Georgia, serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;

    ctx.fillText(caption, capX, capY);
    ctx.restore();
  }

  drawContainBackdrop(ctx, img, cw, ch) {
    ctx.save();
    ctx.filter = 'blur(30px) brightness(40%)';
    ctx.drawImage(img, -20, -20, cw + 40, ch + 40);
    ctx.restore();
  }

  drawBackgroundStyle(ctx, style, fallbackSlide) {
    const w = this.width;
    const h = this.height;

    if (style.includes('blur') && fallbackSlide && fallbackSlide.img) {
      ctx.save();
      ctx.filter = 'blur(40px) brightness(45%) saturate(1.2)';
      ctx.drawImage(fallbackSlide.img, -40, -40, w + 80, h + 80);
      ctx.restore();
      return;
    }

    let gradient;
    if (style === 'gradient-violet') {
      gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#1e1b4b');
      gradient.addColorStop(0.5, '#2e1065');
      gradient.addColorStop(1, '#0f172a');
    } else if (style === 'gradient-sunset') {
      gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#431407');
      gradient.addColorStop(0.5, '#701a75');
      gradient.addColorStop(1, '#0f172a');
    } else if (style === 'gradient-ocean') {
      gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#082f49');
      gradient.addColorStop(0.5, '#1e1b4b');
      gradient.addColorStop(1, '#020617');
    } else {
      // gradient-dark
      gradient = ctx.createRadialGradient(w / 2, h / 2, 100, w / 2, h / 2, w / 1.2);
      gradient.addColorStop(0, '#1e293b');
      gradient.addColorStop(1, '#07090e');
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  drawVignette(ctx) {
    const w = this.width;
    const h = this.height;
    const radGrad = ctx.createRadialGradient(w / 2, h / 2, w * 0.35, w / 2, h / 2, w * 0.75);
    radGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    radGrad.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, w, h);
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  toggleFullscreen() {
    const viewport = document.getElementById('viewport');
    if (!document.fullscreenElement) {
      viewport.requestFullscreen().catch(err => console.log(err));
    } else {
      document.exitFullscreen().catch(err => console.log(err));
    }
  }
}
