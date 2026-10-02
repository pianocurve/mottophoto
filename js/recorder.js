/**
 * mottophoto - Video Export Engine
 * High-speed hardware-accelerated MP4 export via WebCodecs API + mp4-muxer.
 * Falls back to MediaRecorder if WebCodecs is not supported.
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

    this.isExporting = false;
    this.exportBlob = null;
    this.exportUrl = null;
    this.cancelRequested = false;

    // Fallback MediaRecorder state
    this.mediaRecorder = null;
    this.recordedChunks = [];

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
    this.statusLabel.textContent = '超高速エンコードを準備しています...';
    this.btnCancel.style.display = 'inline-flex';
    this.btnDownload.style.display = 'none';
    this.btnClose.style.display = 'none';
    this.videoPreview.style.display = 'none';
    this.videoPreview.pause();
    this.modal.classList.add('open');

    // Check WebCodecs + Mp4Muxer support
    const supportsWebCodecs = (
      typeof window.VideoEncoder === 'function' &&
      typeof window.Mp4Muxer === 'object' &&
      typeof window.VideoFrame === 'function'
    );

    if (supportsWebCodecs) {
      try {
        await this.exportWithWebCodecs();
        return;
      } catch (err) {
        console.warn('WebCodecs export failed, falling back to MediaRecorder:', err);
        if (this.cancelRequested) return;
        this.statusLabel.textContent = '通常録画モードに切り替えています...';
      }
    }

    // Fallback: Realtime MediaRecorder
    await this.exportWithMediaRecorder();
  }

  /**
   * Super-fast Hardware Accelerated Offline Export (WebCodecs + Mp4Muxer)
   */
  async exportWithWebCodecs() {
    const slideshow = this.app.slideshow;
    const totalDuration = slideshow.totalDuration;
    const fps = 30;
    const totalFrames = Math.ceil(totalDuration * fps);
    const cw = slideshow.width;   // 1920
    const ch = slideshow.height;  // 1080

    // 1. Prepare Audio (Decode BGM directly into memory if available)
    let audioBuffer = null;
    let hasAudio = false;

    if (this.app.bgmAudio && this.app.bgmLoaded && (this.app.bgmFile || this.app.bgmUrl)) {
      try {
        this.statusLabel.textContent = '🎵 BGM音声を高速解析中...';
        let arrayBuffer = null;
        if (this.app.bgmFile) {
          arrayBuffer = await this.app.bgmFile.arrayBuffer();
        } else if (this.app.bgmUrl) {
          const res = await fetch(this.app.bgmUrl);
          arrayBuffer = await res.arrayBuffer();
        }

        if (arrayBuffer) {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          const tempCtx = new AudioContextClass();
          audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
          hasAudio = !!(audioBuffer && audioBuffer.numberOfChannels > 0);
          tempCtx.close().catch(() => {});
        }
      } catch (e) {
        console.warn('Fast audio decode warning:', e);
        hasAudio = false;
      }
    }

    if (this.cancelRequested) return;

    // 2. Setup MP4 Muxer
    const muxerOptions = {
      target: new window.Mp4Muxer.ArrayBufferTarget(),
      video: {
        codec: 'avc',
        width: cw,
        height: ch
      },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset'
    };

    if (hasAudio) {
      muxerOptions.audio = {
        codec: 'aac',
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate
      };
    }

    const muxer = new window.Mp4Muxer.Muxer(muxerOptions);

    // 3. Setup VideoEncoder (Apple Silicon / Hardware H.264 High Profile)
    let encoderError = null;
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => {
        console.error('VideoEncoder error:', e);
        encoderError = e;
      }
    });

    videoEncoder.configure({
      codec: 'avc1.640028', // H.264 High Profile Level 4.0
      width: cw,
      height: ch,
      bitrate: 8_500_000,
      framerate: fps
    });

    // 4. Encode Audio Track in background (Instant: < 0.5s)
    let audioEncoder = null;
    if (hasAudio) {
      audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => console.error('AudioEncoder error:', e)
      });

      audioEncoder.configure({
        codec: 'mp4a.40.2', // AAC-LC
        numberOfChannels: audioBuffer.numberOfChannels,
        sampleRate: audioBuffer.sampleRate,
        bitrate: 192_000
      });

      const sampleRate = audioBuffer.sampleRate;
      const channels = audioBuffer.numberOfChannels;
      const totalAudioSamples = Math.min(
        audioBuffer.length,
        Math.ceil(totalDuration * sampleRate)
      );
      const chunkSize = 2048;

      for (let offset = 0; offset < totalAudioSamples; offset += chunkSize) {
        if (this.cancelRequested) break;
        const currentLen = Math.min(chunkSize, totalAudioSamples - offset);
        const planarData = new Float32Array(currentLen * channels);

        for (let chIdx = 0; chIdx < channels; chIdx++) {
          const chData = audioBuffer.getChannelData(chIdx);
          planarData.set(chData.subarray(offset, offset + currentLen), chIdx * currentLen);
        }

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: sampleRate,
          numberOfFrames: currentLen,
          numberOfChannels: channels,
          timestamp: Math.round((offset / sampleRate) * 1_000_000), // µs
          data: planarData
        });

        audioEncoder.encode(audioData);
        audioData.close();
      }

      await audioEncoder.flush();
    }

    if (this.cancelRequested || encoderError) {
      videoEncoder.close();
      if (audioEncoder) audioEncoder.close();
      return;
    }

    // 5. Offline Frame-by-Frame Video Rendering (Max CPU/GPU Speed)
    const startTime = performance.now();

    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (this.cancelRequested || encoderError) {
        videoEncoder.close();
        if (audioEncoder) audioEncoder.close();
        return;
      }

      const frameTime = frameIdx / fps;
      slideshow.renderAtTime(frameTime);

      const videoFrame = new VideoFrame(slideshow.canvas, {
        timestamp: Math.round(frameIdx * (1_000_000 / fps)), // µs
        duration: Math.round(1_000_000 / fps)
      });

      const keyFrame = (frameIdx % 60 === 0);
      videoEncoder.encode(videoFrame, { keyFrame });
      videoFrame.close();

      // Update progress UI every 6 frames
      if (frameIdx % 6 === 0 || frameIdx === totalFrames - 1) {
        const progress = (frameIdx + 1) / totalFrames;
        const percent = Math.floor(progress * 100);
        this.percentEl.textContent = `${percent}%`;
        this.progressFill.style.width = `${percent}%`;

        const elapsedSec = (performance.now() - startTime) / 1000;
        const fpsActual = Math.round((frameIdx + 1) / Math.max(0.1, elapsedSec));
        this.statusLabel.textContent = `🚀 高速エンコード中 (${fpsActual} fps)... ${frameIdx + 1} / ${totalFrames} コマ`;

        // Yield to browser event loop
        await new Promise(r => setTimeout(r, 0));
      }
    }

    this.statusLabel.textContent = '✨ MP4ファイルを仕上げています...';
    await videoEncoder.flush();
    muxer.finalize();

    if (this.cancelRequested) return;

    // 6. Complete and provide download
    const { buffer } = muxer.target;
    this.exportBlob = new Blob([buffer], { type: 'video/mp4' });
    this.exportUrl = URL.createObjectURL(this.exportBlob);

    this.percentEl.textContent = '100%';
    this.progressFill.style.width = '100%';
    const totalTimeSec = ((performance.now() - startTime) / 1000).toFixed(1);
    this.statusLabel.textContent = `🎉 高速書き出し完了！(${totalTimeSec}秒で完了) 動画を保存できます。`;

    this.btnCancel.style.display = 'none';
    this.btnDownload.style.display = 'inline-flex';
    this.btnClose.style.display = 'inline-flex';

    this.videoPreview.src = this.exportUrl;
    this.videoPreview.style.display = 'block';

    this.triggerDownload();
  }

  /**
   * Fallback Realtime MediaRecorder (only used if WebCodecs is unavailable)
   */
  async exportWithMediaRecorder() {
    const slideshow = this.app.slideshow;

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

    const canvasStream = slideshow.canvas.captureStream(30);
    const tracks = [...canvasStream.getVideoTracks()];

    let audioCtx = null;
    let audioSourceNode = null;
    let audioDestNode = null;

    if (this.app.bgmAudio && this.app.bgmLoaded) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();
        audioDestNode = audioCtx.createMediaStreamDestination();
        audioSourceNode = audioCtx.createMediaElementSource(this.app.bgmAudio);
        audioSourceNode.connect(audioDestNode);
        audioSourceNode.connect(audioCtx.destination);
        const audioTracks = audioDestNode.stream.getAudioTracks();
        if (audioTracks.length > 0) tracks.push(audioTracks[0]);
      } catch (err) {
        console.warn('Web Audio routing warning:', err);
      }
    }

    const combinedStream = new MediaStream(tracks);
    const recorderOptions = { videoBitsPerSecond: 8000000 };
    if (chosenMime) recorderOptions.mimeType = chosenMime;

    try {
      this.mediaRecorder = new MediaRecorder(combinedStream, recorderOptions);
    } catch (e) {
      this.mediaRecorder = new MediaRecorder(combinedStream);
    }

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.recordedChunks.push(event.data);
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
      this.videoPreview.src = this.exportUrl;
      this.videoPreview.style.display = 'block';
      this.triggerDownload();
    };

    this.mediaRecorder.start(200);
    slideshow.currentTime = 0;
    if (this.app.bgmAudio && this.app.bgmLoaded) {
      this.app.bgmAudio.currentTime = 0;
      await this.app.bgmAudio.play().catch(e => console.log(e));
    }

    const totalDuration = slideshow.totalDuration;
    const startTime = performance.now();

    const recordLoop = () => {
      if (!this.isExporting || this.cancelRequested) return;

      const elapsed = (performance.now() - startTime) / 1000;
      slideshow.currentTime = elapsed;

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
