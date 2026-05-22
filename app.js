// Toastmasters Zoom Timer — composites segmented webcam onto official stoplight backgrounds.
// Single ES module. No build step. Binds exclusively to DOM contract IDs from index.html.

// ---------- Constants ----------
const STATES = ['start', 'green', 'yellow', 'red'];

const PRESETS = {
  'table-topics': { green: 60, yellow: 90, red: 120 },
  evaluation: { green: 120, yellow: 150, red: 180 },
  'ice-breaker': { green: 240, yellow: 300, red: 360 },
  prepared: { green: 300, yellow: 360, red: 420 },
  'long-speech': { green: 480, yellow: 540, red: 600 },
};
const PRESET_KEYS = ['table-topics', 'evaluation', 'ice-breaker', 'prepared', 'long-speech'];
const DEFAULT_PRESET = 'prepared';

// Speaker compositing region inside the 1920x1080 stage (left of stoplight, below logo).
const SPEAKER_ZONE = { x: 96, y: 86, w: 1286, h: 940 };
const CLOCK_BADGE = { x: 48, y: 960, w: 280, h: 80, r: 16 };

const OVERTIME_MARGIN = 30; // seconds past red counts as overtime
const STAGE_W = 1920;
const STAGE_H = 1080;

const LS = {
  cameraId: 'tmtimer.cameraId',
  preset: 'tmtimer.preset',
  customTimes: 'tmtimer.customTimes',
  bell: 'tmtimer.bell',
};

// ---------- Helpers ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const MSS_REGEX = /^(\d+):([0-5]?\d)$/;

