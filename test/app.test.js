import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  app,
  frameStep,
  listCameras,
  loadSettings,
  pauseTimer,
  readCustomFromInputs,
  resetTimer,
  resizeOffscreenCanvases,
  runKeyAction,
  scheduleNext,
  segmentFrame,
  showCustomError,
  startCamera,
  startTimer,
  syncPresetUI,
  toggleBell,
  toggleMirror,
  toggleStartPause,
  updateClockDom,
  updateStateLabelDom,
} from '../app.js';

// app.js binds the DOM contract from test/setup.js once at import. Each test resets
// the shared module state, DOM element state, and localStorage rather than
// re-importing, so the bound references stay valid.
const $ = (id) => document.getElementById(id);

beforeEach(() => {
  window.localStorage.clear();
  document.body.className = '';
  Object.assign(app, {
    mode: 'idle',
    elapsed: 0,
    lastBgState: 'start',
    preset: 'prepared',
    customTimes: { green: 300, yellow: 360, red: 420 },
    bellEnabled: false,
    stream: null,
    segmenter: null,
  });
  for (const id of ['custom-green', 'custom-yellow', 'custom-red']) $(id).value = '';
  $('camera-select').innerHTML = '';
  $('clock-html').textContent = '';
  const sl = $('state-label-html');
  sl.textContent = '';
  sl.removeAttribute('data-state');
  for (const p of document.querySelectorAll('p.error')) p.remove();
});

describe('loadSettings', () => {
  it('applies persisted preset, custom times, and bell', () => {
    window.localStorage.setItem('tmtimer.preset', 'evaluation');
    window.localStorage.setItem(
      'tmtimer.customTimes',
      JSON.stringify({ green: 10, yellow: 20, red: 30 })
    );
    window.localStorage.setItem('tmtimer.bell', '1');
    loadSettings();
    expect(app.preset).toBe('evaluation');
    expect(app.customTimes).toEqual({ green: 10, yellow: 20, red: 30 });
    expect(app.bellEnabled).toBe(true);
  });

  it('keeps defaults when storage is empty', () => {
    loadSettings();
    expect(app.preset).toBe('prepared');
    expect(app.bellEnabled).toBe(false);
  });
});

describe('syncPresetUI', () => {
  it('reflects the active preset and custom-field visibility', () => {
    app.preset = 'custom';
    app.customTimes = { green: 60, yellow: 90, red: 120 };
    syncPresetUI();
    expect($('preset-select').value).toBe('custom');
    expect($('custom-fields').hidden).toBe(false);
    expect($('custom-green').value).toBe('1:00');
    expect($('custom-red').value).toBe('2:00');
  });

  it('hides custom fields for a named preset', () => {
    app.preset = 'prepared';
    syncPresetUI();
    expect($('custom-fields').hidden).toBe(true);
  });
});

describe('readCustomFromInputs / showCustomError', () => {
  it('returns parsed times for valid input', () => {
    $('custom-green').value = '1:00';
    $('custom-yellow').value = '1:30';
    $('custom-red').value = '2:00';
    expect(readCustomFromInputs()).toEqual({ green: 60, yellow: 90, red: 120 });
    expect(document.querySelector('#custom-fields p.error')).toBeNull();
  });

  it('shows an error and returns null for invalid input', () => {
    $('custom-green').value = 'nope';
    expect(readCustomFromInputs()).toBeNull();
    const err = document.querySelector('#custom-fields p.error');
    expect(err).not.toBeNull();
    expect(err.textContent).toMatch(/m:ss/);
  });

  it('clears a prior error once input becomes valid', () => {
    showCustomError('boom');
    expect(document.querySelector('#custom-fields p.error')).not.toBeNull();
    $('custom-green').value = '1:00';
    $('custom-yellow').value = '1:30';
    $('custom-red').value = '2:00';
    readCustomFromInputs();
    expect(document.querySelector('#custom-fields p.error')).toBeNull();
  });
});

