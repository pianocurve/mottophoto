/**
 * mottophoto (もっとフォト) - Main Application Controller
 */

class MottoPhotoApp {
  constructor() {
    this.slides = []; // Array of slide objects
    this.bgmAudio = document.getElementById('bgmAudioElement');
    this.bgmLoaded = false;
    this.draggedIndex = null;
    this.savedPhotoEdits = {}; // Cached photo edits keyed by filename
    this.savedSlideOrder = []; // Cached slide order by filename

    // Sub-systems
    this.slideshow = new SlideshowEngine(this);
    this.editor = new SlideEditor(this);
    this.exporter = new VideoExporter(this);

    // Elements
    this.folderInput = document.getElementById('folderInput');
    this.filesInput = document.getElementById('filesInput');
    this.bgmInput = document.getElementById('bgmInput');
    this.slidesStrip = document.getElementById('slidesStrip');
    this.emptyOverlay = document.getElementById('emptyOverlay');
    this.btnExportMp4 = document.getElementById('btnExportMp4');

    this.initEvents();
    this.initInspectorTabs();
    this.loadSettingsFromLocalStorage();
    this.renderSequencer();
    this.slideshow.recalculateTimeline();
  }

  initEvents() {
    // Top Bar Folder / BGM Buttons
    document.getElementById('btnOpenFolder').addEventListener('click', () => this.folderInput.click());
    document.getElementById('btnSelectBgm').addEventListener('click', () => this.bgmInput.click());
    document.getElementById('btnEmptySelectFolder').addEventListener('click', () => this.folderInput.click());
    document.getElementById('btnEmptySelectFiles').addEventListener('click', () => this.filesInput.click());
    const btnSample = document.getElementById('btnEmptySample');
    if (btnSample) {
      btnSample.addEventListener('click', () => this.loadSamplePhotos());
    }
    document.getElementById('btnAddMorePhotos').addEventListener('click', () => this.filesInput.click());
    document.getElementById('btnChangeBgm').addEventListener('click', () => this.bgmInput.click());
    const btnRemoveBgm = document.getElementById('btnRemoveBgm');
    if (btnRemoveBgm) {
      btnRemoveBgm.addEventListener('click', () => this.removeBgm());
    }

    // File Input Handlers
    this.folderInput.addEventListener('change', (e) => this.handleImageFiles(e.target.files));
    this.filesInput.addEventListener('change', (e) => this.handleImageFiles(e.target.files));
    this.bgmInput.addEventListener('change', (e) => this.handleBgmFile(e.target.files[0]));

    // Export Button
    this.btnExportMp4.addEventListener('click', () => this.exporter.startExport());

    // Drag & Drop on Viewport & Document
    const viewport = document.getElementById('viewport');
    ['dragenter', 'dragover'].forEach(eventName => {
      viewport.addEventListener(eventName, (e) => {
        e.preventDefault();
        viewport.style.borderColor = 'var(--accent-primary)';
      });
      document.body.addEventListener(eventName, (e) => e.preventDefault());
    });

    ['dragleave', 'drop'].forEach(eventName => {
      viewport.addEventListener(eventName, (e) => {
        e.preventDefault();
        viewport.style.borderColor = '';
      });
      document.body.addEventListener(eventName, (e) => e.preventDefault());
    });

    viewport.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        this.handleDroppedFiles(files);
      }
    });

    // JSON Config Export & Import
    const btnExportJson = document.getElementById('btnExportJsonConfig');
    if (btnExportJson) {
      btnExportJson.addEventListener('click', () => this.exportSettingsToJson());
    }

    const btnImportJson = document.getElementById('btnImportJsonConfig');
    const jsonConfigInput = document.getElementById('jsonConfigInput');
    if (btnImportJson && jsonConfigInput) {
      btnImportJson.addEventListener('click', () => jsonConfigInput.click());
      jsonConfigInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.importSettingsFromJson(e.target.files[0]);
          jsonConfigInput.value = '';
        }
      });
    }

    // Inspector Inputs Change Listeners
    const titleInputs = [
      'inputMainTitle', 'inputSubTitle', 'inputDateText', 'selectTitleBg',
      'inputFinTitle', 'inputFinSub', 'selectFinBg', 'selectEffectMotion', 'selectPhotoBg', 'checkShowCaption'
    ];
    titleInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const evt = el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(evt, () => {
          this.slideshow.requestRenderCurrent();
          this.updateSpecialSlidePreviews();
          this.saveSettingsToLocalStorage();
        });
      }
    });

    // Timing slider events
    const rangeTitle = document.getElementById('rangeTitleDuration');
    const rangeFin = document.getElementById('rangeFinDuration');
    rangeTitle.addEventListener('input', (e) => {
      document.getElementById('titleDurationLabel').textContent = `${parseFloat(e.target.value).toFixed(1)} 秒`;
      this.slideshow.recalculateTimeline();
      this.saveSettingsToLocalStorage();
    });
    rangeFin.addEventListener('input', (e) => {
      document.getElementById('finDurationLabel').textContent = `${parseFloat(e.target.value).toFixed(1)} 秒`;
      this.slideshow.recalculateTimeline();
      this.saveSettingsToLocalStorage();
    });

    // Sequencer action buttons
    document.getElementById('btnSortNameAsc').addEventListener('click', () => this.sortSlidesByName());
    document.getElementById('btnSortReverse').addEventListener('click', () => this.reverseSlides());
    document.getElementById('btnClearAllSlides').addEventListener('click', () => this.clearAllSlides());

    // Volume & Mute
    const volSlider = document.getElementById('volumeSlider');
    const btnMute = document.getElementById('btnMuteToggle');
    volSlider.addEventListener('input', (e) => {
      const vol = parseFloat(e.target.value);
      this.bgmAudio.volume = vol;
      btnMute.textContent = vol === 0 ? '🔇' : (vol < 0.5 ? '🔉' : '🔊');
    });
    btnMute.addEventListener('click', () => {
      this.bgmAudio.muted = !this.bgmAudio.muted;
      btnMute.textContent = this.bgmAudio.muted ? '🔇' : '🔊';
    });
  }

  initInspectorTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const targetPanel = document.getElementById(btn.dataset.tab);
        if (targetPanel) targetPanel.classList.add('active');
      });
    });
  }

  async handleImageFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    const validFiles = Array.from(fileList).filter(file => {
      return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);
    });

    if (validFiles.length === 0) {
      alert('画像ファイルが見つかりませんでした。');
      return;
    }

    // Natural alphabetical sort
    validFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    const loadedSlideObjects = await Promise.all(
      validFiles.map(file => this.createSlideFromFile(file))
    );

    // If saved slide order is present, arrange newly loaded files accordingly
    if (this.savedSlideOrder && this.savedSlideOrder.length > 0) {
      const orderMap = new Map();
      this.savedSlideOrder.forEach((name, idx) => orderMap.set(name, idx));
      loadedSlideObjects.sort((a, b) => {
        const orderA = orderMap.has(a.name) ? orderMap.get(a.name) : 999999;
        const orderB = orderMap.has(b.name) ? orderMap.get(b.name) : 999999;
        if (orderA === orderB) {
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        }
        return orderA - orderB;
      });
    }

    this.slides.push(...loadedSlideObjects);
    this.onSlidesUpdated();
  }

  async handleDroppedFiles(fileList) {
    const imageFiles = [];
    let audioFile = null;

    for (const file of fileList) {
      if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)) {
        imageFiles.push(file);
      } else if (file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg)$/i.test(file.name)) {
        if (!audioFile) audioFile = file;
      }
    }

    if (audioFile) {
      this.handleBgmFile(audioFile);
    }
    if (imageFiles.length > 0) {
      await this.handleImageFiles(imageFiles);
    }
  }

  createSlideFromFile(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const savedEdit = this.savedPhotoEdits?.[file.name];
        const defaultFit = (document.getElementById('selectEffectMotion')?.value || 'crossfade-only') === 'crossfade-only' ? 'contain' : 'cover';
        resolve({
          id: 'slide_' + Math.random().toString(36).substr(2, 9),
          file: file,
          name: file.name,
          url: url,
          img: img,
          brightness: savedEdit?.brightness ?? 100,
          zoom: savedEdit?.zoom ?? 100,
          panX: savedEdit?.panX ?? 0,
          panY: savedEdit?.panY ?? 0,
          fit: savedEdit?.fit ?? defaultFit
        });
      };
      img.src = url;
    });
  }

  handleBgmFile(file) {
    if (!file) return;

    if (this.bgmUrl) {
      URL.revokeObjectURL(this.bgmUrl);
    }
    this.bgmUrl = URL.createObjectURL(file);
    this.bgmAudio.src = this.bgmUrl;
    this.bgmAudio.load();

    const onAudioReady = () => {
      if (this.bgmAudio.duration && !isNaN(this.bgmAudio.duration) && isFinite(this.bgmAudio.duration)) {
        this.bgmLoaded = true;
        const nameEl = document.getElementById('audioFileName');
        if (nameEl) nameEl.textContent = file.name;
        const badgeEl = document.getElementById('audioDurationBadge');
        if (badgeEl) badgeEl.textContent = this.slideshow.formatTime(this.bgmAudio.duration);
        const btnRemove = document.getElementById('btnRemoveBgm');
        if (btnRemove) btnRemove.style.display = 'inline-flex';
        this.slideshow.recalculateTimeline();
      }
    };

    this.bgmAudio.onloadedmetadata = onAudioReady;
    this.bgmAudio.ondurationchange = onAudioReady;
    this.bgmAudio.oncanplay = onAudioReady;
    this.bgmAudio.onloadeddata = onAudioReady;

    if (this.bgmAudio.readyState >= 1 && this.bgmAudio.duration && !isNaN(this.bgmAudio.duration)) {
      onAudioReady();
    }
  }

  removeBgm() {
    this.bgmAudio.pause();
    if (this.bgmUrl) {
      URL.revokeObjectURL(this.bgmUrl);
      this.bgmUrl = null;
    }
    this.bgmAudio.removeAttribute('src');
    this.bgmAudio.load();
    this.bgmLoaded = false;
    document.getElementById('audioFileName').textContent = 'BGM未設定';
    document.getElementById('audioDurationBadge').textContent = '--:--';
    const btnRemove = document.getElementById('btnRemoveBgm');
    if (btnRemove) btnRemove.style.display = 'none';
    this.bgmInput.value = '';
    this.slideshow.recalculateTimeline();
  }

  updateAllDurationBadges() {
    if (!this.slideshow || !this.slideshow.timeline) return;
    const timeline = this.slideshow.timeline;

    // 1. Title slide duration badge
    const titleItem = timeline.find(t => t.type === 'title');
    const titleCard = document.querySelector('.special-title');
    if (titleItem && titleCard) {
      const durEl = titleCard.querySelector('.slide-item-duration');
      if (durEl) durEl.textContent = `${titleItem.duration.toFixed(1)}s`;
    }

    // 2. Photo slide cards duration badges
    timeline.filter(t => t.type === 'photo').forEach(item => {
      const card = document.querySelector(`.slide-item[data-index="${item.photoIndex}"]`);
      if (card) {
        const durEl = card.querySelector('.slide-item-duration');
        if (durEl) durEl.textContent = `${item.duration.toFixed(1)}s`;
      }
    });

    // 3. Fin slide duration badge
    const finItem = timeline.find(t => t.type === 'fin');
    const finCard = document.querySelector('.special-fin');
    if (finItem && finCard) {
      const durEl = finCard.querySelector('.slide-item-duration');
      if (durEl) durEl.textContent = `${finItem.duration.toFixed(1)}s`;
    }
  }

  onSlidesUpdated() {
    this.emptyOverlay.classList.toggle('hidden', this.slides.length > 0);
    this.btnExportMp4.disabled = this.slides.length === 0;

    this.renderSequencer();
    this.slideshow.recalculateTimeline();
    this.slideshow.requestRenderCurrent();
    this.saveSettingsToLocalStorage();
  }

  renderSequencer() {
    const strip = this.slidesStrip;
    strip.innerHTML = '';

    // 1. Title Slide Card (Special)
    const titleCard = this.createSpecialCard('title', '🎬 1枚目：タイトル', '思い出のフォトアルバム', () => {
      this.switchTab('tab-title-fin');
      this.slideshow.seek(0);
    });
    strip.appendChild(titleCard);

    // 2. Photo Slides Cards
    this.slides.forEach((slide, index) => {
      const card = this.createSlideCard(slide, index);
      strip.appendChild(card);
    });

    // 3. Fin Slide Card (Special)
    const finCard = this.createSpecialCard('fin', '🏁 最終：Fin', 'Fin', () => {
      this.switchTab('tab-title-fin');
      const finItem = this.slideshow.timeline.find(t => t.type === 'fin');
      if (finItem) this.slideshow.seek(finItem.startTime);
    });
    strip.appendChild(finCard);

    // 4. Add More Card
    const addCard = document.createElement('div');
    addCard.className = 'add-slide-card';
    addCard.id = 'btnAddMorePhotos';
    addCard.innerHTML = `<span class="add-icon">➕</span><span>写真を追加</span>`;
    addCard.onclick = () => this.filesInput.click();
    strip.appendChild(addCard);
  }

  createSlideCard(slide, index) {
    const card = document.createElement('div');
    card.className = 'slide-item';
    card.dataset.index = index;
    card.draggable = true;

    // Timeline item duration badge
    const duration = this.slideshow.timeline[index + 1]?.duration ?? 3.5;

    card.innerHTML = `
      <div class="slide-thumb-wrap">
        <img class="slide-thumb" id="thumb_${slide.id}" src="${slide.url}" alt="${slide.name}">
        <span class="slide-item-index">#${index + 1}</span>
        <span class="slide-item-duration">${duration.toFixed(1)}s</span>
      </div>
      <div class="slide-footer">
        <span class="slide-name" title="${slide.name}">${slide.name}</span>
        <div class="slide-actions-btns">
          <button class="btn-slide-action" data-action="prev" title="左へ移動">◀</button>
          <button class="btn-slide-action" data-action="edit" title="画像編集 (明るさ/大きさ/トリム)">✎</button>
          <button class="btn-slide-action" data-action="next" title="右へ移動">▶</button>
          <button class="btn-slide-action delete" data-action="delete" title="削除">✕</button>
        </div>
      </div>
    `;

    // Click to seek to this slide
    card.querySelector('.slide-thumb-wrap').addEventListener('click', () => {
      const item = this.slideshow.timeline.find(t => t.photoIndex === index);
      if (item) this.slideshow.seek(item.startTime);
    });

    // Action button listeners
    card.querySelector('[data-action="prev"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.moveSlide(index, -1);
    });

    card.querySelector('[data-action="next"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.moveSlide(index, 1);
    });

    card.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.editor.open(index);
    });

    card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.removeSlide(index);
    });

    // Drag & Drop Reordering
    card.addEventListener('dragstart', (e) => {
      this.draggedIndex = index;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.slide-item').forEach(c => c.classList.remove('drag-over'));
      this.draggedIndex = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (this.draggedIndex !== null && this.draggedIndex !== index) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      if (this.draggedIndex !== null && this.draggedIndex !== index) {
        this.reorderSlide(this.draggedIndex, index);
      }
    });

    return card;
  }

  createSpecialCard(type, title, subtitle, onClick) {
    const card = document.createElement('div');
    card.className = `slide-item special-slide special-${type}`;
    const duration = parseFloat(document.getElementById(type === 'title' ? 'rangeTitleDuration' : 'rangeFinDuration').value) || 5.0;

    card.innerHTML = `
      <div class="slide-thumb-wrap">
        <div class="slide-thumb">
          <div class="special-title-text" id="special_card_${type}_title">${subtitle}</div>
          <div class="special-sub-text">${type === 'title' ? 'Title Slide' : 'Ending Slide'}</div>
        </div>
        <span class="slide-item-index">${type === 'title' ? 'START' : 'END'}</span>
        <span class="slide-item-duration">${duration.toFixed(1)}s</span>
      </div>
      <div class="slide-footer">
        <span class="slide-name">${title}</span>
        <button class="btn-slide-action" title="設定画面を開く">⚙️</button>
      </div>
    `;

    card.addEventListener('click', onClick);
    return card;
  }

  updateSpecialSlidePreviews() {
    const titleText = document.getElementById('inputMainTitle').value || '思い出のフォトアルバム';
    const finText = document.getElementById('inputFinTitle').value || 'Fin';
    const tEl = document.getElementById('special_card_title_title');
    const fEl = document.getElementById('special_card_fin_title');
    if (tEl) tEl.textContent = titleText;
    if (fEl) fEl.textContent = finText;
  }

  updateSlideThumbnail(index) {
    const slide = this.slides[index];
    if (!slide) return;
    const thumbImg = document.getElementById(`thumb_${slide.id}`);
    if (thumbImg) {
      thumbImg.style.filter = `brightness(${slide.brightness}%)`;
    }
  }

  highlightActiveSlideItem(currentItem) {
    if (!currentItem) return;

    let targetCard = null;
    if (currentItem.type === 'title') {
      targetCard = document.querySelector('.special-title');
    } else if (currentItem.type === 'fin') {
      targetCard = document.querySelector('.special-fin');
    } else if (currentItem.type === 'photo') {
      targetCard = document.querySelector(`.slide-item[data-index="${currentItem.photoIndex}"]`);
    }

    if (!targetCard) return;

    // Only update when current active slide actually changes (prevents 60fps continuous lock)
    if (!targetCard.classList.contains('active')) {
      document.querySelectorAll('.slide-item').forEach(el => el.classList.remove('active'));
      targetCard.classList.add('active');
      this.scrollCardIntoStripView(targetCard);
    }
  }

  scrollCardIntoStripView(card) {
    const container = document.querySelector('.slides-strip-container');
    if (!container || !card) return;

    const containerRect = container.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();

    // Check horizontal visibility within the strip container only (never scroll the window)
    const isLeftOfContainer = cardRect.left < containerRect.left;
    const isRightOfContainer = cardRect.right > containerRect.right;

    if (isLeftOfContainer) {
      container.scrollTo({
        left: container.scrollLeft + (cardRect.left - containerRect.left) - 20,
        behavior: 'smooth'
      });
    } else if (isRightOfContainer) {
      container.scrollTo({
        left: container.scrollLeft + (cardRect.right - containerRect.right) + 20,
        behavior: 'smooth'
      });
    }
  }

  moveSlide(index, offset) {
    const target = index + offset;
    if (target < 0 || target >= this.slides.length) return;
    const [moved] = this.slides.splice(index, 1);
    this.slides.splice(target, 0, moved);
    this.onSlidesUpdated();
  }

  reorderSlide(fromIndex, toIndex) {
    const [moved] = this.slides.splice(fromIndex, 1);
    this.slides.splice(toIndex, 0, moved);
    this.onSlidesUpdated();
  }

  removeSlide(index) {
    if (index >= 0 && index < this.slides.length) {
      this.slides.splice(index, 1);
      this.onSlidesUpdated();
    }
  }

  clearAllSlides() {
    if (this.slides.length === 0) return;
    if (confirm('読み込んだ写真をすべて削除しますか？')) {
      this.slides = [];
      this.onSlidesUpdated();
    }
  }

  sortSlidesByName() {
    this.slides.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    this.onSlidesUpdated();
  }

  reverseSlides() {
    this.slides.reverse();
    this.onSlidesUpdated();
  }

  async loadSamplePhotos() {
    const samples = [
      { name: '01_青空と山脈.jpg', c1: '#0284c7', c2: '#0369a1', title: 'Mountain Vista', icon: '🏔️' },
      { name: '02_夕暮れの海辺.jpg', c1: '#ea580c', c2: '#be185d', title: 'Sunset Coast', icon: '🌅' },
      { name: '03_エメラルドの森.jpg', c1: '#059669', c2: '#047857', title: 'Emerald Forest', icon: '🌲' },
      { name: '04_満天の星空.jpg', c1: '#1e1b4b', c2: '#4338ca', title: 'Starry Night', icon: '✨' },
      { name: '05_桜の並木道.jpg', c1: '#f43f5e', c2: '#fb7185', title: 'Sakura Avenue', icon: '🌸' }
    ];

    const generatedSlides = [];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const cv = document.createElement('canvas');
      cv.width = 1920;
      cv.height = 1080;
      const ctx = cv.getContext('2d');

      // Draw artistic landscape gradient
      const grad = ctx.createLinearGradient(0, 0, 0, 1080);
      grad.addColorStop(0, s.c1);
      grad.addColorStop(0.7, s.c2);
      grad.addColorStop(1, '#090d16');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1920, 1080);

      // Draw subtle sun/moon glow
      const radial = ctx.createRadialGradient(960, 400, 50, 960, 400, 600);
      radial.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
      radial.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, 1920, 1080);

      // Icon & text
      ctx.font = '120px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.icon, 960, 460);

      ctx.font = 'bold 54px -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 20;
      ctx.fillText(s.title, 960, 620);

      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.95));
      const file = new File([blob], s.name, { type: 'image/jpeg' });
      const slideObj = await this.createSlideFromFile(file);
      generatedSlides.push(slideObj);
    }

    this.slides.push(...generatedSlides);
    this.onSlidesUpdated();
  }

  switchTab(tabId) {
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (btn) btn.click();
  }

  getSettingsObject() {
    const motionMode = document.getElementById('selectEffectMotion')?.value ?? 'crossfade-only';
    const defaultFit = motionMode === 'crossfade-only' ? 'contain' : 'cover';

    // 変更（明るさ・ズーム・トリム・フィット）があった画像のみをファイル名キーで抽出して保存
    const photoEdits = {};
    if (this.slides && this.slides.length > 0) {
      this.slides.forEach(s => {
        if (!s.name) return;
        const brightness = s.brightness ?? 100;
        const zoom = s.zoom ?? 100;
        const panX = s.panX ?? 0;
        const panY = s.panY ?? 0;
        const fit = s.fit ?? defaultFit;

        // デフォルト（初期値）から変更されているか判定
        const isModified = (
          brightness !== 100 ||
          zoom !== 100 ||
          panX !== 0 ||
          panY !== 0 ||
          fit !== defaultFit
        );

        if (isModified) {
          photoEdits[s.name] = {
            brightness,
            zoom,
            panX,
            panY,
            fit
          };
        }
      });
    } else if (this.savedPhotoEdits) {
      Object.assign(photoEdits, this.savedPhotoEdits);
    }

    const slideOrder = this.slides && this.slides.length > 0
      ? this.slides.map(s => s.name)
      : (this.savedSlideOrder || []);

    return {
      version: '1.2',
      savedAt: new Date().toISOString(),
      mainTitle: document.getElementById('inputMainTitle')?.value ?? '思い出のフォトアルバム',
      subTitle: document.getElementById('inputSubTitle')?.value ?? '',
      dateText: document.getElementById('inputDateText')?.value ?? '',
      titleBg: document.getElementById('selectTitleBg')?.value ?? 'gradient-dark',
      finTitle: document.getElementById('inputFinTitle')?.value ?? 'Fin',
      finSub: document.getElementById('inputFinSub')?.value ?? '',
      finBg: document.getElementById('selectFinBg')?.value ?? 'gradient-dark',
      titleDuration: parseFloat(document.getElementById('rangeTitleDuration')?.value) || 5.0,
      finDuration: parseFloat(document.getElementById('rangeFinDuration')?.value) || 5.0,
      effectMotion: document.getElementById('selectEffectMotion')?.value ?? 'crossfade-only',
      photoBg: document.getElementById('selectPhotoBg')?.value ?? 'black',
      showCaption: document.getElementById('checkShowCaption')?.checked ?? true,
      bgmFileName: this.bgmLoaded ? (document.getElementById('audioFileName')?.textContent || '') : '',
      slideOrder: slideOrder,
      photoEdits: photoEdits
    };
  }

  applySettings(settings, saveToStorage = true) {
    if (!settings || typeof settings !== 'object') return;

    if (settings.mainTitle !== undefined) {
      const el = document.getElementById('inputMainTitle');
      if (el) el.value = settings.mainTitle;
    }
    if (settings.subTitle !== undefined) {
      const el = document.getElementById('inputSubTitle');
      if (el) el.value = settings.subTitle;
    }
    if (settings.dateText !== undefined) {
      const el = document.getElementById('inputDateText');
      if (el) el.value = settings.dateText;
    }
    if (settings.titleBg !== undefined) {
      const el = document.getElementById('selectTitleBg');
      if (el) el.value = settings.titleBg;
    }
    if (settings.finTitle !== undefined) {
      const el = document.getElementById('inputFinTitle');
      if (el) el.value = settings.finTitle;
    }
    if (settings.finSub !== undefined) {
      const el = document.getElementById('inputFinSub');
      if (el) el.value = settings.finSub;
    }
    if (settings.finBg !== undefined) {
      const el = document.getElementById('selectFinBg');
      if (el) el.value = settings.finBg;
    }

    if (settings.titleDuration !== undefined) {
      const el = document.getElementById('rangeTitleDuration');
      if (el) {
        el.value = settings.titleDuration;
        document.getElementById('titleDurationLabel').textContent = `${parseFloat(settings.titleDuration).toFixed(1)} 秒`;
      }
    }
    if (settings.finDuration !== undefined) {
      const el = document.getElementById('rangeFinDuration');
      if (el) {
        el.value = settings.finDuration;
        document.getElementById('finDurationLabel').textContent = `${parseFloat(settings.finDuration).toFixed(1)} 秒`;
      }
    }
    if (settings.effectMotion !== undefined) {
      const el = document.getElementById('selectEffectMotion');
      if (el) el.value = settings.effectMotion;
    }
    if (settings.photoBg !== undefined) {
      const el = document.getElementById('selectPhotoBg');
      if (el) el.value = settings.photoBg;
    }
    if (settings.showCaption !== undefined) {
      const el = document.getElementById('checkShowCaption');
      if (el) el.checked = Boolean(settings.showCaption);
    }

    // Cache photo edits & order
    if (settings.photoEdits && typeof settings.photoEdits === 'object') {
      this.savedPhotoEdits = { ...(this.savedPhotoEdits || {}), ...settings.photoEdits };
    }
    if (Array.isArray(settings.slideOrder)) {
      this.savedSlideOrder = settings.slideOrder;
    }

    // If slides are currently loaded in memory, apply edits and reorder immediately
    if (this.slides && this.slides.length > 0) {
      if (this.savedPhotoEdits) {
        this.slides.forEach(slide => {
          const edit = this.savedPhotoEdits[slide.name];
          if (edit) {
            if (edit.brightness !== undefined) slide.brightness = edit.brightness;
            if (edit.zoom !== undefined) slide.zoom = edit.zoom;
            if (edit.panX !== undefined) slide.panX = edit.panX;
            if (edit.panY !== undefined) slide.panY = edit.panY;
            if (edit.fit !== undefined) slide.fit = edit.fit;
          }
        });
      }

      if (this.savedSlideOrder && this.savedSlideOrder.length > 0) {
        const orderMap = new Map();
        this.savedSlideOrder.forEach((name, idx) => orderMap.set(name, idx));
        this.slides.sort((a, b) => {
          const orderA = orderMap.has(a.name) ? orderMap.get(a.name) : 999999;
          const orderB = orderMap.has(b.name) ? orderMap.get(b.name) : 999999;
          return orderA - orderB;
        });
      }

      this.renderSequencer();
      this.slides.forEach((_, idx) => this.updateSlideThumbnail(idx));
    }

    this.updateSpecialSlidePreviews();
    this.slideshow.recalculateTimeline();
    this.slideshow.requestRenderCurrent();

    if (saveToStorage) {
      this.saveSettingsToLocalStorage();
    }
  }

  saveSettingsToLocalStorage() {
    try {
      const settings = this.getSettingsObject();
      this.savedPhotoEdits = settings.photoEdits;
      this.savedSlideOrder = settings.slideOrder;
      localStorage.setItem('mottophoto_project_settings', JSON.stringify(settings));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
  }

  loadSettingsFromLocalStorage() {
    try {
      const saved = localStorage.getItem('mottophoto_project_settings');
      if (saved) {
        const settings = JSON.parse(saved);
        this.applySettings(settings, false);
      }
    } catch (e) {
      console.warn('LocalStorage load failed:', e);
    }
  }

  exportSettingsToJson() {
    const settings = this.getSettingsObject();
    const jsonStr = JSON.stringify(settings, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.download = `mottophoto_settings_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  importSettingsFromJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const settings = JSON.parse(e.target.result);
        this.applySettings(settings, true);
        const editCount = settings.photoEdits ? Object.keys(settings.photoEdits).length : 0;
        let msg = '設定ファイルを正常に読み込みました！';
        if (editCount > 0) {
          msg += `\n（変更のあった画像 ${editCount}枚 の個別パラメータを適用・保持しました）`;
        }
        if (settings.bgmFileName) {
          msg += `\n※設定されていたBGM: ${settings.bgmFileName}`;
        }
        alert(msg);
      } catch (err) {
        alert('設定ファイルの読み込みに失敗しました: ' + err.message);
      }
    };
    reader.readAsText(file);
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new MottoPhotoApp();
});