function parseTime(s) {
  // "m:ss" -> seconds; returns NaN on bad input.
  if (typeof s !== 'string') return NaN;
  const m = MSS_REGEX.exec(s.trim());
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const ss = (sec % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

function $(id) {
  return document.getElementById(id);
}

// ---------- Asset preload ----------
// Await all backgrounds; if one fails the compositor will skip that background.
const bgImages = {};
await Promise.all(
  STATES.map(async (s) => {
    try {
      bgImages[s] = await loadImage(
        `./images/toastmasters-zoom-stoplight-bk-timer-${s}-1920x1080.jpg`
      );
    } catch (e) {
      console.error(`Failed to load background ${s}`, e);
    }
  })
);

// ---------- DOM ----------
const videoEl = $('video-source');
const stage = $('stage');
const stageCtx = stage.getContext('2d', { alpha: false });
const setupGuide = $('setup-guide');
const btnStartPause = $('btn-start-pause');
const btnReset = $('btn-reset');
const btnMirror = $('btn-mirror');
const btnBell = $('btn-bell');
const btnHelp = $('btn-help');
const cameraSelect = $('camera-select');
const presetSelect = $('preset-select');
const customGreen = $('custom-green');
const customYellow = $('custom-yellow');
const customRed = $('custom-red');
const customFields = $('custom-fields');
const clockHtml = $('clock-html');
const stateLabelHtml = $('state-label-html');
const sidebar = $('sidebar');

// Offscreen canvases for mask composition.
const fgCanvas = document.createElement('canvas');
fgCanvas.width = 1280;
fgCanvas.height = 720;
const fgCtx = fgCanvas.getContext('2d');

const maskCanvas = document.createElement('canvas');
maskCanvas.width = 1280;
maskCanvas.height = 720;
const maskCtx = maskCanvas.getContext('2d');

// ---------- State ----------
const app = {
  mode: 'idle', // idle | running | paused
  elapsed: 0, // seconds
  lastTickMs: 0,
  lastBgState: 'start',
  preset: DEFAULT_PRESET,
  customTimes: { green: 300, yellow: 360, red: 420 },
  bellEnabled: false,
  wakeLock: null,
  stream: null,
  segmenter: null,
  segmenterKind: null, // 'tasks' | 'legacy'
  legacyLatestMask: null,
  audioCtx: null,
};

// ---------- Sidebar error helper ----------
function showSidebarError(msg) {
  if (!sidebar) {
    console.error(msg);
    return;
  }
  let p = sidebar.querySelector('p.error');
  if (!p) {
    p = document.createElement('p');
    p.className = 'error';
    sidebar.appendChild(p);
  }
  p.textContent = msg;
}
function clearSidebarError() {
  sidebar?.querySelector('p.error')?.remove();
}

// ---------- Persisted settings ----------
function loadSettings() {
  try {
    const p = localStorage.getItem(LS.preset);
    if (p && (PRESETS[p] || p === 'custom')) app.preset = p;
    const c = localStorage.getItem(LS.customTimes);
    if (c) {
      const parsed = JSON.parse(c);
      if (
        parsed &&
        Number.isFinite(parsed.green) &&
        Number.isFinite(parsed.yellow) &&
        Number.isFinite(parsed.red)
      ) {
        app.customTimes = parsed;
      }
    }
    app.bellEnabled = localStorage.getItem(LS.bell) === '1';
  } catch {}
}
loadSettings();

function activeThresholds() {
  return app.preset === 'custom' ? app.customTimes : PRESETS[app.preset];
}

// ---------- Preset / custom UI binding ----------
function syncPresetUI() {
  if (presetSelect) presetSelect.value = app.preset;
  if (customFields) customFields.hidden = app.preset !== 'custom';
  if (customGreen) customGreen.value = formatTime(app.customTimes.green);
  if (customYellow) customYellow.value = formatTime(app.customTimes.yellow);
  if (customRed) customRed.value = formatTime(app.customTimes.red);
}

function showCustomError(msg) {
  if (!customFields) return;
  let p = customFields.querySelector('p.error');
  if (msg) {
    if (!p) {
      p = document.createElement('p');
      p.className = 'error';
      customFields.appendChild(p);
    }
    p.textContent = msg;
  } else if (p) {
    p.remove();
  }
}

function readCustomFromInputs() {
  const g = parseTime(customGreen?.value || '');
  const y = parseTime(customYellow?.value || '');
  const r = parseTime(customRed?.value || '');
  if (!Number.isFinite(g) || !Number.isFinite(y) || !Number.isFinite(r)) {
    showCustomError('Use m:ss (e.g. 1:30).');
    return null;
  }
  if (!(g < y && y < r)) {
    showCustomError('Green < Yellow < Red.');
    return null;
  }
  showCustomError(null);
  return { green: g, yellow: y, red: r };
}

presetSelect?.addEventListener('change', () => {
  const v = presetSelect.value;
  if (!(PRESETS[v] || v === 'custom')) return;
  app.preset = v;
  localStorage.setItem(LS.preset, v);
  syncPresetUI();
});

for (const inp of [customGreen, customYellow, customRed]) {
  inp?.addEventListener('input', () => {
    const v = readCustomFromInputs();
    if (v) {
      app.customTimes = v;
      localStorage.setItem(LS.customTimes, JSON.stringify(v));
    }
  });
}

syncPresetUI();

// ---------- Camera manager ----------
async function listCameras() {
  if (!cameraSelect) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    cameraSelect.innerHTML = '';
    for (const c of cams) {
      const opt = document.createElement('option');
      opt.value = c.deviceId;
      opt.textContent = c.label || `Camera ${cameraSelect.length + 1}`;
      cameraSelect.appendChild(opt);
    }
    const saved = localStorage.getItem(LS.cameraId);
    if (saved && cams.some((c) => c.deviceId === saved)) {
      cameraSelect.value = saved;
    }
  } catch (e) {
    console.error('enumerateDevices failed', e);
  }
}

async function startCamera(deviceId) {
  // Tear down any existing stream first.
  if (app.stream) {
    for (const t of app.stream.getTracks()) t.stop();
    app.stream = null;
  }
  try {
    const constraints = {
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        aspectRatio: 16 / 9,
        deviceId: deviceId ? { exact: deviceId } : undefined,
      },
      audio: false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    app.stream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
    clearSidebarError();
    // Re-list cameras now that we have a labels permission grant.
    await listCameras();
    // Persist selection (use the actual active track's deviceId if available).
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings?.();
    if (settings?.deviceId) {
      localStorage.setItem(LS.cameraId, settings.deviceId);
      if (cameraSelect) cameraSelect.value = settings.deviceId;
    } else if (deviceId) {
      localStorage.setItem(LS.cameraId, deviceId);
    }
  } catch (e) {
    if (e.name === 'NotAllowedError') {
      showSidebarError('Camera permission denied. Allow access in browser settings and reload.');
    } else if (e.name === 'NotFoundError') {
      showSidebarError('No camera found. Connect a webcam and reload.');
    } else {
      showSidebarError(`Camera error: ${e.message || e.name}`);
    }
    console.error('getUserMedia failed', e);
  }
}

cameraSelect?.addEventListener('change', () => {
  startCamera(cameraSelect.value);
});

// ---------- Segmentation ----------
const TASKS_VISION_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/vision_bundle.mjs';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/wasm';
const LEGACY_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/selfie_segmentation.js';
const LEGACY_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation';

async function initSegmenterTasks() {
  const vision = await import(/* @vite-ignore */ TASKS_VISION_URL);
  const { FilesetResolver, ImageSegmenter } = vision;
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
  const segmenter = await ImageSegmenter.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    // Confidence mask gives a smooth 0..1 gradient at the silhouette edge instead
    // of a hard binary cut — much cleaner composite, less haloing.
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  });
  app.segmenter = segmenter;
  app.segmenterKind = 'tasks';
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function initSegmenterLegacy() {
  await loadScript(LEGACY_URL);
  // global: SelfieSegmentation
  const seg = new window.SelfieSegmentation({
    locateFile: (file) => `${LEGACY_BASE}/${file}`,
  });
  seg.setOptions({ modelSelection: 1, selfieMode: false });
  seg.onResults((res) => {
    // res.segmentationMask is a HTMLCanvasElement/ImageBitmap-like mask (white = person).
    app.legacyLatestMask = res.segmentationMask;
  });
  await seg.initialize?.();
  app.segmenter = seg;
  app.segmenterKind = 'legacy';
}