describe('updateStateLabelDom / updateClockDom', () => {
  it('writes the state label and data-state', () => {
    const el = $('state-label-html');
    updateStateLabelDom('green', false);
    expect(el.textContent).toBe('GREEN');
    expect(el.getAttribute('data-state')).toBe('green');
    updateStateLabelDom('start', false);
    expect(el.textContent).toBe('START');
    expect(el.hasAttribute('data-state')).toBe(false);
    updateStateLabelDom('red', true);
    expect(el.textContent).toBe('OVERTIME');
    expect(el.getAttribute('data-state')).toBe('overtime');
  });

  it('writes the formatted clock', () => {
    app.elapsed = 125;
    updateClockDom();
    expect($('clock-html').textContent).toBe('2:05');
  });
});

describe('timer controls', () => {
  it('start -> pause -> reset cycles mode', () => {
    startTimer();
    expect(app.mode).toBe('running');
    expect(document.querySelector('#btn-start-pause .btn-label').textContent).toBe('Pause');
    pauseTimer();
    expect(app.mode).toBe('paused');
    app.elapsed = 42;
    resetTimer();
    expect(app.mode).toBe('idle');
    expect(app.elapsed).toBe(0);
  });

  it('toggleStartPause flips between start and pause', () => {
    toggleStartPause();
    expect(app.mode).toBe('running');
    toggleStartPause();
    expect(app.mode).toBe('paused');
  });

  it('toggleMirror and toggleBell flip state + persist', () => {
    toggleMirror();
    expect(document.body.classList.contains('is-mirrored')).toBe(true);
    toggleBell();
    expect(app.bellEnabled).toBe(true);
    expect(window.localStorage.getItem('tmtimer.bell')).toBe('1');
  });
});

describe('runKeyAction', () => {
  it('dispatches preset selection', () => {
    runKeyAction('preset:1'); // evaluation
    expect(app.preset).toBe('evaluation');
    expect(window.localStorage.getItem('tmtimer.preset')).toBe('evaluation');
  });

  it('ignores an out-of-range preset index', () => {
    const before = app.preset;
    runKeyAction('preset:9');
    expect(app.preset).toBe(before);
  });

  it('dispatches timer + view actions', () => {
    runKeyAction('toggle');
    expect(app.mode).toBe('running');
    runKeyAction('reset');
    expect(app.mode).toBe('idle');
    runKeyAction('mirror');
    expect(document.body.classList.contains('is-mirrored')).toBe(true);
    runKeyAction('bell');
    expect(app.bellEnabled).toBe(true);
    runKeyAction('stage-clean');
    expect(document.body.classList.contains('stage-clean')).toBe(true);
    // jsdom doesn't implement <dialog>.showModal; stub it to cover openHelp.
    const guide = $('setup-guide');
    guide.showModal = vi.fn();
    runKeyAction('help');
    expect(guide.showModal).toHaveBeenCalled();
  });
});

describe('keydown handler', () => {
  function keydown(key, opts = {}) {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
    document.dispatchEvent(e);
    return e;
  }

  it('runs the mapped action and prevents default for space', () => {
    const e = keydown(' ');
    expect(app.mode).toBe('running');
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores keys while a modifier is held', () => {
    keydown(' ', { ctrlKey: true });
    expect(app.mode).toBe('idle');
  });

  it('ignores unbound keys', () => {
    keydown('z');
    expect(app.mode).toBe('idle');
  });

  it('ignores keys while a text field is focused', () => {
    const inp = $('custom-green');
    inp.focus();
    keydown(' ');
    expect(app.mode).toBe('idle');
    inp.blur();
  });
});

describe('listCameras', () => {
  it('populates the camera select from enumerated devices', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'cam-a', label: 'Cam A' },
          { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
          { kind: 'videoinput', deviceId: 'cam-b', label: '' },
        ]),
      },
    });
    window.localStorage.setItem('tmtimer.cameraId', 'cam-b');
    await listCameras();
    const sel = $('camera-select');
    expect(sel.options).toHaveLength(2);
    expect(sel.options[0].value).toBe('cam-a');
    expect(sel.value).toBe('cam-b'); // saved id reselected
  });
});

