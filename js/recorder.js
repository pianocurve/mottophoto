/**
 * mottophoto - Video Export Engine
 * Records canvas stream + Web Audio BGM into an MP4 video file using MediaRecorder.
 */

class VideoExporter {
  constructor(app) {
    this.app = app;
    this.modal = document.getElementById('exportModal');
    this.percentEl = document.getElementById('exportPercent');
    this.progressFill = document.getElementById('exportProgressFill');
    this.statusLabel = document.getElementById('exportStatusLabel');
    this.btnCancel = document.getElementById('btnCancelExport');
    this.btnDownload = document.getElementById('btnDownloadExportedMp4');
    this.btnClose = document.getElementById('btnCloseExportModal');
    this.videoPreview = document.getElementById('exportVideoPreview');

    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isExporting = false;
    this.exportBlob = null;
    this.exportUrl = null;
    this.cancelRequested = false;

    this.initEvents();
  }

  initEvents() {
    this.btnCancel.addEventListener('click', () => this.cancelExport());
    this.btnDownload.addEventListener('click', () => this.triggerDownload());
    this.btnClose.addEventListener('click', () => this.closeModal());
  }

  async startExport() {
    if (this.app.slides.length === 0) {
      alert('写真が1枚も読み込まれていません。');
      return;
    }

    const slideshow = this.app.slideshow;
    slideshow.pause();

    this.isExporting = true;
    this.cancelRequested = false;
    this.recordedChunks = [];
    this.exportBlob = null;

    if (this.exportUrl) {
      URL.revokeObjectURL(this.exportUrl);
      this.exportUrl = null;
    }

    // Reset UI
    this.percentEl.textContent = '0%';
    this.progressFill.style.width = '0%';
    this.statusLabel.textContent = '録画の準備をしています...';
    this.btnCancel.style.display = 'inline-flex';
    this.btnDownload.style.display = 'none';
    this.btnClose.style.display = 'none';
    this.videoPreview.style.display = 'none';
    this.videoPreview.pause();
    this.modal.classList.add('open');

    // Detect Best Supported MIME Type (Prefer MP4)
    const mimeTypes = [
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=h264,opus',
      'video/webm'
    ];

    let chosenMime = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || '';
    const isMp4 = chosenMime.includes('mp4');
    console.log('Selected export MIME type:', chosenMime);

    // Prepare streams
    const canvasStream = slideshow.canvas.captureStream(30); // 30 FPS Full HD
    const tracks = [...canvasStream.getVideoTracks()];

    // Add audio track if BGM is present
    let audioCtx = null;
    let audioSourceNode = null;
    let audioDestNode = null;

    if (this.app.bgmAudio && this.app.bgmLoaded) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
        audioDestNode = audioCtx.createMediaStreamDestination();
        
        // Connect BGM to destination node
        audioSourceNode = audioCtx.createMediaElementSource(this.app.bgmAudio);
        audioSourceNode.connect(audioDestNode);
        audioSourceNode.connect(audioCtx.destination); // also play to speakers or keep silent if desired

        const audioTracks = audioDestNode.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          tracks.push(audioTracks[0]);
        }
      } catch (err) {
        console.warn('Web Audio routing warning:', err);
      }
    }

    const combinedStream = new MediaStream(tracks);

    const recorderOptions = {
      videoBitsPerSecond: 8000000 // 8 Mbps high quality
    };
    if (chosenMime) {
      recorderOptions.mimeType = chosenMime;
    }

    try {
      this.mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);
    } catch (e) {
      console.warn('MediaRecorder init with options failed, fallback without mimeType', e);
      this.mediaRecorder = new MediaRecorder(combinedStream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      if (this.cancelRequested) {
        this.statusLabel.textContent = '書き出しがキャンセルされました。';
        return;
      }

      const finalMime = isMp4 ? 'video/mp4' : (chosenMime || 'video/mp4');
      this.exportBlob = new Blob(this.recordedChunks, { type: finalMime });
      this.exportUrl = URL.createObjectURL(this.exportBlob);

      this.percentEl.textContent = '100%';
      this.progressFill.style.width = '100%';
      this.statusLabel.textContent = '✨ 書き出し完了！動画ファイルを保存できます。';

      this.btnCancel.style.display = 'none';
      this.btnDownload.style.display = 'inline-flex';
      this.btnClose.style.display = 'inline-flex';

      // Show video preview
      this.videoPreview.src = this.exportUrl;
      this.videoPreview.style.display = 'block';

      // Auto trigger download
      this.triggerDownload();
    };

    // Begin Recording Process
    this.mediaRecorder.start(200); // collect in 200ms slices

    // Start playback from 0
    slideshow.currentTime = 0;
    if (this.app.bgmAudio && this.app.bgmLoaded) {
      this.app.bgmAudio.currentTime = 0;
      await this.app.bgmAudio.play().catch(e => console.log(e));
    }

    const totalDuration = slideshow.totalDuration;
    const startTime = performance.now();

    const recordLoop = () => {
      if (!this.isExporting || this.cancelRequested) {
        return;
      }

      const elapsed = (performance.now() - startTime) / 1000;
      slideshow.currentTime = elapsed;

      // Sync BGM
      if (this.app.bgmAudio && this.app.bgmLoaded && !this.app.bgmAudio.paused) {
        slideshow.currentTime = this.app.bgmAudio.currentTime;
      }

      const progress = Math.min(1, slideshow.currentTime / totalDuration);
      this.percentEl.textContent = `${Math.floor(progress * 100)}%`;
      this.progressFill.style.width = `${progress * 100}%`;
      this.statusLabel.textContent = `レンダリング中... (${slideshow.formatTime(slideshow.currentTime)} / ${slideshow.formatTime(totalDuration)})`;

      slideshow.renderAtTime(slideshow.currentTime);

      if (slideshow.currentTime >= totalDuration) {
        this.finishRecording();
      } else {
        requestAnimationFrame(recordLoop);
      }
    };

    requestAnimationFrame(recordLoop);
  }

  finishRecording() {
    this.isExporting = false;
    if (this.app.bgmAudio) {
      this.app.bgmAudio.pause();
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  cancelExport() {
    this.cancelRequested = true;
    this.isExporting = false;
    if (this.app.bgmAudio) {
      this.app.bgmAudio.pause();
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.modal.classList.remove('open');
  }

  triggerDownload() {
    if (!this.exportBlob || !this.exportUrl) return;

    const mainTitle = document.getElementById('inputMainTitle')?.value?.trim();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    const safeTitle = mainTitle ? mainTitle.replace(/[\\/:*?"<>|]/g, '_') : 'mottophoto';
    const filename = `${safeTitle}_${dateStr}_${timeStr}.mp4`;

    const a = document.createElement('a');
    a.href = this.exportUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  closeModal() {
    this.videoPreview.pause();
    this.modal.classList.remove('open');
  }
}
