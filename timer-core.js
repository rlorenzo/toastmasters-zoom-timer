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

// Human-readable category names for the on-stage timing-rules header.
export const PRESET_LABELS = {
  'table-topics': 'Table Topics',
  evaluation: 'Evaluation',
  'ice-breaker': 'Ice Breaker',
  prepared: 'Prepared Speech',
  'long-speech': 'Long Speech',
  custom: 'Custom',
};

export function presetDisplayName(preset) {
  return PRESET_LABELS[preset] || PRESET_LABELS.custom;
}

// Speaker compositing region inside the 1920x1080 stage — spans from just below
// the logo/label bar all the way down to the very bottom edge of the whole frame
// (y=1080), so the speaker is planted on the floor of the entire output, not just
// the decorative inner border. Internal to the compositor.
const SPEAKER_ZONE = { x: 140, y: 200, w: 1640, h: 880 };
const CLOCK_BADGE = { x: 48, y: 960, w: 280, h: 80, r: 16 };

// Timing-rules header — right-aligned in the top bar opposite the logo, clearing
// the baked-in state label that lives top-left on the colored backgrounds.
const RULES_HEADER = { rightX: 1764, centerY: 120 };

// Chip background + ink per threshold (signal-color convention, legible on any
// flood background).
const CHIP_STYLE = {
  green: { bg: '#2b9e3f', ink: '#04210b' },
  yellow: { bg: '#e8c84a', ink: '#241f00' },
  red: { bg: '#e0443e', ink: '#ffffff' },
};

const OVERTIME_MARGIN = 30; // seconds past red counts as overtime
const STAGE_W = 1920;
const STAGE_H = 1080;

// Canvas can't read CSS custom properties, so the on-stage readouts carry their
// own font family (mirrors --font-mono / --font-display in styles.css).
const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const UI_FONT =
  'Montserrat, "Source Sans 3", system-ui, -apple-system, "Segoe UI", Arial, sans-serif';

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

// Aspect-preserving cover fit centered in `zone`. Fallback used until a person
// silhouette has been detected; once one is, drawSpeakerFramed takes over.
export function drawSpeakerCover(ctx, src, zone) {
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

// Bounding box (normalized 0..1) of the person pixels in a multiclass category
// mask: class 0 is background, anything else is person. Returns null when no
// person is present. Lets the compositor frame the speaker by their actual
// silhouette rather than the raw camera frame, which may show desk/room below.
export function personBoundingBox(catData, w, h) {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let row = 0; row < h; row++) {
    const off = row * w;
    for (let col = 0; col < w; col++) {
      if (catData[off + col] !== 0) {
        minX = Math.min(minX, col);
        maxX = Math.max(maxX, col);
        minY = Math.min(minY, row);
        maxY = Math.max(maxY, row);
      }
    }
  }
  if (maxX < 0) return null;
  return {
    x: minX / w,
    y: minY / h,
    w: (maxX - minX + 1) / w,
    h: (maxY - minY + 1) / h,
  };
}

// Exponential blend between the previous and next boxes so the framing eases
// rather than jumping as the silhouette wobbles frame to frame. Keeps the last
// good box when the person is momentarily lost (next is null).
export function smoothBox(prev, next, alpha = 0.15) {
  if (!next) return prev;
  if (!prev) return next;
  const f = (a, b) => a + (b - a) * alpha;
  return {
    x: f(prev.x, next.x),
    y: f(prev.y, next.y),
    w: f(prev.w, next.w),
    h: f(prev.h, next.h),
  };
}

