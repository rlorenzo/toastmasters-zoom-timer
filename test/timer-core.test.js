import { describe, expect, it, vi } from 'vitest';
import {
  bellForTransition,
  buildMaskAlpha,
  buildVideoConstraints,
  cameraErrorMessage,
  computeState,
  drawBigTimer,
  drawRoundedRect,
  drawSpeakerCover,
  formatTime,
  getUserMediaWithFallback,
  isOvertime,
  keyAction,
  PRESETS,
  parseTime,
  readSettings,
  renderStage,
  shouldIgnoreKey,
  stateLabel,
  validateCustomTimes,
} from '../timer-core.js';

// Recording 2D-context stub: methods push [name, ...args]; properties are
// plain assignable fields. measureText is overridable per test.
function makeCtx() {
  const calls = [];
  const ctx = {
    calls,
    measureText: (t) => ({ width: t.length }),
    names: () => calls.map((c) => c[0]),
  };
  const methods = [
    'save',
    'restore',
    'beginPath',
    'moveTo',
    'arcTo',
    'closePath',
    'fill',
    'stroke',
    'drawImage',
    'fillRect',
    'strokeText',
    'fillText',
    'putImageData',
    'clearRect',
  ];
  for (const m of methods) ctx[m] = (...args) => calls.push([m, ...args]);
  return ctx;
}

describe('parseTime', () => {
  it('parses m:ss to seconds', () => {
    expect(parseTime('1:30')).toBe(90);
    expect(parseTime('0:05')).toBe(5);
    expect(parseTime('10:00')).toBe(600);
    expect(parseTime('  2:00  ')).toBe(120);
  });
  it('returns NaN on bad input', () => {
    expect(parseTime('abc')).toBeNaN();
    expect(parseTime('1:60')).toBeNaN();
    expect(parseTime('90')).toBeNaN();
    expect(parseTime(90)).toBeNaN();
    expect(parseTime(null)).toBeNaN();
  });
});

describe('formatTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(600)).toBe('10:00');
  });
  it('floors and clamps', () => {
    expect(formatTime(90.9)).toBe('1:30');
    expect(formatTime(-5)).toBe('0:00');
  });
});

describe('computeState / isOvertime', () => {
  const t = PRESETS.prepared; // {green:300,yellow:360,red:420}
  it('maps elapsed to state at boundaries', () => {
    expect(computeState(0, t)).toBe('start');
    expect(computeState(299, t)).toBe('start');
    expect(computeState(300, t)).toBe('green');
    expect(computeState(359, t)).toBe('green');
    expect(computeState(360, t)).toBe('yellow');
    expect(computeState(419, t)).toBe('yellow');
    expect(computeState(420, t)).toBe('red');
    expect(computeState(9999, t)).toBe('red');
  });
  it('flags overtime at red + margin', () => {
    expect(isOvertime(449, t)).toBe(false);
    expect(isOvertime(450, t)).toBe(true);
  });
});

describe('validateCustomTimes', () => {
  it('accepts ordered valid times', () => {
    expect(validateCustomTimes('1:00', '1:30', '2:00')).toEqual({
      ok: true,
      value: { green: 60, yellow: 90, red: 120 },
    });
  });
  it('rejects bad format', () => {
    const r = validateCustomTimes('x', '1:30', '2:00');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/m:ss/);
  });
  it('rejects out-of-order times', () => {
    const r = validateCustomTimes('2:00', '1:30', '1:00');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Green < Yellow < Red/);
  });
});

describe('readSettings', () => {
  const store = (obj) => (k) => (k in obj ? obj[k] : null);
  it('reads a valid preset, custom times, and bell', () => {
    const s = readSettings(
      store({
        'tmtimer.preset': 'evaluation',
        'tmtimer.customTimes': JSON.stringify({ green: 1, yellow: 2, red: 3 }),
        'tmtimer.bell': '1',
      })
    );
    expect(s).toEqual({
      preset: 'evaluation',
      customTimes: { green: 1, yellow: 2, red: 3 },
      bellEnabled: true,
    });
  });
  it('accepts the custom preset keyword', () => {
    expect(readSettings(store({ 'tmtimer.preset': 'custom' })).preset).toBe('custom');
  });
  it('ignores an unknown preset and malformed custom times', () => {
    const s = readSettings(
      store({
        'tmtimer.preset': 'bogus',
        'tmtimer.customTimes': JSON.stringify({ green: 'x' }),
      })
    );
    expect(s.preset).toBeUndefined();
    expect(s.customTimes).toBeUndefined();
    expect(s.bellEnabled).toBe(false);
  });
  it('survives corrupt JSON', () => {
    const s = readSettings(store({ 'tmtimer.customTimes': '{not json' }));
    expect(s.customTimes).toBeUndefined();
  });
});