async function initSegmenter() {
  try {
    await initSegmenterTasks();
  } catch (e) {
    console.warn('tasks-vision segmenter failed, falling back to legacy', e);
    try {
      await initSegmenterLegacy();
    } catch (e2) {
      console.error('Both segmenters failed', e2);
      showSidebarError('Background segmentation unavailable. Try Chrome 113+.');
    }
  }
}

// Run a frame through whichever segmenter is active. Mutates fgCanvas to be the
// foreground (segmented person) on a transparent background, sized 1280x720.
async function segmentFrame(video, tMs) {
  if (!app.segmenter) {
    // No segmenter: draw raw video (no background removal).
    fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
    fgCtx.drawImage(video, 0, 0, fgCanvas.width, fgCanvas.height);
    return;
  }

  if (app.segmenterKind === 'tasks') {
    const result = app.segmenter.segmentForVideo(video, tMs);
    const mask = result?.confidenceMasks?.[0];
    if (!mask) {
      result?.close?.();
      return;
    }
    const w = mask.width;
    const h = mask.height;
    // selfie_segmenter confidence mask: values 0..1 represent per-pixel confidence
    // the pixel is *background* in the .tflite asset we load (matches our earlier
    // categoryMask=0-is-person empirical finding — the model emits inverted scores).
    // So alpha for the person mask is (1 - conf).
    const data = mask.getAsFloat32Array();
    if (maskCanvas.width !== w || maskCanvas.height !== h) {
      maskCanvas.width = w;
      maskCanvas.height = h;
    }
    const imgData = maskCtx.createImageData(w, h);
    const px = imgData.data;
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      const a = Math.round((1 - data[i]) * 255);
      px[j] = 255;
      px[j + 1] = 255;
      px[j + 2] = 255;
      px[j + 3] = a;
    }
    maskCtx.putImageData(imgData, 0, 0);

    // Build foreground: draw video, then keep only mask region. A small blur
    // when scaling the mask up softens any residual aliasing along the silhouette.
    fgCtx.save();
    fgCtx.globalCompositeOperation = 'source-over';
    fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
    fgCtx.drawImage(video, 0, 0, fgCanvas.width, fgCanvas.height);
    fgCtx.globalCompositeOperation = 'destination-in';
    fgCtx.filter = 'blur(2px)';
    fgCtx.drawImage(maskCanvas, 0, 0, fgCanvas.width, fgCanvas.height);
    fgCtx.filter = 'none';
    fgCtx.restore();

    result.close?.();
  } else if (app.segmenterKind === 'legacy') {
    await app.segmenter.send({ image: video });
    const mask = app.legacyLatestMask;
    fgCtx.save();
    fgCtx.globalCompositeOperation = 'source-over';
    fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
    fgCtx.drawImage(video, 0, 0, fgCanvas.width, fgCanvas.height);
    if (mask) {
      fgCtx.globalCompositeOperation = 'destination-in';
      fgCtx.drawImage(mask, 0, 0, fgCanvas.width, fgCanvas.height);
    }
    fgCtx.restore();
  }
}

