// Toastmasters Zoom Timer — pure logic and compositing core.
//
// Everything here is free of live I/O and module-level DOM: functions take their
// canvas context, storage, or media devices as parameters. That keeps the timing
// math, settings parsing, keyboard mapping, camera fallback, and stage compositing
// unit-testable with plain stubs (no jsdom canvas), while app.js stays a thin shell.

// ---------- Constants ----------
export const STATES = ['start', 'green', 'yellow', 'red'];

export const PRESETS = {
  'table-topics': { green: 60, yellow: 90, red: 120 },
  evaluation: { green: 120, yellow: 150, red: 180 },
  'ice-breaker': { green: 240, yellow: 300, red: 360 },
  prepared: { green: 300, yellow: 360, red: 420 },
  'long-speech': { green: 480, yellow: 540, red: 600 },
};
export const PRESET_KEYS = ['table-topics', 'evaluation', 'ice-breaker', 'prepared', 'long-speech'];
export const DEFAULT_PRESET = 'prepared';

// Speaker compositing region inside the 1920x1080 stage — centered within the
// background's inner frame, below the logo/label bar. Internal to the compositor.
const SPEAKER_ZONE = { x: 140, y: 200, w: 1640, h: 760 };
const CLOCK_BADGE = { x: 48, y: 960, w: 280, h: 80, r: 16 };

const OVERTIME_MARGIN = 30; // seconds past red counts as overtime
const STAGE_W = 1920;
const STAGE_H = 1080;

// Canvas can't read CSS custom properties, so the on-stage readouts carry their
// own font family (mirrors --font-mono in styles.css).
const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const LS = {
  cameraId: 'tmtimer.cameraId',
  preset: 'tmtimer.preset',
  customTimes: 'tmtimer.customTimes',
  bell: 'tmtimer.bell',
};

const MSS_REGEX = /^(\d+):([0-5]?\d)$/;

// Bell tone per state, in Hz. null = no bell for that state.
const BELL_FREQ = { green: 440, yellow: 660, red: 880 };

// Keyboard shortcuts as data (no branchy switch). Digits 1-5 are handled
// separately as preset selection.
const KEY_ACTIONS = {
  ' ': 'toggle',
  r: 'reset',
  R: 'reset',
  h: 'stage-clean',
  H: 'stage-clean',
  m: 'mirror',
  M: 'mirror',
  b: 'bell',
  B: 'bell',
  '?': 'help',
  '/': 'help',
};

// ---------- Time parsing / formatting ----------
export function parseTime(s) {
  // "m:ss" -> seconds; returns NaN on bad input.
  if (typeof s !== 'string') return NaN;
  const m = MSS_REGEX.exec(s.trim());
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const ss = (sec % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

// ---------- Timing state ----------
export function activeThresholds(preset, customTimes) {
  return preset === 'custom' ? customTimes : PRESETS[preset];
}

export function computeState(elapsed, thresholds) {
  if (elapsed < thresholds.green) return 'start';
  if (elapsed < thresholds.yellow) return 'green';
  if (elapsed < thresholds.red) return 'yellow';
  return 'red';
}

export function isOvertime(elapsed, thresholds) {
  return elapsed >= thresholds.red + OVERTIME_MARGIN;
}

// ---------- Settings ----------
// Validate three "m:ss" custom-threshold strings. Returns the parsed seconds on
// success, or an error message describing the first problem.
export function validateCustomTimes(greenStr, yellowStr, redStr) {
  const green = parseTime(greenStr || '');
  const yellow = parseTime(yellowStr || '');
  const red = parseTime(redStr || '');
  if (!Number.isFinite(green) || !Number.isFinite(yellow) || !Number.isFinite(red)) {
    return { ok: false, error: 'Use m:ss (e.g. 1:30).' };
  }
  if (!(green < yellow && yellow < red)) {
    return { ok: false, error: 'Green < Yellow < Red.' };
  }
  return { ok: true, value: { green, yellow, red } };
}

// Read and validate persisted settings from a `getItem(key) -> string|null`
// function (localStorage-compatible). Returns only the fields that are present
// and valid, so callers can merge over their defaults.
export function readSettings(getItem) {
  const out = {};
  try {
    const preset = getItem(LS.preset);
    if (preset && (PRESETS[preset] || preset === 'custom')) out.preset = preset;
    const rawCustom = getItem(LS.customTimes);
    if (rawCustom) {
      const parsed = JSON.parse(rawCustom);
      if (
        parsed &&
        Number.isFinite(parsed.green) &&
        Number.isFinite(parsed.yellow) &&
        Number.isFinite(parsed.red)
      ) {
        out.customTimes = parsed;
      }
    }
    out.bellEnabled = getItem(LS.bell) === '1';
  } catch {
    /* corrupt storage -> fall back to defaults */
  }
  return out;
}

// ---------- Bell ----------
export function bellForTransition(prevState, newState, enabled) {
  if (!enabled || prevState === newState) return null;
  return BELL_FREQ[newState] ?? null;
}

// ---------- State label ----------
// The HTML state badge shows a label and a data-state attribute the CSS keys
// color off of. "start" carries no data-state (neutral).
export function stateLabel(state, overtime) {
  const label = overtime ? 'OVERTIME' : state.toUpperCase();
  const dataState = overtime ? 'overtime' : state === 'start' ? '' : state;
  return { label, dataState };
}

// ---------- Keyboard ----------
// Map a key to an action name, or null if unbound. Digits 1-5 select a preset.
export function keyAction(key) {
  if (key >= '1' && key <= '5') return `preset:${parseInt(key, 10) - 1}`;
  return KEY_ACTIONS[key] ?? null;
}

// Whether a keydown should be ignored because focus is in a text field or a
// modifier is held.
export function shouldIgnoreKey(activeEl, event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (!activeEl) return false;
  return (
    activeEl.tagName === 'INPUT' ||
    activeEl.tagName === 'TEXTAREA' ||
    activeEl.isContentEditable === true
  );
}

// ---------- Camera ----------
export function buildVideoConstraints(deviceId) {
  return {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      aspectRatio: { ideal: 16 / 9 },
      deviceId: deviceId ? { exact: deviceId } : undefined,
    },
    audio: false,
  };
}

// Request a camera stream, falling back to the default device when a pinned
// deviceId no longer matches an available camera (IDs can rotate across browser
// restarts, which throws Overconstrained/NotFound). `onDropPin` is invoked when
// the stale pin is abandoned so callers can forget it.
export async function getUserMediaWithFallback(mediaDevices, deviceId, onDropPin) {
  try {
    return await mediaDevices.getUserMedia(buildVideoConstraints(deviceId));
  } catch (e) {
    if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
      onDropPin?.();
      return await mediaDevices.getUserMedia(buildVideoConstraints(undefined));
    }
    throw e;
  }
}