describe('bellForTransition', () => {
  it('returns a frequency on a real transition when enabled', () => {
    expect(bellForTransition('start', 'green', true)).toBe(440);
    expect(bellForTransition('green', 'yellow', true)).toBe(660);
    expect(bellForTransition('yellow', 'red', true)).toBe(880);
  });
  it('returns null when disabled, unchanged, or untoned', () => {
    expect(bellForTransition('start', 'green', false)).toBeNull();
    expect(bellForTransition('green', 'green', true)).toBeNull();
    expect(bellForTransition('red', 'start', true)).toBeNull();
  });
});

describe('stateLabel', () => {
  it('maps state to label + data-state', () => {
    expect(stateLabel('start', false)).toEqual({ label: 'START', dataState: '' });
    expect(stateLabel('green', false)).toEqual({ label: 'GREEN', dataState: 'green' });
    expect(stateLabel('red', true)).toEqual({ label: 'OVERTIME', dataState: 'overtime' });
  });
});

describe('keyAction', () => {
  it('maps digits to preset actions', () => {
    expect(keyAction('1')).toBe('preset:0');
    expect(keyAction('5')).toBe('preset:4');
  });
  it('maps letters and symbols', () => {
    expect(keyAction(' ')).toBe('toggle');
    expect(keyAction('r')).toBe('reset');
    expect(keyAction('R')).toBe('reset');
    expect(keyAction('/')).toBe('help');
  });
  it('returns null for unbound keys', () => {
    expect(keyAction('6')).toBeNull();
    expect(keyAction('x')).toBeNull();
  });
});

describe('shouldIgnoreKey', () => {
  it('ignores when a modifier is held', () => {
    expect(shouldIgnoreKey(null, { metaKey: true })).toBe(true);
    expect(shouldIgnoreKey(null, { ctrlKey: true })).toBe(true);
    expect(shouldIgnoreKey(null, { altKey: true })).toBe(true);
  });
  it('ignores when focus is in a text field', () => {
    expect(shouldIgnoreKey({ tagName: 'INPUT' }, {})).toBe(true);
    expect(shouldIgnoreKey({ tagName: 'TEXTAREA' }, {})).toBe(true);
    expect(shouldIgnoreKey({ isContentEditable: true }, {})).toBe(true);
  });
  it('does not ignore for plain elements or no focus', () => {
    expect(shouldIgnoreKey(null, {})).toBe(false);
    expect(shouldIgnoreKey({ tagName: 'DIV' }, {})).toBe(false);
  });
});

describe('buildVideoConstraints', () => {
  it('pins an exact deviceId when given', () => {
    expect(buildVideoConstraints('cam1').video.deviceId).toEqual({ exact: 'cam1' });
  });
  it('leaves deviceId undefined when omitted', () => {
    expect(buildVideoConstraints().video.deviceId).toBeUndefined();
  });
});

describe('getUserMediaWithFallback', () => {
  it('returns the stream on success', async () => {
    const md = { getUserMedia: vi.fn().mockResolvedValue('STREAM') };
    await expect(getUserMediaWithFallback(md, 'cam1')).resolves.toBe('STREAM');
    expect(md.getUserMedia).toHaveBeenCalledTimes(1);
  });
  it('drops a stale pin and retries with the default camera', async () => {
    const err = Object.assign(new Error('over'), { name: 'OverconstrainedError' });
    const md = {
      getUserMedia: vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('FALLBACK'),
    };
    const onDrop = vi.fn();
    await expect(getUserMediaWithFallback(md, 'stale', onDrop)).resolves.toBe('FALLBACK');
    expect(onDrop).toHaveBeenCalledOnce();
    expect(md.getUserMedia.mock.calls[1][0].video.deviceId).toBeUndefined();
  });
  it('rethrows unrelated errors', async () => {
    const err = Object.assign(new Error('boom'), { name: 'NotAllowedError' });
    const md = { getUserMedia: vi.fn().mockRejectedValue(err) };
    await expect(getUserMediaWithFallback(md, 'cam1')).rejects.toThrow('boom');
  });
  it('rethrows when there is no pin to drop', async () => {
    const err = Object.assign(new Error('nf'), { name: 'NotFoundError' });
    const md = { getUserMedia: vi.fn().mockRejectedValue(err) };
    await expect(getUserMediaWithFallback(md, undefined)).rejects.toThrow('nf');
  });
});