// ---------- Compositor ----------
function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSpeakerCover(ctx, src, zone) {
  // Aspect-preserving cover fit centered in zone.
  const sw = src.width;
  const sh = src.height;
  if (!sw || !sh) return;
  const zr = zone.w / zone.h;
  const sr = sw / sh;
  let sx, sy, sxw, syh;
  if (sr > zr) {
    // Source wider than zone — crop sides.
    syh = sh;
    sxw = sh * zr;
    sx = (sw - sxw) / 2;
    sy = 0;
  } else {
    // Source taller — crop top/bottom.
    sxw = sw;
    syh = sw / zr;
    sx = 0;
    sy = (sh - syh) / 2;
  }
  ctx.drawImage(src, sx, sy, sxw, syh, zone.x, zone.y, zone.w, zone.h);
}

function computeState(elapsed) {
  const t = activeThresholds();
  if (elapsed < t.green) return 'start';
  if (elapsed < t.yellow) return 'green';
  if (elapsed < t.red) return 'yellow';
  return 'red';
}

function isOvertime(elapsed) {
  return elapsed >= activeThresholds().red + OVERTIME_MARGIN;
}

function renderFrame(nowMs) {
  // Background
  const state = app.mode === 'idle' ? 'start' : computeState(app.elapsed);
  const bg = bgImages[state];
  if (bg) {
    stageCtx.drawImage(bg, 0, 0, STAGE_W, STAGE_H);
  } else {
    stageCtx.fillStyle = '#222';
    stageCtx.fillRect(0, 0, STAGE_W, STAGE_H);
  }

  // Speaker
  if (videoEl.readyState >= 2 && fgCanvas.width) {
    drawSpeakerCover(stageCtx, fgCanvas, SPEAKER_ZONE);
  }

  // Clock badge
  const cb = CLOCK_BADGE;
  stageCtx.save();
  drawRoundedRect(stageCtx, cb.x, cb.y, cb.w, cb.h, cb.r);
  stageCtx.fillStyle = 'rgba(0,0,0,0.65)';
  stageCtx.fill();
  stageCtx.fillStyle = '#fff';
  stageCtx.font = '600 60px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  stageCtx.textAlign = 'center';
  stageCtx.textBaseline = 'middle';
  stageCtx.fillText(formatTime(app.elapsed), cb.x + cb.w / 2, cb.y + cb.h / 2 + 2);
  stageCtx.restore();

  // Overtime pulse
  if (app.mode === 'running' && isOvertime(app.elapsed)) {
    const t = nowMs / 1000;
    const alpha = 0.1 + 0.1 * Math.sin(t * Math.PI * 4);
    stageCtx.fillStyle = `rgba(255,0,0,${alpha})`;
    stageCtx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
}

// ---------- Render loop ----------
function tickTimer(nowMs) {
  if (app.mode === 'running') {
    const dt = (nowMs - app.lastTickMs) / 1000;
    app.lastTickMs = nowMs;
    app.elapsed += dt;
  } else {
    app.lastTickMs = nowMs;
  }
}

function updateStateLabelDom(state, overtime) {
  if (!stateLabelHtml) return;
  const label = overtime ? 'OVERTIME' : state.toUpperCase();
  if (stateLabelHtml.textContent !== label) stateLabelHtml.textContent = label;
  // CSS keys badge color off data-state — keep it in sync.
  const dataState = overtime ? 'overtime' : state === 'start' ? '' : state;
  if (dataState) stateLabelHtml.setAttribute('data-state', dataState);
  else stateLabelHtml.removeAttribute('data-state');
}

function updateClockDom() {
  if (clockHtml) clockHtml.textContent = formatTime(app.elapsed);
}

function maybeBellTransition(prevState, newState) {
  if (!app.bellEnabled) return;
  if (prevState === newState) return;
  if (newState === 'green') playBeep(440);
  if (newState === 'yellow') playBeep(660);
  if (newState === 'red') playBeep(880);
}

async function frameStep(nowMs, metadata) {
  tickTimer(nowMs);

  // Determine state + handle bell transitions.
  const visState = app.mode === 'idle' ? 'start' : computeState(app.elapsed);
  if (app.mode === 'running' && visState !== app.lastBgState) {
    maybeBellTransition(app.lastBgState, visState);
  }
  app.lastBgState = visState;

  // Overtime body class
  const overtime = app.mode !== 'idle' && isOvertime(app.elapsed);
  document.body.classList.toggle('is-overtime', overtime);

  // Segment (only if we have a live frame).
  if (videoEl.readyState >= 2 && !videoEl.paused && !videoEl.ended) {
    try {
      await segmentFrame(videoEl, metadata?.mediaTime ? metadata.mediaTime * 1000 : nowMs);
    } catch (_e) {
      /* keep last frame on transient error */
    }
  }

  renderFrame(nowMs);
  updateClockDom();
  updateStateLabelDom(visState, overtime);

  scheduleNext();
}

function scheduleNext() {
  if (typeof videoEl.requestVideoFrameCallback === 'function') {
    videoEl.requestVideoFrameCallback((now, metadata) => frameStep(now, metadata));
  } else {
    requestAnimationFrame((now) => frameStep(now, null));
  }
}

// ---------- Bell / Audio ----------
function ensureAudio() {
  if (!app.audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) app.audioCtx = new Ctor();
  }
  return app.audioCtx;
}