export function cameraErrorMessage(e) {
  if (e?.name === 'NotAllowedError') {
    return 'Camera permission denied. Allow access in browser settings and reload.';
  }
  if (e?.name === 'NotFoundError') {
    return 'No camera found. Connect a webcam and reload.';
  }
  return `Camera error: ${e?.message || e?.name}`;
}

// ---------- Segmentation ----------
// Write a binary alpha channel into an RGBA pixel buffer from a multiclass
// category mask: class 0 is background (alpha 0), anything else is person
// (alpha 255). `pixels` is mutated in place and returned.
export function buildMaskAlpha(catData, pixels) {
  for (let i = 0, j = 3; i < catData.length; i++, j += 4) {
    pixels[j] = catData[i] === 0 ? 0 : 255;
  }
  return pixels;
}

// ---------- Compositor ----------
export function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawSpeakerCover(ctx, src, zone) {
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

// The backgrounds flood the whole frame with the state color and bake in their
// own GREEN/YELLOW/RED label, so the timer is rendered white (legible on every
// flood color) with a dark outline + shadow. Overtime has no dedicated
// background, so we surface an explicit "OVERTIME" label.
export function drawBigTimer(ctx, zone, text, overtime) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const labelText = overtime ? 'OVERTIME' : '';
  const labelReserve = labelText ? zone.h * 0.22 : 0;
  const timerCenterY = zone.y + (zone.h - labelReserve) / 2;
  const labelCenterY = zone.y + zone.h - labelReserve / 2;

  let timerFontSize = Math.floor((zone.h - labelReserve) * 0.7);
  ctx.font = `700 ${timerFontSize}px ${MONO_FONT}`;
  const maxWidth = zone.w * 0.9;
  const measured = ctx.measureText(text).width;
  if (measured > maxWidth) {
    timerFontSize = Math.floor(timerFontSize * (maxWidth / measured));
    ctx.font = `700 ${timerFontSize}px ${MONO_FONT}`;
  }

  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = timerFontSize * 0.06;
  ctx.shadowOffsetY = timerFontSize * 0.02;
  ctx.lineWidth = Math.max(2, timerFontSize * 0.03);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.strokeText(text, zone.x + zone.w / 2, timerCenterY);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, zone.x + zone.w / 2, timerCenterY);

  if (labelText) {
    const labelFontSize = Math.floor(zone.h * 0.12);
    ctx.font = `800 ${labelFontSize}px ${MONO_FONT}`;
    ctx.lineWidth = Math.max(2, labelFontSize * 0.06);
    ctx.strokeText(labelText, zone.x + zone.w / 2, labelCenterY);
    ctx.fillStyle = '#fff';
    ctx.fillText(labelText, zone.x + zone.w / 2, labelCenterY);
  }

  ctx.restore();
}

// Composite one full stage frame onto `ctx`. All inputs are passed in so this is
// pure with respect to a recording-stub context:
//   { images, mode, elapsed, thresholds, nowMs, videoReady, fgCanvas }
export function renderStage(ctx, opts) {
  const { images, mode, elapsed, thresholds, nowMs, videoReady, fgCanvas } = opts;

  // Background
  const state = mode === 'idle' ? 'start' : computeState(elapsed, thresholds);
  const bg = images[state];
  if (bg) {
    ctx.drawImage(bg, 0, 0, STAGE_W, STAGE_H);
  } else {
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }

  // Once the timer starts the focus shifts to the clock: the speaker zone shows
  // a giant readout instead of the segmented webcam.
  const showBigTimer = mode !== 'idle';
  const overtime = showBigTimer && isOvertime(elapsed, thresholds);

  if (showBigTimer) {
    drawBigTimer(ctx, SPEAKER_ZONE, formatTime(elapsed), overtime);
  } else if (videoReady && fgCanvas.width) {
    drawSpeakerCover(ctx, fgCanvas, SPEAKER_ZONE);
  }

  // Clock badge — only shown while the big timer is not taking the stage.
  if (!showBigTimer) {
    const cb = CLOCK_BADGE;
    ctx.save();
    drawRoundedRect(ctx, cb.x, cb.y, cb.w, cb.h, cb.r);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 60px ${MONO_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(formatTime(elapsed), cb.x + cb.w / 2, cb.y + cb.h / 2 + 2);
    ctx.restore();
  }

  // Overtime pulse
  if (mode === 'running' && isOvertime(elapsed, thresholds)) {
    const t = nowMs / 1000;
    const alpha = 0.1 + 0.1 * Math.sin(t * Math.PI * 4);
    ctx.fillStyle = `rgba(255,0,0,${alpha})`;
    ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  }
}
