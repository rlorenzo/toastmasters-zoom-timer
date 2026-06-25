// Toastmasters Zoom Timer — DOM/IO shell.
//
// Binds the index.html DOM contract to the pure logic in timer-core.js, drives
// the camera + MediaPipe segmenter, and runs the compositing loop. All timing
// math, settings parsing, keyboard mapping, camera fallback, and stage drawing
// live in timer-core.js so they can be unit-tested; this file is the imperative
// shell. Boot is deferred to init() (called by main.js) so the module can be
// imported under test without firing camera/network/loop side effects.

import {
  activeThresholds,
  bellForTransition,
  buildMaskAlpha,
  cameraErrorMessage,
  computeState,
  DEFAULT_PRESET,
  formatTime,
  getUserMediaWithFallback,
  isOvertime,
  keyAction,
  LS,
  PRESET_KEYS,
  PRESETS,
  personBoundingBox,
  presetDisplayName,
  readSettings,
  renderStage,
  STATES,
  shouldIgnoreKey,
  smoothBox,
  stateLabel,
  validateCustomTimes,
} from './timer-core.js';

// ---------- Helpers ----------
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function $(id) {
  return document.getElementById(id);
}

// ---------- Asset preload ----------
// Full-frame Toastmasters virtual backgrounds. The colored states flood the
// whole frame and carry their own state label; "start" uses the neutral logo
// background.
const BG_SRC = {
  start: './images/toastmasters-zoom-virtual-logo-bk-1920x1080.jpg',
  green: './images/toastmasters-zoom-virtual-logo-bk-timer-green-1920x1080.jpg',
  yellow: './images/toastmasters-zoom-virtual-logo-bk-timer-yellow-1920x1080.jpg',
  red: './images/toastmasters-zoom-virtual-logo-bk-timer-red-1920x1080.jpg',
};
const bgImages = {};

// ---------- DOM ----------
const videoEl = $('video-source');
const stage = $('stage');
const stageCtx = stage ? stage.getContext('2d', { alpha: false }) : null;
const setupGuide = $('setup-guide');
const btnStartPause = $('btn-start-pause');
const btnReset = $('btn-reset');
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
let maskImageData = null;

// ---------- State ----------
export const app = {
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
  audioCtx: null,
  personBox: null, // smoothed normalized silhouette box for speaker framing
  missedFrames: 0, // consecutive frames with no detected silhouette
};

// Drop a stale silhouette box after this many consecutive person-less frames
// (~2s at 30fps) so the speaker view falls back to a plain cover fit and can
// re-enter cleanly instead of staying locked to where someone last stood.
const MAX_MISSED_FRAMES = 60;

function thresholds() {
  return activeThresholds(app.preset, app.customTimes);
}

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
export function loadSettings() {
  const s = readSettings((k) => localStorage.getItem(k));
  if (s.preset) app.preset = s.preset;
  if (s.customTimes) app.customTimes = s.customTimes;
  app.bellEnabled = Boolean(s.bellEnabled);
}

// ---------- Preset / custom UI binding ----------
export function syncPresetUI() {
  if (presetSelect) presetSelect.value = app.preset;
  if (customFields) customFields.hidden = app.preset !== 'custom';
  if (customGreen) customGreen.value = formatTime(app.customTimes.green);
  if (customYellow) customYellow.value = formatTime(app.customTimes.yellow);
  if (customRed) customRed.value = formatTime(app.customTimes.red);
}