// Draw the segmented speaker scaled so their silhouette fills `fill` of the zone
// height, horizontally centered, with their feet/torso planted on the floor of
// the zone (no gap beneath). `box` is the normalized person bounding box within
// `src`. Overflow is clipped to the zone so nothing paints over the frame.
export function drawSpeakerFramed(ctx, src, zone, box, opts = {}) {
  const sw = src.width;
  const sh = src.height;
  if (!sw || !sh || !box) return;
  const { fill = 0.92, minScale = 0.4, maxScale = 2.6, bottomMargin = 0 } = opts;
  const bw = box.w * sw;
  const bh = box.h * sh;
  if (bw <= 0 || bh <= 0) return;

  // Fill the zone height, but never let the silhouette overflow the zone width,
  // and keep the zoom within sane bounds.
  let s = (zone.h * fill) / bh;
  s = Math.min(s, zone.w / bw);
  s = Math.max(minScale, Math.min(maxScale, s));

  const personCx = (box.x + box.w / 2) * sw;
  const personBottom = (box.y + box.h) * sh;
  const dx = zone.x + zone.w / 2 - s * personCx;
  const dy = zone.y + zone.h - bottomMargin - s * personBottom;

  ctx.save();
  ctx.beginPath();
  ctx.rect(zone.x, zone.y, zone.w, zone.h);
  ctx.clip();
  ctx.drawImage(src, dx, dy, sw * s, sh * s);
  ctx.restore();
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

// Draw the speech category + Green/Yellow/Red threshold chips, right-aligned in
// the stage's top bar. Gives the audience the timing rules at a glance without
// crowding the logo or the baked-in state label. `label` is optional; the chips
// render from `thresholds` alone.
export function drawTimingRules(ctx, opts) {
  const { label, thresholds, rightX = RULES_HEADER.rightX, centerY = RULES_HEADER.centerY } = opts;
  if (!thresholds) return;

  const catFont = `700 36px ${UI_FONT}`;
  const chipFont = `700 30px ${MONO_FONT}`;
  const chipH = 50;
  const chipPadX = 16;
  const chipGap = 12;
  const catGap = 24;

  const chips = [
    { ...CHIP_STYLE.green, text: formatTime(thresholds.green) },
    { ...CHIP_STYLE.yellow, text: formatTime(thresholds.yellow) },
    { ...CHIP_STYLE.red, text: formatTime(thresholds.red) },
  ];

  ctx.save();
  ctx.textBaseline = 'middle';

  // Measure the whole group so it can hang off the right edge.
  ctx.font = chipFont;
  const chipWidths = chips.map((c) => ctx.measureText(c.text).width + chipPadX * 2);
  ctx.font = catFont;
  const catWidth = label ? ctx.measureText(label).width : 0;
  const total =
    (label ? catWidth + catGap : 0) +
    chipWidths.reduce((a, w) => a + w, 0) +
    chipGap * (chips.length - 1);

  let x = rightX - total;

  if (label) {
    // Own save/restore so the drop shadow doesn't bleed onto the chips.
    ctx.save();
    ctx.font = catFont;
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, x, centerY);
    ctx.restore();
    x += catWidth + catGap;
  }

  ctx.font = chipFont;
  ctx.textAlign = 'center';
  for (let i = 0; i < chips.length; i++) {
    const w = chipWidths[i];
    drawRoundedRect(ctx, x, centerY - chipH / 2, w, chipH, chipH / 2);
    ctx.fillStyle = chips[i].bg;
    ctx.fill();
    ctx.fillStyle = chips[i].ink;
    ctx.fillText(chips[i].text, x + w / 2, centerY + 1);
    x += w + chipGap;
  }

  ctx.restore();
}

// Composite one full stage frame onto `ctx`. All inputs are passed in so this is
// pure with respect to a recording-stub context:
//   { images, mode, elapsed, thresholds, presetLabel, nowMs, videoReady, fgCanvas, personBox }
export function renderStage(ctx, opts) {
  const { images, mode, elapsed, thresholds, presetLabel, nowMs, videoReady, fgCanvas, personBox } =
    opts;

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
    // Prefer silhouette-aware framing (speaker planted on the floor, no gap);
    // fall back to a plain cover fit until a person is detected.
    if (personBox) drawSpeakerFramed(ctx, fgCanvas, SPEAKER_ZONE, personBox);
    else drawSpeakerCover(ctx, fgCanvas, SPEAKER_ZONE);
  }

  // Timing-rules header — drawn over the background in every mode for constant
  // audience context.
  drawTimingRules(ctx, { label: presetLabel, thresholds });

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