describe('cameraErrorMessage', () => {
  it('maps known error names', () => {
    expect(cameraErrorMessage({ name: 'NotAllowedError' })).toMatch(/permission denied/);
    expect(cameraErrorMessage({ name: 'NotFoundError' })).toMatch(/No camera found/);
  });
  it('falls back to message or name', () => {
    expect(cameraErrorMessage({ message: 'weird' })).toBe('Camera error: weird');
    expect(cameraErrorMessage({ name: 'OddError' })).toBe('Camera error: OddError');
  });
});

describe('buildMaskAlpha', () => {
  it('sets alpha 0 for background and 255 for person pixels', () => {
    const cat = Uint8Array.from([0, 1, 0, 4]);
    const px = new Uint8ClampedArray(16); // 4 RGBA pixels
    buildMaskAlpha(cat, px);
    expect([px[3], px[7], px[11], px[15]]).toEqual([0, 255, 0, 255]);
  });
});

describe('drawRoundedRect', () => {
  it('emits a closed path', () => {
    const ctx = makeCtx();
    drawRoundedRect(ctx, 0, 0, 100, 50, 8);
    const names = ctx.names();
    expect(names[0]).toBe('beginPath');
    expect(names).toContain('arcTo');
    expect(names.at(-1)).toBe('closePath');
  });
});

describe('drawSpeakerCover', () => {
  const zone = { x: 140, y: 200, w: 1640, h: 760 };
  it('crops the sides of a wide source', () => {
    const ctx = makeCtx();
    drawSpeakerCover(ctx, { width: 4000, height: 1000 }, zone);
    expect(ctx.names()).toContain('drawImage');
  });
  it('crops the top/bottom of a tall source', () => {
    const ctx = makeCtx();
    drawSpeakerCover(ctx, { width: 1000, height: 4000 }, zone);
    expect(ctx.names()).toContain('drawImage');
  });
  it('skips a zero-size source', () => {
    const ctx = makeCtx();
    drawSpeakerCover(ctx, { width: 0, height: 0 }, zone);
    expect(ctx.calls).toHaveLength(0);
  });
});

describe('drawBigTimer', () => {
  const zone = { x: 140, y: 200, w: 1640, h: 760 };
  it('draws just the timer when not overtime', () => {
    const ctx = makeCtx();
    drawBigTimer(ctx, zone, '1:30', false);
    const fills = ctx.calls.filter((c) => c[0] === 'fillText');
    expect(fills).toHaveLength(1);
    expect(fills[0][1]).toBe('1:30');
  });
  it('adds an OVERTIME label when overtime', () => {
    const ctx = makeCtx();
    drawBigTimer(ctx, zone, '7:30', true);
    const labels = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
    expect(labels).toContain('OVERTIME');
  });
  it('shrinks the font when the text overflows', () => {
    const ctx = makeCtx();
    ctx.measureText = () => ({ width: 99999 });
    drawBigTimer(ctx, zone, '88:88', false);
    expect(ctx.names()).toContain('fillText');
  });
});

describe('renderStage', () => {
  const thresholds = PRESETS.prepared;
  const images = { start: { width: 1 }, green: { width: 1 }, red: { width: 1 } };
  const fgCanvas = { width: 1280, height: 720 };

  it('draws background + speaker cover when idle with a ready video', () => {
    const ctx = makeCtx();
    renderStage(ctx, {
      images,
      mode: 'idle',
      elapsed: 0,
      thresholds,
      nowMs: 0,
      videoReady: true,
      fgCanvas,
    });
    expect(ctx.names()).toContain('drawImage');
    // clock badge path also runs while idle
    expect(ctx.names()).toContain('fillText');
  });

  it('falls back to a flat fill when the background image is missing', () => {
    const ctx = makeCtx();
    renderStage(ctx, {
      images: {},
      mode: 'idle',
      elapsed: 0,
      thresholds,
      nowMs: 0,
      videoReady: false,
      fgCanvas,
    });
    expect(ctx.names()).toContain('fillRect');
  });

  it('draws the big timer while running', () => {
    const ctx = makeCtx();
    renderStage(ctx, {
      images,
      mode: 'running',
      elapsed: 310,
      thresholds,
      nowMs: 0,
      videoReady: true,
      fgCanvas,
    });
    const fills = ctx.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
    expect(fills).toContain('5:10');
  });

  it('adds the overtime pulse while running past red+margin', () => {
    const ctx = makeCtx();
    renderStage(ctx, {
      images,
      mode: 'running',
      elapsed: 500,
      thresholds,
      nowMs: 1000,
      videoReady: true,
      fgCanvas,
    });
    const fillRects = ctx.calls.filter((c) => c[0] === 'fillRect');
    expect(fillRects.length).toBeGreaterThan(0);
  });
});