export function showCustomError(msg) {
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

export function readCustomFromInputs() {
  const res = validateCustomTimes(customGreen?.value, customYellow?.value, customRed?.value);
  if (!res.ok) {
    showCustomError(res.error);
    return null;
  }
  showCustomError(null);
  return res.value;
}

function applyPresetByIndex(idx) {
  const key = PRESET_KEYS[idx];
  if (!key) return;
  app.preset = key;
  localStorage.setItem(LS.preset, key);
  syncPresetUI();
}

// ---------- Camera manager ----------
export async function listCameras() {
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

function stopStream() {
  if (app.stream) {
    for (const t of app.stream.getTracks()) t.stop();
    app.stream = null;
  }
}

function persistActiveCamera(stream, deviceId) {
  // Prefer the active track's resolved deviceId; fall back to the requested one.
  const track = stream.getVideoTracks()[0];
  const settings = track?.getSettings?.();
  if (settings?.deviceId) {
    localStorage.setItem(LS.cameraId, settings.deviceId);
    if (cameraSelect) cameraSelect.value = settings.deviceId;
  } else if (deviceId) {
    localStorage.setItem(LS.cameraId, deviceId);
  }
}

export async function startCamera(deviceId) {
  stopStream();
  try {
    const stream = await getUserMediaWithFallback(navigator.mediaDevices, deviceId, () =>
      localStorage.removeItem(LS.cameraId)
    );
    app.stream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
    clearSidebarError();
    // Re-list cameras now that we have a labels permission grant.
    await listCameras();
    persistActiveCamera(stream, deviceId);
  } catch (e) {
    showSidebarError(cameraErrorMessage(e));
    console.error('getUserMedia failed', e);
  }
}

// ---------- Segmentation ----------
const TASKS_VISION_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/vision_bundle.mjs';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10/wasm';

async function initSegmenter() {
  try {
    const vision = await import(/* @vite-ignore */ TASKS_VISION_URL);
    const { FilesetResolver, ImageSegmenter } = vision;
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    app.segmenter = await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      // Multiclass uses softmax across 6 channels, so confidence values for
      // background rarely reach 1.0 even on clean background pixels. Use the
      // categoryMask (per-pixel integer class) for a definitive person/not-
      // person cut; the blur during upscale gives us soft edges.
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
  } catch (e) {
    console.error('Segmenter init failed', e);
    showSidebarError('Background segmentation unavailable. Try Chrome 113+.');
  }
}

// Run a frame through the tasks-vision multiclass segmenter. Mutates fgCanvas
// to be the foreground (segmented person) on a transparent background.
export async function segmentFrame(video, tMs) {
  if (!app.segmenter) {
    // No segmenter: draw raw video (no background removal). Without a mask we
    // can't frame by silhouette, so fall back to a plain cover fit.
    fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
    fgCtx.drawImage(video, 0, 0, fgCanvas.width, fgCanvas.height);
    app.personBox = null;
    return;
  }

  const result = app.segmenter.segmentForVideo(video, tMs);
  // selfie_multiclass classes: 0=background, 1=hair, 2=body-skin, 3=face-skin,
  // 4=clothes, 5=others. Anything non-zero is person.
  const catMask = result?.categoryMask;
  if (!catMask) {
    result?.close?.();
    return;
  }
  const w = catMask.width;
  const h = catMask.height;
  const data = catMask.getAsUint8Array();
  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas.width = w;
    maskCanvas.height = h;
    maskImageData = null;
  }
  if (!maskImageData) {
    maskImageData = maskCtx.createImageData(w, h);
    const px0 = maskImageData.data;
    for (let j = 0; j < px0.length; j += 4) {
      px0[j] = 255;
      px0[j + 1] = 255;
      px0[j + 2] = 255;
    }
  }
  buildMaskAlpha(data, maskImageData.data);
  maskCtx.putImageData(maskImageData, 0, 0);

  // Track the silhouette so the compositor can frame the speaker on the floor of
  // the stage instead of floating mid-frame. Keep the last good box through brief
  // tracking dropouts, but release it once the person is gone for a while.
  const bbox = personBoundingBox(data, w, h);
  if (bbox) {
    app.personBox = smoothBox(app.personBox, bbox);
    app.missedFrames = 0;
  } else if (++app.missedFrames > MAX_MISSED_FRAMES) {
    app.personBox = null;
  }

  // Build foreground: draw video, then keep only mask region. A 1px blur on the
  // upscaled mask softens aliasing without smearing the silhouette.
  fgCtx.save();
  fgCtx.globalCompositeOperation = 'source-over';
  fgCtx.clearRect(0, 0, fgCanvas.width, fgCanvas.height);
  fgCtx.drawImage(video, 0, 0, fgCanvas.width, fgCanvas.height);
  fgCtx.globalCompositeOperation = 'destination-in';
  fgCtx.filter = 'blur(1px)';
  fgCtx.drawImage(maskCanvas, 0, 0, fgCanvas.width, fgCanvas.height);
  fgCtx.filter = 'none';
  fgCtx.restore();

  result.close?.();
}

// ---------- Compositor ----------
function renderFrame(nowMs) {
  renderStage(stageCtx, {
    images: bgImages,
    mode: app.mode,
    elapsed: app.elapsed,
    thresholds: thresholds(),
    presetLabel: presetDisplayName(app.preset),
    nowMs,
    videoReady: videoEl.readyState >= 2,
    fgCanvas,
    personBox: app.personBox,
  });
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

export function updateStateLabelDom(state, overtime) {
  if (!stateLabelHtml) return;
  const { label, dataState } = stateLabel(state, overtime);
  if (stateLabelHtml.textContent !== label) stateLabelHtml.textContent = label;
  // CSS keys badge color off data-state — keep it in sync.
  if (dataState) stateLabelHtml.setAttribute('data-state', dataState);
  else stateLabelHtml.removeAttribute('data-state');
}

export function updateClockDom() {
  if (clockHtml) clockHtml.textContent = formatTime(app.elapsed);
}

export async function frameStep(nowMs, metadata) {
  tickTimer(nowMs);

  const t = thresholds();
  const visState = app.mode === 'idle' ? 'start' : computeState(app.elapsed, t);
  if (app.mode === 'running' && visState !== app.lastBgState) {
    const freq = bellForTransition(app.lastBgState, visState, app.bellEnabled);
    if (freq) playBeep(freq);
  }
  app.lastBgState = visState;

  // Overtime body class
  const overtime = app.mode !== 'idle' && isOvertime(app.elapsed, t);
  document.body.classList.toggle('is-overtime', overtime);

  // Segment (only if we have a live frame and the speaker view is on screen;
  // once timing starts the big clock takes over so we can skip the work).
  if (app.mode === 'idle' && videoEl.readyState >= 2 && !videoEl.paused && !videoEl.ended) {
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

export function scheduleNext() {
  if (typeof videoEl.requestVideoFrameCallback === 'function') {
    videoEl.requestVideoFrameCallback((now, metadata) => frameStep(now, metadata));
  } else {
    requestAnimationFrame((now) => frameStep(now, null));
  }
}

// Size the offscreen canvases to the video's true resolution (run on loadedmetadata).
export function resizeOffscreenCanvases() {
  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;
  if (fgCanvas.width !== w || fgCanvas.height !== h) {
    fgCanvas.width = w;
    fgCanvas.height = h;
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

export function startTimer() {
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

export function pauseTimer() {
  if (app.mode !== 'running') return;
  app.mode = 'paused';
  releaseWakeLock();
  setStartPauseLabel();
}

export function resetTimer() {
  app.mode = 'idle';
  app.elapsed = 0;
  app.lastBgState = 'start';
  releaseWakeLock();
  setStartPauseLabel();
  document.body.classList.remove('is-overtime');
}

export function toggleStartPause() {
  if (app.mode === 'running') pauseTimer();
  else startTimer();
}

export function toggleBell() {
  app.bellEnabled = !app.bellEnabled;
  localStorage.setItem(LS.bell, app.bellEnabled ? '1' : '0');
  btnBell?.setAttribute('aria-pressed', String(app.bellEnabled));
}

function openHelp() {
  if (setupGuide && !setupGuide.open) setupGuide.showModal();
}

// Dispatch a resolved keyboard action to its control.
export function runKeyAction(action) {
  if (action.startsWith('preset:')) {
    applyPresetByIndex(parseInt(action.slice(7), 10));
    return;
  }
  switch (action) {
    case 'toggle':
      toggleStartPause();
      break;
    case 'reset':
      resetTimer();
      break;
    case 'stage-clean':
      document.body.classList.toggle('stage-clean');
      break;
    case 'bell':
      toggleBell();
      break;
    case 'help':
      openHelp();
      break;
  }
}

// ---------- Event wiring ----------
// Registered at import so the DOM contract is live; the boot/IO work is deferred
// to init().
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

cameraSelect?.addEventListener('change', () => {
  startCamera(cameraSelect.value);
});

btnStartPause?.addEventListener('click', toggleStartPause);
btnReset?.addEventListener('click', resetTimer);
btnBell?.addEventListener('click', toggleBell);
btnHelp?.addEventListener('click', openHelp);

document.addEventListener('keydown', (e) => {
  if (shouldIgnoreKey(document.activeElement, e)) return;
  const action = keyAction(e.key);
  if (!action) return;
  if (action === 'toggle' || action === 'help') e.preventDefault();
  runKeyAction(action);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.mode === 'running') {
    acquireWakeLock();
  }
});

// Synchronous UI initialization (safe to run at import; no IO).
loadSettings();
syncPresetUI();
setStartPauseLabel();
updateClockDom();
updateStateLabelDom('start', false);
btnBell?.setAttribute('aria-pressed', String(app.bellEnabled));

// ---------- Boot ----------
// Deferred IO: preload backgrounds, init segmenter, start camera, kick the loop,
// and expose the captureStream/debug surface. Called from main.js in the browser.
export async function init() {
  await Promise.all(
    STATES.map(async (s) => {
      try {
        bgImages[s] = await loadImage(BG_SRC[s]);
      } catch (e) {
        console.error(`Failed to load background ${s}`, e);
      }
    })
  );

  await initSegmenter();
  await listCameras();
  await startCamera(localStorage.getItem(LS.cameraId) || undefined);

  // Once the video is ready, size offscreen canvases to its true resolution.
  videoEl.addEventListener('loadedmetadata', resizeOffscreenCanvases);

  scheduleNext();

  // captureStream / debug surface
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
        thresholds: thresholds(),
        bgState: app.lastBgState,
        overtime: isOvertime(app.elapsed, thresholds()),
        // Silhouette framing box (normalized). null => falling back to plain
        // cover fit because no person mask is available.
        personBox: app.personBox,
      };
    },
  };
}
