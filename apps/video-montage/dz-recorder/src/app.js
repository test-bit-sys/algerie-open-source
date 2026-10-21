/**
 * DZ-Recorder Core Logic
 * محرك استوديو تسجيل الشاشة والكاميرا الجزائري
 */

(function () {
  'use strict';

  // عناصر الواجهة
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnStop = document.getElementById('btnStop');
  const chkScreen = document.getElementById('chkScreen');
  const chkCamera = document.getElementById('chkCamera');
  const chkMic = document.getElementById('chkMic');
  const chkSysAudio = document.getElementById('chkSysAudio');
  const videoQuality = document.getElementById('videoQuality');
  const recStatus = document.getElementById('recStatus');
  const statusText = document.getElementById('statusText');
  const timerDisplay = document.getElementById('timerDisplay');
  const screenVideo = document.getElementById('screenVideo');
  const cameraVideo = document.getElementById('cameraVideo');
  const drawingCanvas = document.getElementById('drawingCanvas');
  const noSourcePlaceholder = document.getElementById('noSourcePlaceholder');
  const editorPanel = document.getElementById('editorPanel');
  const playbackVideo = document.getElementById('playbackVideo');
  const recordedSize = document.getElementById('recordedSize');
  const btnDownloadWebM = document.getElementById('btnDownloadWebM');
  const btnNewRecord = document.getElementById('btnNewRecord');
  const btnClearCanvas = document.getElementById('btnClearCanvas');

  let mediaRecorder = null;
  let recordedChunks = [];
  let screenStream = null;
  let cameraStream = null;
  let micStream = null;
  let combinedStream = null;
  let audioContext = null;
  let timerInterval = null;
  let secondsElapsed = 0;
  let recordedBlob = null;

  // إعداد لوحة الرسم (Canvas)
  const ctx = drawingCanvas.getContext('2d');
  let currentTool = 'none';
  let currentColor = '#ef4444';
  let isDrawing = false;
  let startX = 0;
  let startY = 0;
  let snapshot = null;

  function resizeCanvas() {
    drawingCanvas.width = drawingCanvas.parentElement.clientWidth;
    drawingCanvas.height = drawingCanvas.parentElement.clientHeight;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  // أدوات الرسم
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });

  document.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.color-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentColor = btn.dataset.color;
    });
  });

  btnClearCanvas.addEventListener('click', () => {
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
  });

  drawingCanvas.addEventListener('mousedown', (e) => {
    if (currentTool === 'none') return;
    isDrawing = true;
    const rect = drawingCanvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    snapshot = ctx.getImageData(0, 0, drawingCanvas.width, drawingCanvas.height);
    if (currentTool === 'pen') {
      ctx.beginPath();
      ctx.moveTo(startX, startY);
    }
  });

  drawingCanvas.addEventListener('mousemove', (e) => {
    if (!isDrawing || currentTool === 'none') return;
    const rect = drawingCanvas.getBoundingClientRect();
    const currX = e.clientX - rect.left;
    const currY = e.clientY - rect.top;

    if (currentTool === 'pen') {
      ctx.lineTo(currX, currY);
      ctx.stroke();
    } else if (currentTool === 'rect') {
      ctx.putImageData(snapshot, 0, 0);
      ctx.strokeRect(startX, startY, currX - startX, currY - startY);
    } else if (currentTool === 'arrow') {
      ctx.putImageData(snapshot, 0, 0);
      drawArrow(startX, startY, currX, currY);
    }
  });

  drawingCanvas.addEventListener('mouseup', () => {
    isDrawing = false;
  });

  function drawArrow(fromX, fromY, toX, toY) {
    const headLen = 12;
    const angle = Math.atan2(toY - fromY, toX - fromX);
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle - Math.PI / 6), toY - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(toX, toY);
    ctx.lineTo(toX - headLen * Math.cos(angle + Math.PI / 6), toY - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }

  // إدارة المؤقت
  function formatTime(sec) {
    const hrs = String(Math.floor(sec / 3600)).padStart(2, '0');
    const mins = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const secs = String(sec % 60).padStart(2, '0');
    return `${hrs}:${mins}:${secs}`;
  }

  function startTimer() {
    secondsElapsed = 0;
    timerDisplay.textContent = '00:00:00';
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      secondsElapsed++;
      timerDisplay.textContent = formatTime(secondsElapsed);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
  }

  // بدء التسجيل
  btnStart.addEventListener('click', async () => {
    try {
      recordedChunks = [];
      const constraints = {
        video: {
          height: { ideal: parseInt(videoQuality.value, 10) },
          frameRate: { ideal: videoQuality.value === '1080' ? 60 : 30 }
        },
        audio: chkSysAudio.checked
      };

      // 1. التقاط الشاشة
      if (chkScreen.checked) {
        screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
        screenVideo.srcObject = screenStream;
        noSourcePlaceholder.classList.add('hidden');
      }

      // 2. التقاط الكاميرا
      if (chkCamera.checked) {
        try {
          cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
          cameraVideo.srcObject = cameraStream;
          cameraVideo.classList.remove('hidden');
        } catch (camErr) {
          console.warn('[DZ-Recorder] Camera not accessible:', camErr);
        }
      }

      // 3. التقاط الميكروفون ومزج الصوت
      const audioTracks = [];
      if (chkMic.checked) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          audioTracks.push(...micStream.getAudioTracks());
        } catch (micErr) {
          console.warn('[DZ-Recorder] Mic not accessible:', micErr);
        }
      }

      if (screenStream && screenStream.getAudioTracks().length > 0) {
        audioTracks.push(...screenStream.getAudioTracks());
      }

      // دمج المسارات في بث واحد
      const tracks = [];
      if (screenStream) {
        tracks.push(...screenStream.getVideoTracks());
      }
      tracks.push(...audioTracks);

      combinedStream = new MediaStream(tracks);

      // إنشاء مسجل الميديا
      let mimeType = 'video/webm;codecs=vp9,opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm';
        }
      }

      mediaRecorder = new MediaRecorder(combinedStream, { mimeType });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        recordedBlob = new Blob(recordedChunks, { type: 'video/webm' });
        const sizeMB = (recordedBlob.size / (1024 * 1024)).toFixed(2);
        recordedSize.textContent = `${sizeMB} MB`;
        playbackVideo.src = URL.createObjectURL(recordedBlob);
        editorPanel.classList.remove('hidden');
        stopAllStreams();
      };

      mediaRecorder.start(1000); // تجميع كل ثانية

      // تحديث الواجهة
      btnStart.disabled = true;
      btnPause.disabled = false;
      btnStop.disabled = false;
      recStatus.classList.add('recording');
      statusText.textContent = 'جارٍ التسجيل...';
      startTimer();

      // إيقاف التسجيل تلقائياً إذا أوقف المستخدم مشاركة الشاشة عبر شريط المتصفح
      if (screenStream) {
        screenStream.getVideoTracks()[0].onended = () => {
          if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            btnStop.click();
          }
        };
      }

    } catch (err) {
      console.error('[DZ-Recorder] فشل بدء التسجيل:', err);
      alert('تعذر بدء التسجيل: ' + (err.message || 'يرجى السماح بالوصول للشاشة'));
    }
  });

  // إيقاف مؤقت / استئناف
  btnPause.addEventListener('click', () => {
    if (!mediaRecorder) return;
    if (mediaRecorder.state === 'recording') {
      mediaRecorder.pause();
      clearInterval(timerInterval);
      btnPause.innerHTML = '<span class="icon">▶️</span> استئناف';
      statusText.textContent = 'متوقف مؤقتاً';
      recStatus.classList.remove('recording');
    } else if (mediaRecorder.state === 'paused') {
      mediaRecorder.resume();
      timerInterval = setInterval(() => {
        secondsElapsed++;
        timerDisplay.textContent = formatTime(secondsElapsed);
      }, 1000);
      btnPause.innerHTML = '<span class="icon">⏸</span> إيقاف مؤقت';
      statusText.textContent = 'جارٍ التسجيل...';
      recStatus.classList.add('recording');
    }
  });

  // إنهاء التسجيل
  btnStop.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    stopTimer();
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled = true;
    recStatus.classList.remove('recording');
    statusText.textContent = 'مكتمل';
  });

  function stopAllStreams() {
    if (screenStream) screenStream.getTracks().forEach(t => t.stop());
    if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    cameraVideo.classList.add('hidden');
  }

  // تنزيل الفيديو
  btnDownloadWebM.addEventListener('click', () => {
    if (!recordedBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(recordedBlob);
    const dateStr = new Date().toISOString().slice(0, 10);
    a.download = `تسجيل-شاشة-الجزائر-${dateStr}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  // تسجيل مقطع جديد
  btnNewRecord.addEventListener('click', () => {
    editorPanel.classList.add('hidden');
    playbackVideo.src = '';
    noSourcePlaceholder.classList.remove('hidden');
    ctx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    statusText.textContent = 'جاهز للتسجيل';
    timerDisplay.textContent = '00:00:00';
  });

})();