function playBeep(freq) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  // Envelope: fast attack, 200ms total with 100ms decay.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.01);
  gain.gain.setValueAtTime(0.4, t0 + 0.1);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.22);
}

// ---------- Wake Lock ----------
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      app.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    console.warn('wakeLock request failed', e);
  }
}
async function releaseWakeLock() {
  try {
    await app.wakeLock?.release();
  } catch {}
  app.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.mode === 'running') {
    acquireWakeLock();
  }
});

// ---------- Timer controls ----------
const btnStartPauseLabel = btnStartPause?.querySelector('.btn-label');
function setStartPauseLabel() {
  if (!btnStartPauseLabel) return;
  const running = app.mode === 'running';
  btnStartPauseLabel.textContent = running ? 'Pause' : 'Start';
  btnStartPause?.setAttribute(
    'aria-label',
    running ? 'Pause timer (Space)' : 'Start timer (Space)'
  );
}

function startTimer() {
  ensureAudio(); // unlock on user gesture
  if (app.mode === 'idle') {
    app.elapsed = 0;
    app.lastBgState = 'start';
  }
  app.mode = 'running';
  app.lastTickMs = performance.now();
  acquireWakeLock();
  setStartPauseLabel();
}

function pauseTimer() {
  if (app.mode !== 'running') return;
  app.mode = 'paused';
  releaseWakeLock();
  setStartPauseLabel();
}