describe('render loop', () => {
  const video = () => $('video-source');
  function setVideoReady() {
    Object.defineProperty(video(), 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video(), 'paused', { configurable: true, value: false });
    Object.defineProperty(video(), 'ended', { configurable: true, value: false });
  }

  it('resizeOffscreenCanvases runs for sized and default video', () => {
    Object.defineProperty(video(), 'videoWidth', { configurable: true, value: 640 });
    Object.defineProperty(video(), 'videoHeight', { configurable: true, value: 480 });
    expect(() => resizeOffscreenCanvases()).not.toThrow();
    resizeOffscreenCanvases(); // second call hits the no-change branch
    Object.defineProperty(video(), 'videoWidth', { configurable: true, value: 0 });
    expect(() => resizeOffscreenCanvases()).not.toThrow(); // falls back to 1280x720
  });

  it('frameStep advances the clock and schedules the next frame while running', async () => {
    window.requestAnimationFrame = vi.fn();
    delete video().requestVideoFrameCallback;
    startTimer();
    app.lastTickMs = 1000;
    await frameStep(2000, null);
    expect(app.elapsed).toBeCloseTo(1, 1);
    expect($('clock-html').textContent).toBe('0:01');
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  it('frameStep segments in idle mode when the video is ready', async () => {
    window.requestAnimationFrame = vi.fn();
    setVideoReady();
    app.mode = 'idle';
    const close = vi.fn();
    app.segmenter = {
      segmentForVideo: () => ({
        categoryMask: {
          width: 4,
          height: 4,
          getAsUint8Array: () => Uint8Array.from({ length: 16 }, (_, i) => i % 2),
          close,
        },
        close,
      }),
    };
    await expect(frameStep(1000, { mediaTime: 0.5 })).resolves.toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it('segmentFrame draws raw video when there is no segmenter', async () => {
    app.segmenter = null;
    await expect(segmentFrame(video(), 0)).resolves.toBeUndefined();
  });

  it('segmentFrame bails when the category mask is missing', async () => {
    app.segmenter = { segmentForVideo: () => ({ categoryMask: null, close: vi.fn() }) };
    await expect(segmentFrame(video(), 0)).resolves.toBeUndefined();
  });

  it('scheduleNext prefers requestVideoFrameCallback when available', () => {
    video().requestVideoFrameCallback = vi.fn();
    scheduleNext();
    expect(video().requestVideoFrameCallback).toHaveBeenCalled();
  });

  it('scheduleNext falls back to requestAnimationFrame', () => {
    delete video().requestVideoFrameCallback;
    window.requestAnimationFrame = vi.fn();
    scheduleNext();
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });
});

describe('startCamera', () => {
  function fakeStream(trackSettings) {
    const track = { stop: vi.fn(), getSettings: () => trackSettings };
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  }

  it('acquires a stream, lists cameras, and persists the active device', async () => {
    const stream = fakeStream({ deviceId: 'cam-x' });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
        enumerateDevices: vi.fn().mockResolvedValue([]),
      },
    });
    const video = $('video-source');
    Object.defineProperty(video, 'srcObject', { writable: true, configurable: true, value: null });
    video.play = vi.fn().mockResolvedValue(undefined);

    await startCamera('cam-x');
    expect(app.stream).toBe(stream);
    expect(window.localStorage.getItem('tmtimer.cameraId')).toBe('cam-x');
  });

  it('surfaces a sidebar error when permission is denied', async () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(err) },
    });
    await startCamera();
    const errP = document.querySelector('#sidebar p.error');
    expect(errP).not.toBeNull();
    expect(errP.textContent).toMatch(/permission denied/);
  });
});