function resetTimer() {
  app.mode = 'idle';
  app.elapsed = 0;
  app.lastBgState = 'start';
  releaseWakeLock();
  setStartPauseLabel();
  document.body.classList.remove('is-overtime');
}

function toggleStartPause() {
  if (app.mode === 'running') pauseTimer();
  else startTimer();
}

function toggleMirror() {
  const mirrored = document.body.classList.toggle('is-mirrored');
  btnMirror?.setAttribute('aria-pressed', String(mirrored));
}

function toggleBell() {
  app.bellEnabled = !app.bellEnabled;
  localStorage.setItem(LS.bell, app.bellEnabled ? '1' : '0');
  btnBell?.setAttribute('aria-pressed', String(app.bellEnabled));
}

btnStartPause?.addEventListener('click', toggleStartPause);
btnReset?.addEventListener('click', resetTimer);
btnMirror?.addEventListener('click', toggleMirror);
btnBell?.addEventListener('click', toggleBell);
btnBell?.setAttribute('aria-pressed', String(app.bellEnabled));
btnHelp?.addEventListener('click', () => {
  if (setupGuide && !setupGuide.open) setupGuide.showModal();
});

// ---------- Keyboard shortcuts ----------
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const isText =
    ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
  if (isText) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (e.key) {
    case ' ':
      e.preventDefault();
      toggleStartPause();
      break;
    case 'r':
    case 'R':
      resetTimer();
      break;
    case 'h':
    case 'H':
      document.body.classList.toggle('stage-clean');
      break;
    case 'm':
    case 'M':
      toggleMirror();
      break;
    case 'b':
    case 'B':
      toggleBell();
      break;
    case '?':
    case '/':
      e.preventDefault();
      if (setupGuide && !setupGuide.open) setupGuide.showModal();
      break;
    case '1':
    case '2':
    case '3':
    case '4':
    case '5': {
      const idx = parseInt(e.key, 10) - 1;
      const key = PRESET_KEYS[idx];
      if (key) {
        app.preset = key;
        localStorage.setItem(LS.preset, key);
        syncPresetUI();
      }
      break;
    }
  }
});

// ---------- Boot ----------
setStartPauseLabel();
updateClockDom();
updateStateLabelDom('start', false);

await initSegmenter();
await listCameras();
await startCamera(localStorage.getItem(LS.cameraId) || undefined);

// Once the video is ready, size offscreen canvases to its true resolution.
videoEl.addEventListener('loadedmetadata', () => {
  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;
  if (fgCanvas.width !== w || fgCanvas.height !== h) {
    fgCanvas.width = w;
    fgCanvas.height = h;
    maskCanvas.width = w;
    maskCanvas.height = h;
  }
});

// Kick the render loop.
scheduleNext();

// ---------- captureStream / debug surface ----------
const captureStream = stage.captureStream(30);
window.__tmtimer = {
  stream: captureStream,
  setElapsed(seconds) {
    app.elapsed = Math.max(0, Number(seconds) || 0);
    if (app.mode === 'idle') app.mode = 'paused';
  },
  getState() {
    return {
      mode: app.mode,
      elapsed: app.elapsed,
      preset: app.preset,
      thresholds: activeThresholds(),
      bgState: app.lastBgState,
      overtime: isOvertime(app.elapsed),
    };
  },
};
